#!/usr/bin/env bash
# Re-exports the raw tables from D1 and recomputes stage-1 percentiles/grades.
# Run from app/. Does not touch members/legislation/votes/attendance tables —
# those are refreshed separately by the (not-yet-automated) collection step.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p tmp
npx wrangler d1 execute assembly-dashboard --remote --command="SELECT id, tenure_days FROM members" --json > tmp/members.json
npx wrangler d1 execute assembly-dashboard --remote --command="SELECT member_id, weighted_score FROM member_legislation" --json > tmp/legislation.json
npx wrangler d1 execute assembly-dashboard --remote --command="SELECT member_id, participation_rate FROM member_votes" --json > tmp/votes.json
npx wrangler d1 execute assembly-dashboard --remote --command="SELECT member_id, attendance_rate FROM member_attendance" --json > tmp/attendance.json

node scripts/compute-scores.cjs tmp/members.json tmp/legislation.json tmp/votes.json tmp/attendance.json tmp/scores.sql

STAMP=$(date +%Y%m%d%H%M%S)
OUT="migrations/9${STAMP}_rescore.sql"
cp tmp/scores.sql "$OUT"
npx wrangler d1 execute assembly-dashboard --remote --file="$OUT"

echo "Applied new score run from $OUT"
