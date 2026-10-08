// GET /api/members — every member with raw counts, the bundled score run and
// any state-office period. Raw numerator/denominator always travel with the
// grade so the UI can show "why" without implying more precision than exists.
import { MEMBER_SQL, run, withScores, byRank } from '../../../lib/scoring.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(MEMBER_SQL).all();
  const members = results.map(withScores).sort(byRank);
  return Response.json({ run, gradeDatasetApproved: true, count: members.length, members });
}
