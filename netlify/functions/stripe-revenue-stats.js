const Stripe = require('stripe');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const DAY_SECONDS = 24 * 60 * 60;

function isPaidSession(session) {
  if (!session || session.payment_status !== 'paid') return false;
  if (typeof session.status === 'string' && session.status !== 'complete') return false;
  return true;
}

function sessionAmountCents(session) {
  return Number.isFinite(Number(session && session.amount_total)) ? Number(session.amount_total) : 0;
}

function summarizeSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const revenue_cents = list.reduce((sum, s) => sum + sessionAmountCents(s), 0);
  const orders = list.length;
  const aov_cents = orders > 0 ? Math.round(revenue_cents / orders) : 0;
  return { revenue_cents, orders, aov_cents };
}

function unixToDateKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

async function listCheckoutSessionsSince(stripe, createdGteUnix) {
  const out = [];
  let startingAfter = null;

  while (true) {
    const resp = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: createdGteUnix },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const rows = Array.isArray(resp.data) ? resp.data : [];
    out.push(...rows);

    if (!resp.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1].id;
  }

  return out;
}

function buildDailySeries(sessions, startUnix, endUnix) {
  const byDate = new Map();

  for (const session of sessions) {
    if (!session || !Number.isFinite(Number(session.created))) continue;
    const created = Number(session.created);
    if (created < startUnix || created > endUnix) continue;

    const key = unixToDateKey(created);
    const current = byDate.get(key) || { date: key, revenue_cents: 0, orders: 0 };
    current.revenue_cents += sessionAmountCents(session);
    current.orders += 1;
    byDate.set(key, current);
  }

  const daily = [];
  for (let day = startUnix; day <= endUnix; day += DAY_SECONDS) {
    const key = unixToDateKey(day);
    daily.push(byDate.get(key) || { date: key, revenue_cents: 0, orders: 0 });
  }

  return daily;
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
    if (!secretKey) return json(500, { ok: false, error: 'Stripe is not configured yet. Please set STRIPE_SECRET_KEY.' });

    const now = Math.floor(Date.now() / 1000);
    const start30 = now - (30 * DAY_SECONDS);
    const start7 = now - (7 * DAY_SECONDS);
    const start14 = now - (14 * DAY_SECONDS);

    let sessions;
    try {
      const stripe = new Stripe(secretKey);
      sessions = await listCheckoutSessionsSince(stripe, start30);
    } catch (err) {
      return json(502, {
        ok: false,
        error: err && err.message ? `Stripe API error: ${err.message}` : 'Stripe API request failed.',
      });
    }

    const paidSessions = sessions.filter(isPaidSession);
    const paidLast7 = paidSessions.filter((s) => Number(s.created) >= start7);
    const paidLast30 = paidSessions.filter((s) => Number(s.created) >= start30);

    const last7 = summarizeSessions(paidLast7);
    const last30 = summarizeSessions(paidLast30);
    const daily = buildDailySeries(paidSessions, start14, now);

    console.log(`paid_sessions=${paidLast30.length}, revenue_last30=${last30.revenue_cents}`);

    return json(200, {
      ok: true,
      kpis: {
        last7: { revenue_cents: last7.revenue_cents, orders: last7.orders },
        last30: { revenue_cents: last30.revenue_cents, orders: last30.orders, aov_cents: last30.aov_cents },
      },
      daily,
      stats: {
        generated_at_unix: now,
        window_7d: { grossCents: last7.revenue_cents, orderCount: last7.orders, avgOrderCents: last7.aov_cents },
        window_30d: { grossCents: last30.revenue_cents, orderCount: last30.orders, avgOrderCents: last30.aov_cents },
      },
    });
  } catch (err) {
    return json(500, { ok: false, error: err && err.message ? err.message : 'Server error' });
  }
};
