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

  const cookie = 'admin_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
  return json(200, { ok: true }, { 'Set-Cookie': cookie });
};
