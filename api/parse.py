"""
api/parse.py - PDF -> structured rota data, using pdfplumber.

Why Python for this step: pdfplumber gives clean word-with-coordinate output,
which makes the positional table extraction (multi-word shifts, split shifts
that bleed across a column) far simpler and more robust than doing it in Node.

This endpoint ONLY reads the PDF layout. It does not interpret hours, apply the
break rule, or trim months - that stays in the Node API (api/_lib) so all the
payroll logic lives in one place. It returns a `weeks` structure that the Node
route feeds straight into buildShiftRecords().

Runs as a Vercel Python serverless function (Flask WSGI `app`) at /api/parse,
and locally via `python api/parse.py`.
"""
import io
import os
import re

import jwt
import pdfplumber
from flask import Flask, request, jsonify

try:
    from dotenv import load_dotenv
    load_dotenv()  # harmless on Vercel (no .env there); loads .env in local dev
except Exception:
    pass

app = Flask(__name__)

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MONTH_LOOKUP = {m.lower(): i for i, m in enumerate(MONTHS)}
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORDINAL = re.compile(r"^(\d{1,2})(st|nd|rd|th)", re.I)


def next_month_name(name):
    i = next((k for k, m in enumerate(MONTHS) if m.lower() == name.lower()), -1)
    return name if i == -1 else MONTHS[(i + 1) % 12]


def cluster_rows(words, gap=5):
    """Group words into visual rows using a vertical gap threshold."""
    rows = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and w["top"] - rows[-1]["last"] <= gap:
            rows[-1]["words"].append(w)
            rows[-1]["last"] = w["top"]
        else:
            rows.append({"top": w["top"], "last": w["top"], "words": [w]})
    return rows


def derive_columns(rows):
    """Find the weekday header row and use each weekday's x0 as a column start.

    Deriving boundaries from the header (rather than hard-coding pixels) lets the
    parser cope with small template differences.
    """
    for row in rows:
        found = {}
        for w in row["words"]:
            if w["text"] in WEEKDAYS:
                found[WEEKDAYS.index(w["text"])] = w["x0"]
        if len(found) >= 5:
            starts = [found.get(i) for i in range(7)]
            for i in range(7):  # fill any missing weekday by interpolation
                if starts[i] is None:
                    prev = next((starts[j] for j in range(i - 1, -1, -1) if starts[j] is not None), None)
                    nxt = next((starts[j] for j in range(i + 1, 7) if starts[j] is not None), None)
                    if prev is not None and nxt is not None:
                        starts[i] = (prev + nxt) / 2
                    elif prev is not None:
                        starts[i] = prev + 64
                    elif nxt is not None:
                        starts[i] = nxt - 64
            return {"name_max": min(starts) - 6, "starts": starts, "header_row": row}
    return None


def column_index(x0, cols):
    if x0 < cols["name_max"]:
        return -1  # name column
    s = cols["starts"]
    for i in range(7):
        lo = s[i] - 6
        hi = (s[i + 1] - 6) if i < 6 else float("inf")
        if lo <= x0 < hi:
            return i
    return 6


def row_to_cells(row, cols):
    cells = {"name": "", "days": ["", "", "", "", "", "", ""]}
    for w in sorted(row["words"], key=lambda w: w["x0"]):
        ci = column_index(w["x0"], cols)
        if ci == -1:
            cells["name"] = (cells["name"] + " " + w["text"]).strip()
        else:
            cells["days"][ci] = (cells["days"][ci] + " " + w["text"]).strip()
    return cells


def parse_page(page):
    rows = cluster_rows(page.extract_words())
    cols = derive_columns(rows)
    if not cols:
        return None

    grid = [row_to_cells(r, cols) for r in rows]

    header_cells = row_to_cells(cols["header_row"], cols)
    month_token = (header_cells["name"] or "").split()[0] if header_cells["name"] else ""
    month = month_token if month_token.lower() in MONTH_LOOKUP else None

    # Date row: the row whose day cells are mostly ordinals (1st, 2nd, ...).
    date_idx = -1
    for i, cell in enumerate(grid):
        hits = sum(1 for d in cell["days"] if ORDINAL.match(d))
        if hits >= 4:
            date_idx = i
            break
    if date_idx == -1:
        return None

    # Tag each column with (month, day); roll to next month when the number resets.
    days = []
    prev = 0
    cur = month
    for d in grid[date_idx]["days"]:
        m = ORDINAL.match(d)
        day = int(m.group(1)) if m else None
        if day is not None and day < prev and cur:
            cur = next_month_name(cur)
        if day is not None:
            prev = day
        days.append({"month": cur, "day": day})

    # People rows follow the date row.
    people = []
    name_count = {}
    for cell in grid[date_idx + 1:]:
        name = cell["name"].strip()
        if not name:
            continue
        up = name.upper()
        if up.startswith("KITCHEN") or up.startswith("SHIFTS"):
            continue
        occ = name_count.get(name, 0) + 1
        name_count[name] = occ
        # Stable identity even when two people share a name (e.g. two "Lois").
        person_key = name if occ == 1 else f"{name} #{occ}"
        people.append({"name": name, "personKey": person_key, "occurrence": occ, "days": cell["days"]})

    return {"month": month, "days": days, "people": people}


def parse_pdf_bytes(data):
    weeks = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            week = parse_page(page)
            if week:
                weeks.append(week)
    return weeks


def check_auth():
    """Verify the same JWT the Node API issues. Returns True/False."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    token = header[7:]
    secret = os.environ.get("JWT_SECRET", "dev-insecure-secret-change-me")
    try:
        jwt.decode(token, secret, algorithms=["HS256"])
        return True
    except Exception:
        return False


@app.route("/api/parse", methods=["POST"])
def parse():
    if not check_auth():
        return jsonify({"error": "Not authenticated"}), 401
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "Upload at least one PDF"}), 400

    weeks = []
    for f in files:
        try:
            fw = parse_pdf_bytes(f.read())
            for wk in fw:
                wk["source"] = f.filename  # so the UI can offer a version chooser
            weeks.extend(fw)
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"Could not read {f.filename}: {e}"}), 422

    if not weeks:
        return jsonify({"error": "No rota tables found in the uploaded PDFs"}), 422
    return jsonify({"weeks": weeks})


@app.route("/api/parse/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    # Local dev server. Vercel uses the `app` object directly.
    port = int(os.environ.get("PARSE_PORT", "3002"))
    app.run(port=port, debug=True)