// GET /api/members/:id — one member, same shape as the list endpoint.
import { MEMBER_SQL, run, withScores } from '../../../lib/scoring.js';

export async function onRequestGet({ env, params }) {
  const row = await env.DB.prepare(`${MEMBER_SQL} WHERE m.id = ?`).bind(params.id).first();
  if (!row) return Response.json({ error: 'member not found' }, { status: 404 });
  const { results } = await env.DB.prepare('SELECT id FROM members').all();
  const totalEligibleMembers = results.filter((r) => withScores(r).eligible).length;
  return Response.json({ run, gradeDatasetApproved: true, totalEligibleMembers, member: withScores(row) });
}
