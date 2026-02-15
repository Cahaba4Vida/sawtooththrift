const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    requireAdmin(event);
  } catch (err) {
    return authErrorResponse(err);
  }

  const siteUrlRaw = process.env.URL || process.env.SITE_URL || ((event && event.headers && (event.headers.origin || event.headers.Origin)) || '');
  const siteUrl = String(siteUrlRaw || '').replace(/\/+$/, '');

  return json(200, {
    ok: true,
    stripeKeyPresent: Boolean(process.env.STRIPE_SECRET_KEY),
    siteUrl,
    timestamp: new Date().toISOString(),
  });
};
