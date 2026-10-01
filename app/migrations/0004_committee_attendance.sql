-- Adds committee attendance, aggregated at monthly-file granularity (not yet
-- meeting-date level — see docs/attendance-audit-2026-10-01.md). 4 known
-- raw-data mismatches between daily cells and published monthly totals were
-- found during the 3rd audit and are NOT silently corrected; they remain in
-- the summed totals as published.
CREATE TABLE IF NOT EXISTS member_committee_attendance (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  months_covered INTEGER NOT NULL DEFAULT 0,  -- number of monthly files this member appears in
  meetings_total INTEGER NOT NULL DEFAULT 0,
  present_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  leave_count INTEGER NOT NULL DEFAULT 0,      -- 청가
  travel_count INTEGER NOT NULL DEFAULT 0,     -- 출장
  reported_absence_count INTEGER NOT NULL DEFAULT 0, -- 결석신고서
  attendance_rate REAL,                        -- NULL if meetings_total = 0
  updated_at TEXT NOT NULL
);
