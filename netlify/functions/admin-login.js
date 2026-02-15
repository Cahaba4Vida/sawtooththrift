function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return json(500, { ok: false, error: 'Missing ADMIN_TOKEN env var.' });

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch (_) { body = {}; }
  const token = String(body.token || '');

  if (token !== expected) {
    return json(401, { ok: false, error: 'Invalid token.' });
  }

  const isProd = process.env.NODE_ENV === 'production' || process.env.CONTEXT === 'production';
  const secure = isProd ? 'Secure; ' : '';
  const cookie = `admin_auth=${encodeURIComponent(expected)}; ${secure}HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;

  return json(200, { ok: true }, { 'Set-Cookie': cookie });
};
