-- 22nd National Assembly performance dashboard — initial schema
-- Raw counts only; percentiles/grades are computed and stored separately so
-- the raw numerator/denominator is always visible alongside any derived grade.

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,           -- MONA_CD from open.assembly.go.kr
  name TEXT NOT NULL,
  hanja_name TEXT,
  party TEXT,
  district TEXT,
  committee TEXT,
  term_start TEXT NOT NULL,      -- ISO date, 22nd-term start for this member
  term_end TEXT,                 -- NULL if still serving
  is_current INTEGER NOT NULL DEFAULT 1,
  tenure_days INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_legislation (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  lead_count INTEGER NOT NULL DEFAULT 0,
  lead_passed INTEGER NOT NULL DEFAULT 0,       -- 원안가결+수정가결
  lead_alternative INTEGER NOT NULL DEFAULT 0,  -- 대안반영폐기+수정안반영폐기
  lead_withdrawn INTEGER NOT NULL DEFAULT 0,
  lead_rejected INTEGER NOT NULL DEFAULT 0,
  lead_pending INTEGER NOT NULL DEFAULT 0,
  co_lead_count INTEGER NOT NULL DEFAULT 0,     -- reference only, not scored
  weighted_score REAL NOT NULL DEFAULT 0,       -- (passed*1.0 + alt*0.5) / tenure_days
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_votes (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  eligible_count INTEGER NOT NULL DEFAULT 0,
  participated_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,    -- boundary-date / disputed bills removed from denominator
  participation_rate REAL,                      -- NULL if eligible_count = 0
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_attendance (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  meetings_total INTEGER NOT NULL DEFAULT 0,    -- plenary sessions held during member's tenure
  present_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  leave_count INTEGER NOT NULL DEFAULT 0,       -- 청가
  travel_count INTEGER NOT NULL DEFAULT 0,      -- 출장
  attendance_rate REAL,                         -- NULL if meetings_total = 0
  updated_at TEXT NOT NULL
);

-- One row per scoring run so history/versioning is possible later.
CREATE TABLE IF NOT EXISTS score_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  formula_version TEXT NOT NULL,                -- e.g. 'stage1-2026-10-01'
  legislation_weight REAL NOT NULL,
  vote_weight REAL NOT NULL,
  attendance_weight REAL NOT NULL,
  min_tenure_days INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_scores (
  run_id INTEGER NOT NULL REFERENCES score_runs(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  eligible INTEGER NOT NULL,             -- 0 if excluded for insufficient tenure
  legislation_percentile REAL,
  vote_percentile REAL,
  attendance_percentile REAL,
  composite_percentile REAL,
  rank INTEGER,
  grade TEXT,                            -- S/A/B/C/D, NULL if not eligible
  PRIMARY KEY (run_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_members_current ON members(is_current);
CREATE INDEX IF NOT EXISTS idx_scores_run ON member_scores(run_id);
