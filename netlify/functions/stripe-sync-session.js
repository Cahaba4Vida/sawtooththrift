const Stripe = require('stripe');
const { __testOnly } = require('./stripe-webhook');

const { resolveCart, applyInventoryForSession } = __testOnly;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function parseBody(event) {
  if (!event || !event.body) return {};
  try { return JSON.parse(event.body); } catch { return {}; }
}

exports.handler = async (event) => {
  try {
    if (!event || event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });
    if (!process.env.STRIPE_SECRET_KEY) return json(500, { ok: false, error: 'Missing STRIPE_SECRET_KEY' });

    const body = parseBody(event);
    const sessionId = String(body.sessionId || body.session_id || '').trim();
    if (!sessionId) return json(400, { ok: false, error: 'Missing sessionId' });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== 'paid') {
      return json(200, { ok: true, ignored: true, reason: 'unpaid_or_missing' });
    }

    const cart = await resolveCart(stripe, session);
    await applyInventoryForSession(sessionId, cart);

    return json(200, { ok: true, synced: true });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};
