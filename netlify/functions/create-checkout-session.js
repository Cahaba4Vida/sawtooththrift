const Stripe = require('stripe');
const { query } = require('./_db');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function parseBody(event) {
  if (!event || !event.body) return {};
  try { return JSON.parse(event.body); } catch { throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }); }
}

function normalizeItems(body) {
  if (Array.isArray(body.items)) return body.items;
  if (body && (body.productId != null || body.qty != null)) return [{ productId: body.productId, qty: body.qty }];
  return [];
}

function getHeader(event, key) {
  const headers = (event && event.headers) || {};
  const direct = headers[key];
  if (direct) return String(direct);
  const match = Object.keys(headers).find((k) => String(k).toLowerCase() === String(key).toLowerCase());
  return match ? String(headers[match]) : '';
}

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function normalizeBaseUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
}

function getBaseUrl(event) {
  const origin = normalizeBaseUrl(firstHeaderValue(getHeader(event, 'origin')));
  if (origin) return origin;

  const proto = firstHeaderValue(getHeader(event, 'x-forwarded-proto')) || 'https';
  const host = firstHeaderValue(getHeader(event, 'x-forwarded-host')) || firstHeaderValue(getHeader(event, 'host'));
  if (host) {
    const fromForwarded = normalizeBaseUrl(`${proto}://${host}`);
    if (fromForwarded) return fromForwarded;
  }

  const fromEnv = normalizeBaseUrl(process.env.URL || process.env.SITE_URL || process.env.DEPLOY_PRIME_URL || '');
  if (fromEnv) return fromEnv;

  return 'https://sawtooththrift.com';
}

exports.handler = async (event) => {
  try {
    if (!event || event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });
    if (!process.env.STRIPE_SECRET_KEY) return json(500, { ok: false, error: 'Missing STRIPE_SECRET_KEY' });

    const body = parseBody(event);
    const rawItems = normalizeItems(body);
    if (!rawItems.length) return json(400, { ok: false, error: 'Missing items' });

    const cart = rawItems.map((it, idx) => {
      const productId = String(it && it.productId || '').trim();
      const qty = Number(it && it.qty == null ? 1 : it.qty);
      if (!productId) throw Object.assign(new Error(`Item ${idx + 1}: productId is required`), { statusCode: 400 });
      if (!Number.isInteger(qty) || qty < 1) throw Object.assign(new Error(`Item ${idx + 1}: qty must be integer >= 1`), { statusCode: 400 });
      return { productId, qty };
    });

    const uniqueIds = Array.from(new Set(cart.map((x) => x.productId)));
    const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await query(`SELECT * FROM products WHERE id IN (${placeholders})`, uniqueIds);
    const map = new Map(rows.map((r) => [r.id, r]));

    const line_items = cart.map((it) => {
      const p = map.get(it.productId);
      if (!p) throw Object.assign(new Error(`Product not found: ${it.productId}`), { statusCode: 400 });
      if (p.status !== 'active') throw Object.assign(new Error('Sold out'), { statusCode: 400 });
      if (!Number.isInteger(p.inventory) || p.inventory <= 0) throw Object.assign(new Error('Sold out'), { statusCode: 400 });
      if (it.qty > p.inventory) throw Object.assign(new Error(`Only ${p.inventory} left`), { statusCode: 400 });

      return {
        quantity: it.qty,
        price_data: {
          currency: p.currency || 'usd',
          unit_amount: p.price_cents,
          product_data: {
            name: p.title,
            metadata: { product_id: p.id },
          },
        },
      };
    });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const base = getBaseUrl(event);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      metadata: {
        cart: JSON.stringify(cart),
      },
      shipping_address_collection: { allowed_countries: ['US'] },
      success_url: `${base}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/cancel.html`,
    });

    return json(200, { ok: true, url: session.url, id: session.id });
  } catch (err) {
    return json(err.statusCode || 500, { ok: false, error: err.message || 'Server error' });
  }
};
