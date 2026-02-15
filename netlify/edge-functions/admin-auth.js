const LOGIN_PATH = '/admin/login';

function parseCookies(header) {
  const out = Object.create(null);
  const value = String(header || '');
  if (!value) return out;

  for (const part of value.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export default async (request) => {
  const url = new URL(request.url);

  if (url.pathname.startsWith(LOGIN_PATH)) {
    return;
  }

  const expected = Deno.env.get('ADMIN_TOKEN') || '';
  if (!expected) {
    return new Response('Missing ADMIN_TOKEN env var.', { status: 500 });
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  if (cookies.admin_auth === expected) {
    return;
  }

  return Response.redirect(new URL('/admin/login', url.origin), 302);
};
