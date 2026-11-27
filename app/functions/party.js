// GET /party — party comparison cards rendered on the server for crawlers.
import { run } from '../lib/scoring.js';
import { loadAll, setHtml, setText } from '../lib/seo.js';
import { partyCards } from '../lib/page-seo.js';

export async function onRequestGet({ next }) {
  const res = await next();
  if (!res.headers.get('content-type')?.includes('text/html')) return res;
  const members = loadAll();
  return new HTMLRewriter()
    .on('#meta', setText(`${run.data_as_of} 기준 · 제22대 국회의원 ${members.length}명`))
    .on('#parties', setHtml(`<div class="grid grid-2">${partyCards(members)}</div>`))
    .transform(res);
}
