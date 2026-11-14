// GET /member?id=… — per-member title, description, canonical URL and a
// server-rendered summary, so each member page is indexable and shares with a
// meaningful preview. The client script replaces #content after loading.
import { run } from '../lib/scoring.js';
import { loadAll, memberSummary, esc, setHtml, setText, setAttr, appendHtml } from '../lib/seo.js';

const RESULT = { passed: '가결', alt: '대안반영', withdrawn: '철회', rejected: '부결', pending: '계류' };

async function asset(env, url, path) {
  try {
    const r = await env.ASSETS.fetch(new URL(path, url));
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// the member's own bills (newest first, reflected ones first) and their audit questioning
async function extra(env, url, m) {
  const [bills, audit] = await Promise.all([asset(env, url, `/bills/${encodeURIComponent(m.id)}.json`), asset(env, url, '/audit.json')]);
  let out = '';
  const lead = (bills?.bills || []).filter((b) => !b.co);
  if (lead.length) {
    const done = lead.filter((b) => b.status === 'passed' || b.status === 'alt');
    const pick = [...done.slice(0, 5), ...lead.filter((b) => !done.includes(b)).slice(0, 10 - Math.min(5, done.length))];
    out += `<section class="card"><h2>${esc(m.name)} 의원이 대표발의한 법안</h2>
      <p>대표발의 ${lead.length}건 가운데 법에 반영된 법안과 최근 발의한 법안입니다.</p><ul>${pick.map((b) =>
        `<li><b>${esc(b.name)}</b> <span class="muted">${esc(b.area || '')} · 발의 ${esc(b.proposed || '')} · ${esc(RESULT[b.status] || b.status || '')}${b.decided ? ` ${esc(b.decided)}` : ''}</span></li>`).join('')}</ul></section>`;
  }
  const rows = audit ? Object.entries(audit.years).map(([y, v]) => [y, v.members?.[m.id]]).filter(([, r]) => r) : [];
  if (rows.length) {
    out += `<section class="card"><h2>국정감사 질의</h2><ul>${rows.map(([y, [turns, chars, days]]) =>
      `<li>${esc(y)}년 국정감사: ${days}일 동안 ${turns}회 발언, 질의 ${chars.toLocaleString('ko-KR')}자</li>`).join('')}</ul></section>`;
  }
  return out;
}

export async function onRequestGet({ request, next, env }) {
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
    .on('#content', setHtml(html + (await extra(env, url, m))))
    .transform(res);
}
