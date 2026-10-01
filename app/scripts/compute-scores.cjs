// Computes stage-2 percentile scores and S/A/B/C/D grades from the D1 tables
// and writes a score_runs + member_scores SQL file to apply with wrangler.
//
// Usage: node scripts/compute-scores.cjs <members.json> <legislation.json> <votes.json> <attendance.json> <committee.json> <outfile.sql>
// Each input is the JSON array returned by `wrangler d1 execute ... --json`.
//
// Formula (stage 2, see docs/evaluation-draft.md):
//   legislation 40% + vote participation 35% + plenary attendance 15% + committee attendance 10%
//   Committee attendance is still monthly-aggregated (not meeting-date level) and
//   carries 4 known raw-data mismatches that were not silently corrected, so it
//   is weighted lower than plenary attendance until that is resolved.
//   Members with tenure_days < MIN_TENURE_DAYS are marked ineligible (no grade).
//   A member missing committee data (e.g. too recently seated for a file to
//   exist yet) still gets a composite score computed from legislation+vote+plenary
//   only, with its weight redistributed proportionally — this is recorded per
//   member via a NULL committee_attendance_percentile, not hidden.
//   Percentile = (count of members with strictly lower score) / (eligible N - 1) * 100,
//   ties share the same percentile (average-rank style) so equal performers get equal grades.

const fs = require('node:fs');

const MIN_TENURE_DAYS = 180;
const WEIGHTS = { legislation: 0.40, vote: 0.35, attendance: 0.15, committee: 0.10 };
const FORMULA_VERSION = 'stage2-2026-10-01';

function percentileRank(values) {
  // values: array of {id, value}; value may be null (missing -> excluded from ranking but kept in output as null)
  const valid = values.filter((v) => v.value !== null && v.value !== undefined);
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const n = sorted.length;
  const rankMap = new Map();
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && sorted[j + 1].value === sorted[i].value) j++;
    // average percentile for the tied block [i..j]; lower value = lower percentile
    // percentile = share of population with value <= this value (using midpoint of tie block for fairness)
    const avgIndex = (i + j) / 2;
    const pct = n > 1 ? (avgIndex / (n - 1)) * 100 : 100;
    for (let k = i; k <= j; k++) rankMap.set(sorted[k].id, pct);
    i = j + 1;
  }
  const out = new Map();
  for (const v of values) out.set(v.id, rankMap.has(v.id) ? rankMap.get(v.id) : null);
  return out;
}

function grade(pct) {
  if (pct === null || pct === undefined) return null;
  const topPct = 100 - pct; // smaller topPct = better
  if (topPct <= 10) return 'S';
  if (topPct <= 30) return 'A';
  if (topPct <= 70) return 'B';
  if (topPct <= 90) return 'C';
  return 'D';
}

function main() {
  const [membersFile, legFile, voteFile, attFile, committeeFile, outFile] = process.argv.slice(2);
  const members = JSON.parse(fs.readFileSync(membersFile, 'utf8'))[0].results;
  const leg = JSON.parse(fs.readFileSync(legFile, 'utf8'))[0].results;
  const votes = JSON.parse(fs.readFileSync(voteFile, 'utf8'))[0].results;
  const att = JSON.parse(fs.readFileSync(attFile, 'utf8'))[0].results;
  const committee = JSON.parse(fs.readFileSync(committeeFile, 'utf8'))[0].results;

  const legById = new Map(leg.map((r) => [r.member_id, r]));
  const voteById = new Map(votes.map((r) => [r.member_id, r]));
  const attById = new Map(att.map((r) => [r.member_id, r]));
  const committeeById = new Map(committee.map((r) => [r.member_id, r]));

  const eligible = [];
  const ineligible = [];
  for (const m of members) {
    if (m.tenure_days >= MIN_TENURE_DAYS) eligible.push(m);
    else ineligible.push(m);
  }

  const legValues = eligible.map((m) => ({ id: m.id, value: legById.get(m.id)?.weighted_score ?? null }));
  const voteValues = eligible.map((m) => ({ id: m.id, value: voteById.get(m.id)?.participation_rate ?? null }));
  const attValues = eligible.map((m) => ({ id: m.id, value: attById.get(m.id)?.attendance_rate ?? null }));
  const committeeValues = eligible.map((m) => ({ id: m.id, value: committeeById.get(m.id)?.attendance_rate ?? null }));

  const legPct = percentileRank(legValues);
  const votePct = percentileRank(voteValues);
  const attPct = percentileRank(attValues);
  const committeePct = percentileRank(committeeValues);

  const composite = eligible.map((m) => {
    const lp = legPct.get(m.id);
    const vp = votePct.get(m.id);
    const ap = attPct.get(m.id);
    const cp = committeePct.get(m.id);
    // Core three pillars (legislation/vote/plenary attendance) are required;
    // a member missing any of those gets no composite score (do not silently
    // drop a required pillar). Committee attendance is optional: if missing
    // (e.g. too recently seated), its 10% weight is redistributed
    // proportionally across the other three rather than scored as zero.
    let comp = null;
    if (lp !== null && vp !== null && ap !== null) {
      if (cp !== null) {
        comp = lp * WEIGHTS.legislation + vp * WEIGHTS.vote + ap * WEIGHTS.attendance + cp * WEIGHTS.committee;
      } else {
        const coreTotal = WEIGHTS.legislation + WEIGHTS.vote + WEIGHTS.attendance;
        comp = (lp * WEIGHTS.legislation + vp * WEIGHTS.vote + ap * WEIGHTS.attendance) / coreTotal;
      }
    }
    return { id: m.id, lp, vp, ap, cp, comp };
  });

  const compValues = composite.map((c) => ({ id: c.id, value: c.comp }));
  const compPct = percentileRank(compValues);

  // rank: 1 = best composite percentile; ties share rank (standard competition ranking)
  const ranked = [...composite].filter((c) => c.comp !== null).sort((a, b) => b.comp - a.comp);
  const rankMap = new Map();
  let rank = 1;
  for (let i = 0; i < ranked.length; i++) {
    if (i > 0 && ranked[i].comp === ranked[i - 1].comp) {
      rankMap.set(ranked[i].id, rankMap.get(ranked[i - 1].id));
    } else {
      rankMap.set(ranked[i].id, i + 1);
    }
  }

  const lines = [];
  const createdAt = new Date().toISOString();
  // D1 executes each statement in its own implicit transaction when run via
  // `wrangler d1 execute --file`, so last_insert_rowid() is not reliable across
  // statements in a batch; use an explicit run_id value (process start time, ms)
  // computed in JS instead, and let the DB autoincrement ignore it only if unique.
  const runId = Date.now();
  lines.push(
    `INSERT INTO score_runs (id, formula_version, legislation_weight, vote_weight, attendance_weight, committee_attendance_weight, min_tenure_days, created_at) VALUES (${runId}, '${FORMULA_VERSION}', ${WEIGHTS.legislation}, ${WEIGHTS.vote}, ${WEIGHTS.attendance}, ${WEIGHTS.committee}, ${MIN_TENURE_DAYS}, '${createdAt}');`
  );
  for (const m of ineligible) {
    lines.push(
      `INSERT INTO member_scores (run_id, member_id, eligible, legislation_percentile, vote_percentile, attendance_percentile, committee_attendance_percentile, composite_percentile, rank, grade) VALUES (${runId}, '${m.id}', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`
    );
  }
  for (const c of composite) {
    const g = grade(compPct.get(c.id));
    const r = rankMap.get(c.id) ?? null;
    const fmt = (x) => (x === null || x === undefined ? 'NULL' : x);
    lines.push(
      `INSERT INTO member_scores (run_id, member_id, eligible, legislation_percentile, vote_percentile, attendance_percentile, committee_attendance_percentile, composite_percentile, rank, grade) VALUES (${runId}, '${c.id}', 1, ${fmt(c.lp)}, ${fmt(c.vp)}, ${fmt(c.ap)}, ${fmt(c.cp)}, ${fmt(compPct.get(c.id))}, ${fmt(r)}, ${g ? `'${g}'` : 'NULL'});`
    );
  }

  fs.writeFileSync(outFile, lines.join('\n'));
  console.log('eligible:', eligible.length, 'ineligible:', ineligible.length, 'sql rows:', lines.length);
}

main();
