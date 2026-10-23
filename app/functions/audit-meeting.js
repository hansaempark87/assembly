// GET /audit-meeting?id=… — once the meeting has a summary, make the page indexable
// and give crawlers its text; without one it stays noindex as served.
import { loadMeeting, rewrite } from '../lib/audit-seo.js';

export async function onRequestGet({ env, request, next }) {
  const res = await next();
  if (!res.headers.get('content-type')?.includes('text/html')) return res;
  const url = new URL(request.url);
  const D = await loadMeeting(env, url);
  if (!D || !D.summary || !D.summary.overview) return res;
  return rewrite(res, D, url, false);
}
