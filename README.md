# Rota Hours

A small web app that turns weekly cafe rota PDFs into monthly paid-hours totals per person.
Upload the rotas, adjust any shifts that changed on the paper copy, and read off one
figure per person to hand to payroll — instead of an hour with a calculator.

**Stack:** React (Vite) front end · Express (Node) API · **Python (pdfplumber) PDF parser** · Postgres.
Deploys to **Vercel** on the free plan — Node and Python run as serverless functions side by side.

## What it does

- **Upload** one or more weekly rota PDFs for a payroll month.
- **Parses the table** by text position (Python/pdfplumber), so multi-word and split shifts stay in the right day.
- **Trims other months.** Weekly rotas often show a few days of the previous/next month;
  only the days belonging to the month you pick are counted.
- **Applies the break rule.** Any shift longer than 6 hours loses a 20-minute unpaid break.
  Exactly 6 hours keeps all 6.
- **Handles split / role-change shifts** like `6.45-8B, -15.00 F&G` (one block, 06:45–15:00).
- **Strips role tags** (`K&KP`, `KP`, `F&G`, `Bake`, `Barista`, `floor till hatch`) — they don't affect hours.
- **Payable leave.** `OFF (L)` days are flagged as leave; you type the hours to pay and no break is deducted.
- **Keeps two people with the same name separate** (e.g. the two "Lois"); each row is its own person and can be renamed.
- **Editable grid.** Change a start/end time and paid hours recompute instantly; add or delete shifts; override any figure.
- **Summary** of total hours per person, with copy-to-clipboard and CSV download.

## Architecture

```
Browser (React)
   │  1. POST /api/parse   (PDF files)  ─────────►  Python function  (api/parse.py, pdfplumber)
   │  ◄── weeks JSON (raw weekly grid) ───────────
   │
   │  2. POST /api/months  (weeks + month/year) ─►  Node/Express     (api/index.js)
   │                                                 trims month, applies hour rules,
   │  ◄── saved month id ─────────────────────────   saves to Postgres
   │
   └─ 3. GET/PATCH /api/... editing & summary  ───►  Node/Express  ◄──►  Postgres
```

Why split it this way: **pdfplumber** gives clean word-with-coordinate output, which makes the
positional table extraction much simpler and sturdier than doing it in Node. Everything else —
auth, the break/leave rules, month trimming, storage — stays in one place in the Node API. The
browser calls each function directly (no server-to-server hops), which keeps local dev and Vercel
routing simple and easy to inspect in the Network tab.

## Project layout

```
api/
  parse.py            Python (Flask + pdfplumber): PDF -> weekly grid JSON   [/api/parse]
  index.js            Express app (one Vercel Node function)                 [/api/*]
  _lib/
    shifts.js         time parsing (HH.MM) + break rule
    buildShifts.js    month trimming + shift records
    db.js             Postgres pool + schema (auto-created)
    auth.js           password -> JWT
requirements.txt      Python deps (flask, pdfplumber, PyJWT, python-dotenv)
src/                  React front end (Vite)
dev-server.js         runs the Node API locally
vite.config.js        dev proxy: /api/parse -> :3002 (Python), /api/* -> :3001 (Node)
vercel.json           build + routing (/api/parse -> Python, rest -> Node)
```

## The hours logic (in one place: `api/_lib/shifts.js`)

Times are read as `HH.MM` (so `6.45` = 06:45, not 6.75 hours). For a shift, paid time is
`end - start`, minus 20 minutes if that span is **strictly greater** than 6 hours. Split shifts
written with a comma are treated as one continuous block from the first time to the last. Leave
days are paid at whatever hours you enter, with no break deducted. Any cell the parser can't read
is flagged `check` in the grid and excluded from totals until you fix it.

---

# Run a dev version in VS Code (step by step)

You'll run three things locally: the **Vite** web app, the **Node** API, and the **Python** parser.
Nothing deploys until you choose to.

### 0. Prerequisites
- **Node.js 18+** — https://nodejs.org
- **Python 3.10+** — https://python.org
- **VS Code** — https://code.visualstudio.com
- A free **Postgres** database. Easiest is **Neon** (https://neon.tech) — sign up, create a project,
  and copy the connection string (looks like `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).

### 1. Get the code into a folder
- Unzip `cafe-rota-hours.zip` somewhere sensible, e.g. `Documents\cafe-rota-hours`.
- In VS Code: **File → Open Folder…** and pick that folder.
- Open a terminal inside VS Code: **Terminal → New Terminal** (or `` Ctrl+` ``).

### 2. Install the Node packages
```bash
npm install
```

### 3. Set up the Python parser (its own virtual environment)
In the same terminal, from the project folder:

**Windows (PowerShell):**
```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
**macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
> If VS Code asks "We noticed a new virtual environment, do you want to select it?" — click **Yes**.

### 4. Create your environment file
Copy the example and fill it in:
```bash
# Windows: copy .env.example .env
# macOS/Linux:
cp .env.example .env
```
Open `.env` and set:
- `DATABASE_URL` — your Neon connection string
- `APP_PASSWORD` — the password you'll log in with
- `JWT_SECRET` — any long random string (used by **both** the Node and Python functions)

The database tables are created automatically the first time the app runs — no migration step.

### 5. Start all three processes
Open **two terminals** in VS Code (click the **+** in the terminal panel for a second one).

**Terminal 1 — Python parser** (make sure the venv is active; you'll see `(venv)` in the prompt):
```bash
python api/parse.py
```
It should say it's running on `http://127.0.0.1:3002`.

**Terminal 2 — Node API + web app together:**
```bash
npm run dev
```
This starts the Express API on **:3001** and the Vite dev server on **:5173**.

### 6. Open the app
Go to **http://localhost:5173**. Sign in with your `APP_PASSWORD`.
Upload the sample rota PDFs, pick the payroll month/year, and you'll see the editable grid and totals.

### 7. How to watch it working (for inspecting / learning)
- **Network tab** (browser DevTools → Network): you'll see the two calls — `POST /api/parse`
  (PDF → weeks) then `POST /api/months` (save). Click each to see the JSON.
- **Terminal 1** prints Python/pdfplumber activity; **Terminal 2** prints Express logs.
- **The data:** open your Neon dashboard → SQL editor → `SELECT * FROM shifts;` to see stored rows.
- **Good places to read the code:** `api/parse.py` (PDF extraction), `api/_lib/shifts.js`
  (the hour/break rule), `api/_lib/buildShifts.js` (month trimming), `src/components/RotaGrid.jsx` (the editable grid).

### Common hiccups
- **Parse call fails / 502 on upload:** the Python terminal (Terminal 1) isn't running, or the venv
  isn't active. Restart it.
- **"DATABASE_URL is not set":** your `.env` isn't filled in, or you started the servers before saving it.
- **Login fails:** `APP_PASSWORD` in `.env` must match what you type.
- **Port already in use:** something else is on 3001/3002/5173 — close it, or change the port in
  `.env` (`PORT`, `PARSE_PORT`) and `vite.config.js`.

---

## Deploy to Vercel (free, no custom domain needed)

1. Push this folder to a GitHub repo.
2. In Vercel: **New Project → import the repo**. It auto-detects Vite (Node) and the Python function.
3. Add a Postgres database — **Vercel Postgres** (Storage tab) sets `DATABASE_URL` for you, or paste a **Neon** string.
4. **Settings → Environment Variables**, add:
   - `DATABASE_URL` — your Postgres string
   - `APP_PASSWORD` — your login password
   - `JWT_SECRET` — a long random string (same value shared by Node and Python)
5. **Deploy.** You get a free `*.vercel.app` URL. `vercel.json` routes `/api/parse` to the Python
   function and everything else to the Node function automatically.

## Notes & limits
- The parser is tuned to this rota template (month top-left, Mon–Sun columns, one person per row).
  A very different layout may need the column detection in `api/parse.py` adjusted.
- Everything is editable in the grid, so any rare mis-read is a quick manual fix — the totals never
  silently trust a bad parse (unreadable cells are flagged and left out).
- Auth is a single shared password, appropriate for one manager on a private URL. Swap in per-user
  accounts later if needed.
