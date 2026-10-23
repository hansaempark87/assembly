// GET / — the dashboard shell plus a server-rendered overview (key figures,
// top and bottom members) so the page has real content for search crawlers
// before the client script runs.
import { loadAll, homeSummary, setHtml, setText } from '../lib/seo.js';
import { run } from '../lib/scoring.js';

export async function onRequestGet({ next }) {
  const res = await next();
  if (!res.headers.get('content-type')?.includes('text/html')) return res;
  const members = loadAll();
  const evaluated = members.filter((m) => m.eligible).length;
  return new HTMLRewriter()
    .on('#run-info', setText(`${run.data_as_of} 기준 · 제22대 국회의원 ${members.length}명 중 ${evaluated}명 평가`))
    .on('#ssr-summary', setHtml(homeSummary(members)))
    .transform(res);
}
