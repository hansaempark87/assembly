// GET /sitemap.xml — static pages, one URL per member and one per plenary vote.
import { run, allMembers } from '../lib/scoring.js';

export async function onRequestGet({ env, request }) {
  const origin = new URL(request.url).origin;
  const lastmod = (run.data_as_of || run.created_at).slice(0, 10);
  let votes = [];
  try {
    const r = await env.ASSETS.fetch(new URL('/vote-data/index.json', origin));
    if (r.ok) votes = (await r.json()).votes;
  } catch {
    votes = [];
  }
  const urls = ['/', '/votes', '/region', '/party', '/compare', '/method', '/notes', '/about', '/privacy', '/terms']
    .map((p) => [`${origin}${p}`, lastmod])
    .concat(allMembers().map((m) => [`${origin}/member?id=${encodeURIComponent(m.id)}`, lastmod]))
    .concat(votes.map((v) => [`${origin}/vote?id=${encodeURIComponent(v.id)}`, v.date]));
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(([u, d]) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc><lastmod>${d}</lastmod></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
