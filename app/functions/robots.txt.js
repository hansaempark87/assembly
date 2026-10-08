// GET /robots.txt — allow pages, keep the JSON API out of search results.
export function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
