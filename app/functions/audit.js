// GET /audit — this year's audit status, top questioners and schedule rendered
// on the server for crawlers.
import { setHtml } from '../lib/seo.js';
import { auditStatus } from '../lib/page-seo.js';

export async function onRequestGet({ env, request, next }) {
  const res = await next();
  if (!res.headers.get('content-type')?.includes('text/html')) return res;
  let d;
  try {
    const r = await env.ASSETS.fetch(new URL('/audit.json', request.url));
    if (!r.ok) return res;
    d = await r.json();
  } catch {
    return res;
  }
  const h = auditStatus(d);
  return new HTMLRewriter()
    .on('#status', setHtml(h.status))
    .on('#speak-card', { element: (el) => el.removeAttribute('hidden') })
    .on('#speak', setHtml(h.speak))
    .on('#sched', setHtml(h.sched))
    .transform(res);
}
