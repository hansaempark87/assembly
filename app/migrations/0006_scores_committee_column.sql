-- Stage 2 formula adds committee attendance as its own visible pillar instead
-- of silently merging it into plenary attendance, so the UI can always show
-- both percentiles separately alongside the combined "attendance" weight.
ALTER TABLE member_scores ADD COLUMN committee_attendance_percentile REAL;
ALTER TABLE score_runs ADD COLUMN committee_attendance_weight REAL;
