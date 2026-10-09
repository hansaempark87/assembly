// GET /vote?id=… — per-vote title, description and canonical URL for search
// crawlers and link previews; the client script draws the seat chart.
import { esc, setText, setAttr, appendHtml } from '../lib/seo.js';

export async function onRequestGet({ env, request, next }) {
  const res = await next();
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[A-Z0-9_]+$/.test(id) || !res.headers.get('content-type')?.includes('text/html')) return res;
  let v;
  try {
    const r = await env.ASSETS.fetch(new URL(`/vote-data/${id}.json`, url.origin));
    if (!r.ok) return res;
    v = await r.json();
  } catch {
    return res;
  }
  const [y, n, a, x] = v.counts;
  const title = `${v.name} 표결 결과 — 일하는 국회`;
  const description = `${v.date} 본회의 ${v.result || ''} · 찬성 ${y} · 반대 ${n} · 기권 ${a} · 불참 ${x}. 의원별 찬반과 정당별 표결을 의석 그림으로 봅니다.`;
  const canonical = `${url.origin}/vote?id=${encodeURIComponent(id)}`;
  return new HTMLRewriter()
    .on('title', setText(title))
    .on('meta[name="description"]', setAttr('content', description))
    .on('meta[property="og:title"]', setAttr('content', title))
    .on('meta[property="og:description"]', setAttr('content', description))
    .on('meta[property="og:image"]', setAttr('content', `${url.origin}/og/${v.og ? `v/${id}.png` : 'vote.png'}`))
    .on('head', appendHtml(`<link rel="canonical" href="${esc(canonical)}"><meta property="og:url" content="${esc(canonical)}">`))
    .on('#title', setText(v.name))
    .on('#meta', setText(description))
    .transform(res);
}
