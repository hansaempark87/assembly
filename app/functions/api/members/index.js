// GET /api/members — latest-run leaderboard, sorted by rank.
// Always returns raw numerator/denominator alongside grade/percentile so the
// UI can show "why" and never implies more precision than the data supports.
export async function onRequestGet({ env }) {
  const db = env.DB;

  const runRow = await db
    .prepare('SELECT id, formula_version, legislation_weight, vote_weight, attendance_weight, min_tenure_days, created_at FROM score_runs ORDER BY id DESC LIMIT 1')
    .first();

  if (!runRow) {
    return Response.json({ error: 'no score run available yet' }, { status: 503 });
  }

  const { results } = await db
    .prepare(
      `SELECT
         m.id, m.name, m.hanja_name, m.party, m.district, m.committee,
         m.term_start, m.term_end, m.tenure_days,
         l.lead_count, l.lead_passed, l.lead_alternative, l.lead_withdrawn, l.lead_rejected, l.lead_pending, l.co_lead_count,
         v.eligible_count as vote_eligible, v.participated_count as vote_participated, v.excluded_count as vote_excluded, v.participation_rate,
         a.meetings_total as attendance_meetings, a.present_count as attendance_present, a.absent_count, a.leave_count, a.travel_count, a.attendance_rate,
         s.eligible, s.legislation_percentile, s.vote_percentile, s.attendance_percentile, s.composite_percentile, s.rank, s.grade
       FROM members m
       JOIN member_scores s ON s.member_id = m.id AND s.run_id = ?
       LEFT JOIN member_legislation l ON l.member_id = m.id
       LEFT JOIN member_votes v ON v.member_id = m.id
       LEFT JOIN member_attendance a ON a.member_id = m.id
       ORDER BY (s.rank IS NULL), s.rank ASC, m.name ASC`
    )
    .bind(runRow.id)
    .all();

  return Response.json({
    run: runRow,
    gradeDatasetApproved: false,
    count: results.length,
    members: results,
  });
}
