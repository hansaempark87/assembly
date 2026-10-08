// GET /api/compare?a=ID1&b=ID2 — two members side by side, same shape as /api/members.
import { MEMBER_SQL, run, withScores } from '../../lib/scoring.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const aId = url.searchParams.get('a');
  const bId = url.searchParams.get('b');
  if (!aId || !bId) {
    return Response.json({ error: 'query params a and b (member ids) are required' }, { status: 400 });
  }
  const stmt = env.DB.prepare(`${MEMBER_SQL} WHERE m.id = ?`);
  const [a, b] = await Promise.all([stmt.bind(aId).first(), stmt.bind(bId).first()]);
  if (!a || !b) {
    return Response.json({ error: 'one or both member ids not found', found: { a: !!a, b: !!b } }, { status: 404 });
  }
  return Response.json({ run, gradeDatasetApproved: true, a: withScores(a), b: withScores(b) });
}
