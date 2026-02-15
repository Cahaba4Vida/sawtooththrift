const Stripe = require('stripe');
const { withTransaction } = require('./_db');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function getHeader(event, key) {
  const headers = (event && event.headers) || {};
  const direct = headers[key];
  if (direct) return direct;
  const match = Object.keys(headers).find((k) => String(k).toLowerCase() === String(key).toLowerCase());
  return match ? headers[match] : '';
}

function parseCart(session) {
  try {
    const raw = session && session.metadata ? session.metadata.cart : '[]';
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => ({ productId: String((x && x.productId) || '').trim(), qty: Number(x && x.qty) }))
      .filter((x) => x.productId && Number.isInteger(x.qty) && x.qty > 0);
  } catch (_) {
    return [];
  }
}

async function applyInventoryForSession(sessionId, cart, transactionRunner = withTransaction) {
  await transactionRunner(async (client) => {
    const exists = await client.query('SELECT 1 FROM processed_stripe_sessions WHERE session_id=$1', [sessionId]);
    if (exists.rows.length) return { applied: false };

    for (const item of cart) {
      await client.query(
        `UPDATE products
         SET inventory = GREATEST(0, inventory - $2),
             updated_at = now()
         WHERE id = $1`,
        [item.productId, item.qty]
      );
    }

    await client.query('INSERT INTO processed_stripe_sessions (session_id) VALUES ($1)', [sessionId]);
    return { applied: true };
  });
}

exports.handler = async (event) => {
  try {
    if (!event || event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return json(500, { ok: false, error: 'Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const signature = getHeader(event, 'stripe-signature');
    if (!signature) return json(400, { ok: false, error: 'Missing stripe-signature' });

    const payload = event.body || '';
    const evt = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);

    if (evt.type !== 'checkout.session.completed') return json(200, { ok: true, ignored: true });

    const session = evt.data && evt.data.object ? evt.data.object : null;
    if (!session || session.payment_status !== 'paid') return json(200, { ok: true, ignored: true });

    const cart = parseCart(session);
    const sessionId = String(session.id || '').trim();
    if (!sessionId) return json(200, { ok: true, ignored: true });

    await applyInventoryForSession(sessionId, cart);
    return json(200, { ok: true });
  } catch (err) {
    return json(400, { ok: false, error: err.message || 'Webhook error' });
  }
};

exports.__testOnly = {
  parseCart,
  applyInventoryForSession,
};
