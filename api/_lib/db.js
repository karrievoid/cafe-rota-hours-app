// db.js - Postgres access (works with Neon / Vercel Postgres / any PG URL).
// The schema is created on first use so no manual migration step is needed.
import pg from 'pg';

const { Pool } = pg;

// IMPORTANT: return DATE columns (type OID 1082) as the raw 'YYYY-MM-DD' string.
// By default node-postgres turns a DATE into a JS Date at the server's LOCAL
// midnight; formatting that with toISOString() then shifts it to UTC and can
// land on the previous day (e.g. in UK summer time, 1 June -> 31 May). Keeping
// it as a string means the date we stored is exactly the date we read back.
pg.types.setTypeParser(1082, (value) => value);

let pool;
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set. Add a Postgres connection string to your env.');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon / Vercel Postgres require SSL. Allow disabling for local dev.
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

export async function query(text, params) {
  const res = await getPool().query(text, params);
  return res;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rota_months (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  month_num   INT  NOT NULL,      -- 1-12, kept for the default label
  year_num    INT  NOT NULL,
  start_date  DATE,               -- bracket start (inclusive)
  end_date    DATE,               -- bracket end   (inclusive)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill bracket columns for periods created before they existed.
ALTER TABLE rota_months ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE rota_months ADD COLUMN IF NOT EXISTS end_date   DATE;
UPDATE rota_months SET start_date = make_date(year_num, month_num, 1) WHERE start_date IS NULL;
UPDATE rota_months SET end_date = (make_date(year_num, month_num, 1) + INTERVAL '1 month - 1 day')::date WHERE end_date IS NULL;

CREATE TABLE IF NOT EXISTS shifts (
  id            SERIAL PRIMARY KEY,
  month_id      INT NOT NULL REFERENCES rota_months(id) ON DELETE CASCADE,
  person_key    TEXT NOT NULL,     -- stable identity, e.g. "Lois" or "Lois #2"
  person_name   TEXT NOT NULL,     -- name as printed
  person_label  TEXT,              -- editable display name (e.g. "Lois (Bake)")
  person_seq    INT NOT NULL DEFAULT 0, -- order the person appears on the rota
  work_date     DATE NOT NULL,
  raw_text      TEXT,              -- original cell text
  status        TEXT NOT NULL,     -- 'work' | 'leave' | 'off' | 'unparsed'
  start_min     INT,               -- minutes from midnight
  end_min       INT,
  paid_minutes  INT NOT NULL DEFAULT 0,
  overridden    BOOLEAN NOT NULL DEFAULT false, -- true once a human edits it
  no_break      BOOLEAN NOT NULL DEFAULT false, -- 20-min break waived for this shift
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shifts_month ON shifts(month_id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS no_break BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS person_seq INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_hash TEXT;

CREATE TABLE IF NOT EXISTS change_requests (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  employee_name TEXT NOT NULL,
  work_date     DATE NOT NULL,
  req_status    TEXT NOT NULL,           -- desired: 'work' | 'off' | 'leave'
  start_min     INT,
  end_min       INT,
  leave_minutes INT,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  decided_at    TIMESTAMPTZ,
  applied_shift_id INT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON change_requests(status);
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS requester_name TEXT;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- The canonical store of uploaded rotas, one row per weekly rota. This is the
-- single source of truth for raw rota data (day by day, per person). Re-uploading
-- the same week REPLACES its row (matched on signature = month + day sequence)
-- rather than adding a duplicate. A pay period is built by reading the weeks that
-- fall in its bracket from here - editing a period never touches this table.
CREATE TABLE IF NOT EXISTS rota_weeks (
  id           SERIAL PRIMARY KEY,
  signature    TEXT UNIQUE NOT NULL,  -- the week's real start date (ISO), so each
                                      -- actual week is stored once; re-upload replaces
  source       TEXT,                  -- filename it most recently came from
  month_hint   TEXT,
  covers_start DATE,                  -- real first day of the week
  covers_end   DATE,                  -- real last day of the week
  parsed       JSONB NOT NULL,        -- one week { monthHint, days, people, source }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE rota_weeks ADD COLUMN IF NOT EXISTS covers_start DATE;
ALTER TABLE rota_weeks ADD COLUMN IF NOT EXISTS covers_end   DATE;

CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let initPromise;
export function ensureSchema() {
  if (!initPromise) initPromise = query(SCHEMA);
  return initPromise;
}