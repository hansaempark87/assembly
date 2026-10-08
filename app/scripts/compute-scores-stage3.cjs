// Stage-3 scoring: stage-2 formula + exclusion of state-office periods.
//
// Usage: node scripts/compute-scores-stage3.cjs <members.json> <data/member-roles.json> <data/role-adjustments.json> <data/data-corrections.json> <lib/score-run.js>
//   members.json is the /api/members response (raw D1 counts, any score run).
//
// For members whose role kind is "exclude" (국회의장·국무총리·국무위원), every
// record inside the office period is removed from numerator AND denominator
// (data/role-adjustments.json, produced by scripts/role-adjust.py), and the
// period is removed from tenure days used by the legislation measure. A member
// whose remaining observed period is under MIN_TENURE_DAYS is held from grading
// ("role_hold"), the same rule already applied to short tenure.
// kind "flag" (국회부의장) is display-only; scores use the unadjusted records.
//
// Output is a JS module bundled into the Pages Functions so the score run and
// the code that displays it always deploy together.

const fs = require('node:fs');
const { percentileRank, grade } = require('./compute-scores.cjs');

const MIN_TENURE_DAYS = 180;
const WEIGHTS = { legislation: 0.40, vote: 0.35, attendance: 0.15, committee: 0.10 };
const FORMULA_VERSION = 'stage3-2026-10-08';

const ratio = (n, d) => (d > 0 ? n / d : null);

function main() {
  const [membersFile, rolesFile, adjFile, corrFile, outFile] = process.argv.slice(2);
  const members = JSON.parse(fs.readFileSync(membersFile, 'utf8')).members;
  // Documented corrections to the raw records (see public/data-notes.json)
  const corrections = JSON.parse(fs.readFileSync(corrFile, 'utf8')).corrections;
  const correctById = {};
  for (const c of corrections) {
    const m = members.find((x) => x.id === c.member_id);
    if (!m) throw new Error(`correction for unknown member ${c.member_id}`);
    Object.assign(m, c.fields);
    correctById[c.member_id] = c.fields;
  }
  const roles = JSON.parse(fs.readFileSync(rolesFile, 'utf8')).roles;
  const adj = JSON.parse(fs.readFileSync(adjFile, 'utf8')).members;

  const rows = members.map((m) => {
    const a = adj[m.id];
    const z = { eligible: 0, participated: 0 };
    const v = a ? a.votes : z;
    const p = a ? a.plenary : { meetings: 0, present: 0, absent: 0, leave: 0, travel: 0 };
    const c = a ? a.committee : { meetings: 0, present: 0, absent: 0, leave: 0, travel: 0 };
    const days = m.tenure_days - (a ? a.role_days : 0);
    const s = {
      id: m.id,
      observed_days: days,
      vote_eligible: m.vote_eligible - v.eligible,
      vote_participated: m.vote_participated - v.participated,
      attendance_meetings: m.attendance_meetings - p.meetings,
      attendance_present: m.attendance_present - p.present,
      absent_count: m.absent_count - p.absent,
      leave_count: m.leave_count - p.leave,
      travel_count: m.travel_count - p.travel,
      committee_meetings_total: (m.committee_meetings_total || 0) - c.meetings,
      committee_present: (m.committee_present || 0) - c.present,
      committee_absent: (m.committee_absent || 0) - c.absent,
      committee_leave: (m.committee_leave || 0) - c.leave,
      committee_travel: (m.committee_travel || 0) - c.travel,
    };
    s.participation_rate = ratio(s.vote_participated, s.vote_eligible);
    s.attendance_rate = ratio(s.attendance_present, s.attendance_meetings);
    s.committee_attendance_rate = ratio(s.committee_present, s.committee_meetings_total);
    s.weighted_score = days > 0 ? ((m.lead_passed || 0) + 0.5 * (m.lead_alternative || 0)) / days : null;
    s.adjusted = !!a;
    if (m.tenure_days < MIN_TENURE_DAYS) s.status = 'short_tenure';
    else if (days < MIN_TENURE_DAYS) s.status = 'role_hold';
    else s.status = 'eligible';
    return s;
  });

  const eligible = rows.filter((r) => r.status === 'eligible');
  const pr = (key) => percentileRank(eligible.map((r) => ({ id: r.id, value: r[key] })));
  const legP = pr('weighted_score');
  const voteP = pr('participation_rate');
  const attP = pr('attendance_rate');
  const cmtP = pr('committee_attendance_rate');

  for (const r of eligible) {
    r.legislation_percentile = legP.get(r.id);
    r.vote_percentile = voteP.get(r.id);
    r.attendance_percentile = attP.get(r.id);
    r.committee_attendance_percentile = cmtP.get(r.id);
    const core = [r.legislation_percentile, r.vote_percentile, r.attendance_percentile];
    if (core.some((x) => x === null || x === undefined)) { r.comp = null; continue; }
    if (r.committee_attendance_percentile !== null && r.committee_attendance_percentile !== undefined) {
      r.comp = r.legislation_percentile * WEIGHTS.legislation + r.vote_percentile * WEIGHTS.vote +
        r.attendance_percentile * WEIGHTS.attendance + r.committee_attendance_percentile * WEIGHTS.committee;
    } else {
      const core3 = WEIGHTS.legislation + WEIGHTS.vote + WEIGHTS.attendance;
      r.comp = (r.legislation_percentile * WEIGHTS.legislation + r.vote_percentile * WEIGHTS.vote +
        r.attendance_percentile * WEIGHTS.attendance) / core3;
    }
  }
  const compP = percentileRank(eligible.map((r) => ({ id: r.id, value: r.comp })));
  const ranked = eligible.filter((r) => r.comp !== null).sort((a, b) => b.comp - a.comp);
  ranked.forEach((r, i) => {
    r.rank = i > 0 && r.comp === ranked[i - 1].comp ? ranked[i - 1].rank : i + 1;
  });

  const scores = {};
  for (const r of rows) {
    const ok = r.status === 'eligible';
    const cp = ok ? compP.get(r.id) : null;
    scores[r.id] = {
      status: r.status,
      eligible: ok ? 1 : 0,
      observed_days: r.observed_days,
      legislation_percentile: ok ? r.legislation_percentile : null,
      vote_percentile: ok ? r.vote_percentile : null,
      attendance_percentile: ok ? r.attendance_percentile : null,
      committee_attendance_percentile: ok ? r.committee_attendance_percentile : null,
      composite_percentile: cp,
      rank: ok ? r.rank ?? null : null,
      grade: grade(cp),
      ...(correctById[r.id] ? { correct: correctById[r.id] } : {}),
      ...(r.adjusted
        ? {
            scored: {
              vote_eligible: r.vote_eligible, vote_participated: r.vote_participated, participation_rate: r.participation_rate,
              attendance_meetings: r.attendance_meetings, attendance_present: r.attendance_present,
              absent_count: r.absent_count, leave_count: r.leave_count, travel_count: r.travel_count, attendance_rate: r.attendance_rate,
              committee_meetings_total: r.committee_meetings_total, committee_present: r.committee_present,
              committee_absent: r.committee_absent, committee_leave: r.committee_leave, committee_travel: r.committee_travel,
              committee_attendance_rate: r.committee_attendance_rate, weighted_score: r.weighted_score,
            },
          }
        : {}),
    };
  }

  const run = {
    formula_version: FORMULA_VERSION,
    legislation_weight: WEIGHTS.legislation,
    vote_weight: WEIGHTS.vote,
    attendance_weight: WEIGHTS.attendance,
    committee_attendance_weight: WEIGHTS.committee,
    min_tenure_days: MIN_TENURE_DAYS,
    created_at: new Date().toISOString(),
    // last record date per source in the D1 raw data (see docs/role-adjustment.md)
    data_as_of: '2026-10-01',
    coverage: { bills_until: '2026-09-30', votes_until: '2026-09-17', plenary_until: '2026-08-26', committee_until: '2026-08' },
  };
  const roleList = roles.map(({ member_id, role, kind, start, end, sources }) => ({ member_id, role, kind, start, end, sources }));
  const body = `// Generated by scripts/compute-scores-stage3.cjs — do not edit by hand.\nexport default ${JSON.stringify({ run, roles: roleList, scores })};\n`;
  fs.writeFileSync(outFile, body);
  const counts = rows.reduce((o, r) => ((o[r.status] = (o[r.status] || 0) + 1), o), {});
  console.log(FORMULA_VERSION, counts, 'graded:', ranked.length);
}

main();
