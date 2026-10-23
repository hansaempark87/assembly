// Server-side text for the audit meeting and summary pages. A meeting is only
// worth indexing once it has a summary: until then the page stays noindex.
import { esc } from './seo.js';

const kday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };

export async function loadMeeting(env, url) {
  const id = url.searchParams.get('id');
  if (!id || !/^[A-Z0-9]+$/.test(id)) return null;
  try {
    const r = await env.ASSETS.fetch(new URL(`/audit-data/${id}.json`, url.origin));
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const who = (D, mid) => (D.people[mid] || [mid])[0];

export function meetingText(D, full) {
  const ov = D.summary.overview;
  const issues = (ov.issues || []).map((t) => (typeof t === 'string' ? { title: t, detail: '' } : t));
  const head = `<h1>${esc(D.committee)} 국정감사 · ${kday(D.date)}</h1>${D.agencies ? `<p>감사 대상: ${esc(D.agencies)}</p>` : ''}`;
  if (!full) {
    return `<section class="card">${head}<h2>핵심 요약</h2><p>${esc(ov.brief || ov.headline)}</p>
      <p>질의한 위원: ${D.speakers.map(([mid]) => esc(who(D, mid))).join(', ')}</p></section>`;
  }
  const members = D.speakers.filter(([mid]) => D.summary.members[mid] && D.summary.members[mid].length)
    .map(([mid]) => `<h3>${esc(who(D, mid))} 위원</h3><ul>${D.summary.members[mid].map((t) => `<li>질의: ${esc(t.q)} / 답변: ${esc(t.a)}</li>`).join('')}</ul>`).join('');
  return `<section class="card">${head}<h2>${esc(ov.headline)}</h2><p>${esc(ov.summary)}</p>
    <h2>쟁점별 정리</h2><ol>${issues.map((t) => `<li><b>${esc(t.title)}</b> ${esc(t.detail)}</li>`).join('')}</ol>
    <h2>위원별 질의와 답변</h2>${members}</section>`;
}

export function rewrite(res, D, url, full) {
  const ov = D.summary.overview;
  const title = full ? `${ov.headline} — ${D.committee} 국정감사 ${kday(D.date)} AI 요약 | 일하는 국회`
    : `${D.committee} 국정감사 ${kday(D.date)} — 핵심 요약 | 일하는 국회`;
  const description = ov.brief || ov.headline;
  const canonical = `${url.origin}${url.pathname}?id=${encodeURIComponent(D.id)}`;
  const set = (name, value) => ({ element: (el) => el.setAttribute(name, value) });
  return new HTMLRewriter()
    .on('meta[name="robots"]', { element: (el) => el.remove() })
    .on('title', { element: (el) => el.setInnerContent(title) })
    .on('meta[name="description"]', set('content', description))
    .on('meta[property="og:title"]', set('content', title))
    .on('meta[property="og:description"]', set('content', description))
    .on('head', { element: (el) => el.append(`<link rel="canonical" href="${esc(canonical)}">`, { html: true }) })
    .on('#am', { element: (el) => el.setInnerContent(meetingText(D, full), { html: true }) })
    .transform(res);
}
