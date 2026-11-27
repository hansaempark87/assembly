// GET /quiz — for a shared result (?s=answers) the link preview shows that
// result: a card for the answerer's leaning and the most similar member's name.
import { setAttr, appendHtml } from '../lib/seo.js';
import { quizResult } from '../lib/quiz-score.js';

export async function onRequestGet({ env, request, next }) {
  const res = await next();
  const url = new URL(request.url);
  const code = url.searchParams.get('s');
  if (!code || !res.headers.get('content-type')?.includes('text/html')) return res;
  let r = null;
  try {
    const d = await env.ASSETS.fetch(new URL('/quiz-data.json', url));
    if (d.ok) r = quizResult(await d.json(), code);
  } catch {
    r = null;
  }
  if (!r || !r.lean) return res;
  const title = `내 표결 성향은 '${r.lean.label}'${r.top ? ` · 나와 닮은 의원은 ${r.top.name}` : ''}`;
  const desc = `${r.top ? `${r.top.name} 의원과 ${Math.round(r.top.rate * 100)}% 같은 선택을 했어요. ` : ''}찬반이 갈렸던 실제 법안 10개로 보는 나의 성향, 너도 해볼래?`;
  return new HTMLRewriter()
    .on('meta[property="og:title"]', setAttr('content', title))
    .on('meta[property="og:description"]', setAttr('content', desc))
    .on('meta[property="og:image"]', setAttr('content', `${url.origin}/og/q/${r.lean.key}.png`))
    .on('head', appendHtml('<meta name="robots" content="noindex, follow">'))
    .transform(res);
}
