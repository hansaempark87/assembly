// GET /api/compare?a=ID1&b=ID2 — two members side by side, same shape as /api/members.
import { run, memberById } from '../../lib/scoring.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const aId = url.searchParams.get('a');
  const bId = url.searchParams.get('b');
  if (!aId || !bId) {
    return Response.json({ error: 'query params a and b (member ids) are required' }, { status: 400 });
  }
  const a = memberById(aId);
  const b = memberById(bId);
  if (!a || !b) {
    return Response.json({ error: 'one or both member ids not found', found: { a: !!a, b: !!b } }, { status: 404 });
  }
  return Response.json({ run, gradeDatasetApproved: true, a, b });
}
