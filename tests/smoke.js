#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadConfig() {
  const cfgPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { return {}; }
}

const config = loadConfig();
const BASE_URL = String(process.env.BASE_URL || config.BASE_URL || '').replace(/\/+$/, '');
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || config.ADMIN_TOKEN || '');
const STRIPE_TEST_WEBHOOK_SECRET = String(process.env.STRIPE_TEST_WEBHOOK_SECRET || config.STRIPE_WEBHOOK_SECRET || '');

const results = [];
let failures = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function test(name, fn) {
  try {
    await fn();
    results.push(`✅ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`❌ ${name} - ${err.message}`);
  }
}

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  return { res, text, body };
}

function getCookieFromLogin(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const first = setCookie.split(',').find((v) => v.includes('admin_auth=')) || '';
  return first.split(';')[0];
}

async function runWebhookIdempotencyUnit() {
  const fixturePath = path.join(__dirname, 'fixtures', 'checkout_session_completed.json');
  // value is loaded for parity with deploy config expectations
  void STRIPE_TEST_WEBHOOK_SECRET;
  const eventFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { __testOnly } = require('../netlify/functions/stripe-webhook');

  const state = {
    inventoryById: { 'test-product-1': 5 },
    processed: new Set(),
  };

  const transactionRunner = async (fn) => {
    const client = {
      query: async (sql, params) => {
        const q = String(sql);
        if (q.includes('SELECT 1 FROM processed_stripe_sessions')) {
          const id = params[0];
          return { rows: state.processed.has(id) ? [{ ok: 1 }] : [] };
        }
        if (q.includes('UPDATE products')) {
          const id = params[0];
          const qty = Number(params[1]);
          const current = Number(state.inventoryById[id] || 0);
          state.inventoryById[id] = Math.max(0, current - qty);
          return { rowCount: 1, rows: [] };
        }
        if (q.includes('INSERT INTO processed_stripe_sessions')) {
          state.processed.add(params[0]);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unhandled SQL in test: ${q}`);
      },
    };
    return fn(client);
  };

  const session = eventFixture.data.object;
  const cart = __testOnly.parseCart(session);
  await __testOnly.applyInventoryForSession(session.id, cart, transactionRunner);
  assert(state.inventoryById['test-product-1'] === 4, 'First webhook call should decrement inventory once');

  await __testOnly.applyInventoryForSession(session.id, cart, transactionRunner);
  assert(state.inventoryById['test-product-1'] === 4, 'Second webhook call should be idempotent');
}

(async function main() {
  if (!BASE_URL) {
    console.error('Missing BASE_URL env var.');
    process.exit(1);
  }
  if (!ADMIN_TOKEN) {
    console.error('Missing ADMIN_TOKEN env var.');
    process.exit(1);
  }

  let adminCookie = '';
  let acceptedProductId = '';

  await test('active-products health returns ok:true', async () => {
    const { res, body } = await req(`${BASE_URL}/.netlify/functions/active-products`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok:true');
  });

  await test('admin gate redirects unauthenticated /admin/ to /admin/login', async () => {
    const { res } = await req(`${BASE_URL}/admin/`, { redirect: 'manual' });
    assert([301, 302].includes(res.status), `Expected redirect, got ${res.status}`);
    const location = res.headers.get('location') || '';
    assert(location.includes('/admin/login'), `Expected redirect to /admin/login, got ${location}`);
  });

  await test('admin-login returns auth cookie', async () => {
    const { res, body } = await req(`${BASE_URL}/.netlify/functions/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ADMIN_TOKEN }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok:true');
    adminCookie = getCookieFromLogin(res);
    assert(adminCookie.startsWith('admin_auth='), 'Expected admin_auth cookie');
  });

  await test('ai-opportunities returns 3 opportunities', async () => {
    const { res, body } = await req(`${BASE_URL}/.netlify/functions/ai-opportunities`, {
      headers: { cookie: adminCookie },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok:true');
    assert(Array.isArray(body.opportunities), 'Expected opportunities array');
    assert(body.opportunities.length === 3, `Expected 3 opportunities, got ${body.opportunities.length}`);
  });

  await test('ai-decline refreshes opportunities to 3', async () => {
    const before = await req(`${BASE_URL}/.netlify/functions/ai-opportunities`, { headers: { cookie: adminCookie } });
    const first = before.body && before.body.opportunities && before.body.opportunities[0];
    assert(first && first.opp_id, 'Missing opp_id for decline test');

    const { res, body } = await req(`${BASE_URL}/.netlify/functions/ai-decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ opp_id: first.opp_id }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok:true');
    assert(Array.isArray(body.opportunities) && body.opportunities.length === 3, 'Expected refreshed 3 opportunities');
  });

  await test('ai-accept creates draft product inventory=1 and refreshes opportunities', async () => {
    const before = await req(`${BASE_URL}/.netlify/functions/ai-opportunities`, { headers: { cookie: adminCookie } });
    const first = before.body && before.body.opportunities && before.body.opportunities[0];
    assert(first && first.opp_id, 'Missing opp_id for accept test');

    const { res, body } = await req(`${BASE_URL}/.netlify/functions/ai-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ opp_id: first.opp_id }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok:true');
    const product = body.product || body.draft_product;
    assert(product && product.id, 'Expected created draft product');
    assert(Number(product.inventory) === 1, `Expected inventory=1, got ${product.inventory}`);
    assert(Array.isArray(body.opportunities) && body.opportunities.length === 3, 'Expected refreshed opportunities length=3');
    acceptedProductId = String(product.id);
  });

  await test('admin-products includes accepted draft and can publish/update inventory', async () => {
    const all = await req(`${BASE_URL}/.netlify/functions/admin-products`, { headers: { cookie: adminCookie } });
    assert(all.res.status === 200, `Expected 200, got ${all.res.status}`);
    assert(all.body && all.body.ok === true, 'Expected ok:true');
    const found = (all.body.products || []).find((p) => String(p.id) === acceptedProductId);
    assert(found, `Expected product ${acceptedProductId} in admin-products`);

    const patch = await req(`${BASE_URL}/.netlify/functions/admin-products`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ id: acceptedProductId, updates: { status: 'active', inventory: 1 } }),
    });
    assert(patch.res.status === 200, `Expected 200, got ${patch.res.status}`);
    assert(patch.body && patch.body.ok === true, 'Expected patch ok:true');
    assert(patch.body.product && patch.body.product.status === 'active', 'Expected active status after patch');
    assert(Number(patch.body.product.inventory) === 1, 'Expected inventory=1 after patch');
  });

  await test('active-products includes newly activated product', async () => {
    const { res, body } = await req(`${BASE_URL}/.netlify/functions/active-products`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok:true');
    const found = (body.products || []).find((p) => String(p.id) === acceptedProductId);
    assert(found, `Expected active product ${acceptedProductId}`);
  });

  await test('sold out enforcement: inventory=0 blocks checkout', async () => {
    const patch = await req(`${BASE_URL}/.netlify/functions/admin-products`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ id: acceptedProductId, updates: { inventory: 0, status: 'active' } }),
    });
    assert(patch.res.status === 200 && patch.body && patch.body.ok, 'Expected successful inventory update to 0');

    const checkout = await req(`${BASE_URL}/.netlify/functions/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: acceptedProductId, qty: 1 }] }),
    });
    assert(checkout.res.status === 400, `Expected 400, got ${checkout.res.status}`);
    assert(checkout.body && /sold out/i.test(String(checkout.body.error || '')), 'Expected sold out error message');
  });

  await test('qty > inventory enforcement returns 400', async () => {
    const patch = await req(`${BASE_URL}/.netlify/functions/admin-products`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ id: acceptedProductId, updates: { inventory: 1, status: 'active' } }),
    });
    assert(patch.res.status === 200 && patch.body && patch.body.ok, 'Expected successful inventory reset to 1');

    const checkout = await req(`${BASE_URL}/.netlify/functions/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: acceptedProductId, qty: 2 }] }),
    });
    assert(checkout.res.status === 400, `Expected 400, got ${checkout.res.status}`);
    assert(checkout.body && /only\s+1\s+left/i.test(String(checkout.body.error || '')), 'Expected "Only 1 left" style error');
  });

  await test('stripe webhook inventory decrement is idempotent (unit-style)', async () => {
    await runWebhookIdempotencyUnit();
  });

  console.log('\nSmoke test results:');
  for (const line of results) console.log(line);
  console.log(`\nSummary: ${results.length - failures} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
