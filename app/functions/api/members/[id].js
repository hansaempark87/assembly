// GET /api/members/:id — one member, same shape as the list endpoint.
import { run, allMembers, memberById } from '../../../lib/scoring.js';

export async function onRequestGet({ params }) {
  const member = memberById(params.id);
  if (!member) return Response.json({ error: 'member not found' }, { status: 404 });
  const totalEligibleMembers = allMembers().filter((m) => m.eligible).length;
  return Response.json({ run, gradeDatasetApproved: true, totalEligibleMembers, member });
}
