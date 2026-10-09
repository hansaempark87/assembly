// One public address: the old pages.dev address and www send visitors (and
// search engines) to https://assembly-korea.com with a permanent redirect.
// Branch previews (<branch>.assembly-dashboard.pages.dev) are left alone.
const CANONICAL = 'assembly-korea.com';
const ALIASES = new Set(['assembly-dashboard.pages.dev', `www.${CANONICAL}`]);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (ALIASES.has(url.hostname)) {
    url.hostname = CANONICAL;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
