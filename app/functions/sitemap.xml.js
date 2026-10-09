// GET /sitemap.xml — static pages plus one URL per member.
import { run, allMembers } from '../lib/scoring.js';

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const lastmod = (run.data_as_of || run.created_at).slice(0, 10);
  const urls = ['/', '/compare', '/method', '/notes', '/about', '/privacy', '/terms']
    .map((p) => `${origin}${p}`)
    .concat(allMembers().map((m) => `${origin}/member?id=${encodeURIComponent(m.id)}`));
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
