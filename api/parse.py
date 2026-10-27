"""
api/parse.py - PDF -> structured rota data, using pdfplumber.

Why Python for this step: pdfplumber gives clean word-with-coordinate output,
which makes positional table extraction (multi-word shifts, split shifts that
bleed across a column, wrapped cell text) far more robust than doing it in Node.

This endpoint ONLY reads the PDF layout. It does not interpret hours, apply the
break rule, or decide which calendar month a day belongs to - that stays in the
Node API (api/_lib). It returns a `weeks` structure plus a `warnings` list so the
app can tell the manager about anything it could not read, instead of silently
dropping it.

Robustness notes (the things that used to break real rotas):
  - The month label is only a hint. It is fuzzy-matched (so a typo like
    "Sepetmber" still reads as September) and the real calendar month of each day
    is worked out in Node from the payroll month the manager picks, so a missing
    or misspelled label never loses a week.
  - Day cells are assigned to a person by vertical position (a band around each
    staff row), so a wrapped line or a slightly high/low cell stays with the
    right person instead of being dropped.
  - The weekday header is found from anywhere on the page, and a page that cannot
    be read is reported as a warning rather than failing the whole upload.

Runs as a Vercel Python serverless function (Flask WSGI `app`) at /api/parse,
and locally via `python api/parse.py`.
"""
import io
import os
import re
import difflib

import jwt
import pdfplumber
from flask import Flask, request, jsonify

try:
    from dotenv import load_dotenv
    load_dotenv()  # harmless on Vercel; loads .env in local dev
except Exception:
    pass

app = Flask(__name__)

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MONTH_LOOKUP = {m.lower(): i for i, m in enumerate(MONTHS)}
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORDINAL = re.compile(r"^(\d{1,2})(st|nd|rd|th)\b", re.I)
IGNORE_PREFIX = ("KITCHEN", "SHIFTS", "OPEN", "DAILY", "FOOD", "UNTIL",
                 "PLEASE", "NOTE", "NOTES", "TOTAL", "HOLIDAY", "HOLS")


def fuzzy_month(token):
    """Best-effort month from a possibly misspelled label. None if hopeless."""
    if not token:
        return None
    t = re.sub(r"[^a-z]", "", token.lower())
    if not t:
        return None
    if t in MONTH_LOOKUP:
        return MONTHS[MONTH_LOOKUP[t]]
    for m in MONTHS:  # same letters, different order (e.g. "Sepetmber")
        if len(t) >= 4 and sorted(m.lower()) == sorted(t):
            return m
    lowered = [m.lower() for m in MONTHS]
    hit = difflib.get_close_matches(t, lowered, n=1, cutoff=0.7)
    if hit:
        return MONTHS[lowered.index(hit[0])]
    if len(t) >= 3:
        pref = [m for m in MONTHS if m.lower().startswith(t[:3])]
        if len(pref) == 1:
            return pref[0]
    return None


def cluster_rows(words, gap=6):
    rows = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and w["top"] - rows[-1]["last"] <= gap:
            rows[-1]["words"].append(w)
            rows[-1]["last"] = w["top"]
        else:
            rows.append({"top": w["top"], "last": w["top"], "words": [w]})
    return rows


def derive_columns(words):
    byday = {}
    for w in words:
        if w["text"] in WEEKDAYS:
            byday.setdefault(WEEKDAYS.index(w["text"]), []).append(w["x0"])
    found = {i: sorted(xs)[len(xs) // 2] for i, xs in byday.items()}
    if len(found) < 4:
        return None
    starts = [found.get(i) for i in range(7)]
    known = [(i, starts[i]) for i in range(7) if starts[i] is not None]
    steps = [(known[j + 1][1] - known[j][1]) / (known[j + 1][0] - known[j][0])
             for j in range(len(known) - 1)]
    step = (sum(steps) / len(steps)) if steps else 64.0
    for i in range(7):
        if starts[i] is None:
            ki = min(known, key=lambda kv: abs(kv[0] - i))
            starts[i] = ki[1] + (i - ki[0]) * step
    tops = [w["top"] for w in words if w["text"] in WEEKDAYS]
    header_top = sorted(tops)[len(tops) // 2]
    return {"starts": starts, "step": step,
            "name_max": min(starts) - 6, "header_top": header_top}


def column_index(x0, cols):
    """Match a word to a day column by its left edge. Tight boundary so a wrapped
    word (e.g. "hatch") stays in its own cell instead of drifting right."""
    if x0 < cols["name_max"]:
        return -1
    s = cols["starts"]
    for i in range(7):
        lo = s[i] - 6
        hi = (s[i + 1] - 6) if i < 6 else float("inf")
        if lo <= x0 < hi:
            return i
    return 6


def parse_page(page, idx, warnings):
    words = page.extract_words()
    cols = derive_columns(words)
    if not cols:
        warnings.append({"page": idx + 1, "reason": "Could not find the weekday header row"})
        return None

    rows = cluster_rows(words)

    hint = None
    for w in words:
        if abs(w["top"] - cols["header_top"]) <= 8 and w["x0"] < cols["name_max"]:
            fm = fuzzy_month(w["text"])
            if fm:
                hint = fm
                break

    best = None
    for r in rows:
        if r["top"] <= cols["header_top"] + 2:
            continue
        hits = sum(1 for w in r["words"] if ORDINAL.match(w["text"]))
        if hits >= 3 and (best is None or hits > best[0]):
            best = (hits, r)
    if not best:
        warnings.append({"page": idx + 1, "reason": "Could not find the date row (1st, 2nd, ...)"})
        return None
    date_row = best[1]
    date_bottom = date_row["last"]

    days = [None] * 7
    for w in date_row["words"]:
        m = ORDINAL.match(w["text"])
        if not m:
            continue
        ci = column_index(w["x0"], cols)
        if ci >= 0 and days[ci] is None:
            days[ci] = int(m.group(1))

    anchors = []
    for r in rows:
        if r["top"] <= date_bottom + 1:
            continue
        namew = [w for w in r["words"] if column_index(w["x0"], cols) == -1]
        if not namew:
            continue
        name = " ".join(w["text"] for w in sorted(namew, key=lambda w: w["x0"])).strip()
        up = name.upper()
        if any(up.startswith(p) for p in IGNORE_PREFIX):
            continue
        if not re.search(r"[A-Za-z]", name):
            continue
        anchors.append({"top": r["top"], "name": name})
    if not anchors:
        warnings.append({"page": idx + 1, "reason": "No staff rows found under the dates"})
        return None

    footer_top = float("inf")
    for r in rows:
        if r["top"] <= anchors[-1]["top"] + 4:
            continue
        line = " ".join(w["text"].upper() for w in r["words"])
        if any(k in line for k in ("KITCHEN", "OPEN DAILY", "FOOD UNTIL", "SHIFTS NEEDED")):
            footer_top = min(footer_top, r["top"])

    bounds = []
    for i, a in enumerate(anchors):
        lo = date_bottom if i == 0 else (anchors[i - 1]["top"] + a["top"]) / 2
        if i + 1 < len(anchors):
            hi = (a["top"] + anchors[i + 1]["top"]) / 2
        else:
            gap = (a["top"] - anchors[i - 1]["top"]) if i > 0 else 40
            hi = min(footer_top, a["top"] + gap)
        bounds.append((lo, hi))

    cells = [["" for _ in range(7)] for _ in anchors]
    for w in words:
        if w["top"] <= date_bottom + 1 or w["top"] >= footer_top:
            continue
        ci = column_index(w["x0"], cols)
        if ci < 0:
            continue
        center = w["top"]
        bi = None
        for i, (lo, hi) in enumerate(bounds):
            if lo <= center < hi:
                bi = i
                break
        if bi is None:
            bi = min(range(len(anchors)), key=lambda i: abs(anchors[i]["top"] - center))
        cells[bi][ci] = (cells[bi][ci] + " " + w["text"]).strip()

    people = []
    name_count = {}
    for i, a in enumerate(anchors):
        name = a["name"]
        occ = name_count.get(name, 0) + 1
        name_count[name] = occ
        person_key = name if occ == 1 else f"{name} #{occ}"
        people.append({"name": name, "personKey": person_key,
                       "occurrence": occ, "seq": i, "days": cells[i]})

    return {"monthHint": hint, "days": [{"day": d} for d in days], "people": people}


def parse_pdf_bytes(data, source, warnings):
    weeks = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages):
            try:
                wk = parse_page(page, i, warnings)
            except Exception as e:  # noqa: BLE001
                warnings.append({"page": i + 1, "source": source, "reason": f"error: {e}"})
                wk = None
            if wk:
                wk["source"] = source
                weeks.append(wk)
    return weeks


def check_auth():
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
    warnings = []
    for f in files:
        try:
            weeks.extend(parse_pdf_bytes(f.read(), f.filename, warnings))
        except Exception as e:  # noqa: BLE001
            warnings.append({"source": f.filename, "reason": f"Could not open file: {e}"})

    if not weeks:
        return jsonify({"error": "No rota tables could be read from the uploaded PDFs.",
                        "warnings": warnings}), 422
    return jsonify({"weeks": weeks, "warnings": warnings})


@app.route("/api/parse/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PARSE_PORT", "3002"))
    app.run(port=port, debug=True)
