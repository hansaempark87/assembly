// GET /laws — headline counts and bill lists rendered on the server for crawlers.
import { setHtml } from '../lib/seo.js';
import { lawsHome } from '../lib/page-seo.js';

export async function onRequestGet({ env, request, next }) {
  const res = await next();
  if (!res.headers.get('content-type')?.includes('text/html')) return res;
  let d;
  try {
    const r = await env.ASSETS.fetch(new URL('/law-data/home.json', request.url));
    if (!r.ok) return res;
    d = await r.json();
  } catch {
    return res;
  }
  const h = lawsHome(d);
  return new HTMLRewriter()
    .on('#meta', setHtml(h.meta))
    .on('#clash', setHtml(h.clash))
    .on('#recent', setHtml(h.recent))
    .on('#popular', setHtml(h.popular))
    .transform(res);
}
