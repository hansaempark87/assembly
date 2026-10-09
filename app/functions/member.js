// GET /member?id=… — per-member title, description, canonical URL and a
// server-rendered summary, so each member page is indexable and shares with a
// meaningful preview. The client script replaces #content after loading.
import { run } from '../lib/scoring.js';
import { loadAll, memberSummary, esc, setHtml, setText, setAttr, appendHtml } from '../lib/seo.js';

export async function onRequestGet({ request, next }) {
  const res = await next();
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id || !res.headers.get('content-type')?.includes('text/html')) return res;
  const members = loadAll();
  const m = members.find((x) => x.id === id);
  if (!m) return res;
  const { title, description, html } = memberSummary(m, members.filter((x) => x.eligible).length);
  const canonical = `${url.origin}/member?id=${encodeURIComponent(id)}`;
  return new HTMLRewriter()
    .on('title', setText(title))
    .on('meta[name="description"]', setAttr('content', description))
    .on('meta[property="og:title"]', setAttr('content', title))
    .on('meta[property="og:description"]', setAttr('content', description))
    .on('meta[property="og:image"]', setAttr('content', `${url.origin}/og/m/${encodeURIComponent(id)}.png?v=${run.data_as_of}`))
    .on('head', appendHtml(`<link rel="canonical" href="${esc(canonical)}"><meta property="og:url" content="${esc(canonical)}">`))
    .on('#content', setHtml(html))
    .transform(res);
}
