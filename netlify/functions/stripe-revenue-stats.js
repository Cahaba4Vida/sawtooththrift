const Stripe = require('stripe');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function summarizeSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const grossCents = list.reduce((sum, s) => sum + (Number.isFinite(Number(s.amount_total)) ? Number(s.amount_total) : 0), 0);
  const orderCount = list.length;
  const avgOrderCents = orderCount > 0 ? Math.round(grossCents / orderCount) : 0;
  return { grossCents, orderCount, avgOrderCents };
}

async function listPaidSessions(stripe, createdGteUnix) {
  const out = [];
  let startingAfter = null;

  while (true) {
    const resp = await stripe.checkout.sessions.list({
      limit: 100,
      payment_status: 'paid',
      ...(createdGteUnix ? { created: { gte: createdGteUnix } } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const rows = Array.isArray(resp.data) ? resp.data : [];
    out.push(...rows);

    if (!resp.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1].id;
  }

  return out;
}

exports.handler = async (event) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method Not Allowed' });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return json(500, { ok: false, error: 'Missing STRIPE_SECRET_KEY env var.' });

    const stripe = new Stripe(secretKey);
    const now = Math.floor(Date.now() / 1000);
    const since7d = now - (7 * 24 * 60 * 60);
    const since30d = now - (30 * 24 * 60 * 60);

    const [sessions7d, sessions30d] = await Promise.all([
      listPaidSessions(stripe, since7d),
      listPaidSessions(stripe, since30d),
    ]);

    const stats7d = summarizeSessions(sessions7d);
    const stats30d = summarizeSessions(sessions30d);

    return json(200, {
      ok: true,
      stats: {
        generated_at_unix: now,
        window_7d: stats7d,
        window_30d: stats30d,
      },
    });
  } catch (err) {
    return json(500, { ok: false, error: err && err.message ? err.message : 'Server error' });
  }
};
