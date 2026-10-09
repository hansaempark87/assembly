// GET /api/members — every member with raw counts, the bundled score run and
// any state-office period. Raw numerator/denominator always travel with the
// grade so the UI can show "why" without implying more precision than exists.
import { run, allMembers } from '../../../lib/scoring.js';

export async function onRequestGet() {
  const members = allMembers();
  return Response.json({ run, gradeDatasetApproved: true, count: members.length, members });
}
