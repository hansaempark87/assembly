// GET /sitemap.xml — static pages, the guide articles and one URL per member.
// Individual vote and audit-meeting pages are left out (and marked noindex):
// they are mostly numbers, and AdSense counts thin pages against the site.
import { run, allMembers } from '../lib/scoring.js';

export const GUIDES = ['bill-process', 'vote', 'attendance', 'audit', 'grades', 'my-member'];

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const lastmod = (run.data_as_of || run.created_at).slice(0, 10);
  const urls = ['/', '/members', '/guide/', '/audit', '/votes', '/laws', '/quiz', '/region', '/party', '/compare', '/method', '/notes', '/about', '/privacy', '/terms']
    .map((p) => [`${origin}${p}`, lastmod])
    .concat(GUIDES.map((g) => [`${origin}/guide/${g}`, lastmod]))
    .concat(allMembers().map((m) => [`${origin}/member?id=${encodeURIComponent(m.id)}`, lastmod]));
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(([u, d]) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc><lastmod>${d}</lastmod></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
