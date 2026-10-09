// Joins the raw counts with the versioned score run. Both files are generated
// by pipeline/build.py from data/source and deployed with the code, so the
// API, the pages and the method that explains them never disagree.
import RECORDS from './member-records.js';
import RUN from './score-run.js';

export const run = RUN.run;

const SCORE_FIELDS = [
  'status', 'eligible', 'observed_days', 'legislation_percentile', 'vote_percentile', 'attendance_percentile',
  'committee_attendance_percentile', 'composite_percentile', 'composite_score', 'coop_bonus', 'coop_index', 'coop_excess', 'rank', 'grade',
];

// Returns the row with score fields attached. For members with an excluded
// office period, the record fields are replaced by the scored (adjusted)
// values and the original values are kept under `raw`.
export function withScores(row) {
  const s = RUN.scores[row.id] || { status: 'unscored', eligible: 0 };
  // documented corrections to the raw record come first
  const out = { ...row, ...(s.correct || {}) };
  for (const k of SCORE_FIELDS) out[k] = s[k] ?? null;
  out.eligible = s.eligible || 0;
  if (s.scored) {
    out.raw = {};
    for (const k of Object.keys(s.scored)) out.raw[k] = k in (s.correct || {}) ? s.correct[k] : row[k];
    Object.assign(out, s.scored);
  }
  out.roles = RUN.roles.filter((r) => r.member_id === row.id);
  return out;
}

export const byRank = (a, b) =>
  (a.rank === null) - (b.rank === null) || (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name, 'ko');

let cache = null;
// Every member with scores attached, best rank first.
export function allMembers() {
  if (!cache) cache = RECORDS.map(withScores).sort(byRank);
  return cache;
}

export function memberById(id) {
  return allMembers().find((m) => m.id === id) || null;
}
