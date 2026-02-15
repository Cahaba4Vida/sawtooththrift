#!/usr/bin/env node
const { spawnSync } = require('child_process');

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  return { res, body, text };
}

function cookieFromLogin(res) {
  const raw = res.headers.get('set-cookie') || '';
  const first = raw.split(',').find((x) => x.includes('admin_auth=')) || '';
  return first.split(';')[0];
}

async function ensureProductForUi(cookie) {
  const list = await req(`${BASE_URL}/.netlify/functions/admin-products`, { headers: { cookie } });
  assert(list.res.status === 200 && list.body && list.body.ok, 'admin-products request failed');

  let product = (list.body.products || []).find((p) => p.status === 'active' && Number(p.inventory) > 1);

  if (!product) {
    const opp = await req(`${BASE_URL}/.netlify/functions/ai-opportunities`, { headers: { cookie } });
    assert(opp.res.status === 200 && Array.isArray(opp.body && opp.body.opportunities) && opp.body.opportunities.length, 'Unable to fetch AI opportunities to create test product');

    const accept = await req(`${BASE_URL}/.netlify/functions/ai-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ opp_id: opp.body.opportunities[0].opp_id }),
    });
    assert(accept.res.status === 200 && accept.body && accept.body.ok, 'Unable to accept AI opportunity for test product');
    product = accept.body.product || accept.body.draft_product;

    const patch = await req(`${BASE_URL}/.netlify/functions/admin-products`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: product.id, updates: { status: 'active', inventory: 2 } }),
    });
    assert(patch.res.status === 200 && patch.body && patch.body.ok, 'Unable to activate accepted product');
    product = patch.body.product;
  }

  const soldOutPatch = await req(`${BASE_URL}/.netlify/functions/admin-products`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id: product.id, updates: { status: 'active', inventory: 0 } }),
  });
  assert(soldOutPatch.res.status === 200 && soldOutPatch.body && soldOutPatch.body.ok, 'Failed to set sold-out state for UI test');

  const activePatch = await req(`${BASE_URL}/.netlify/functions/admin-products`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id: product.id, updates: { status: 'active', inventory: 2 } }),
  });
  assert(activePatch.res.status === 200 && activePatch.body && activePatch.body.ok, 'Failed to restore inventory for UI test');

  return product.id;
}

async function runBrowserSuite() {
  if (!BASE_URL) throw new Error('Missing BASE_URL env var');
  if (!ADMIN_TOKEN) throw new Error('Missing ADMIN_TOKEN env var');

  const login = await req(`${BASE_URL}/.netlify/functions/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  assert(login.res.status === 200 && login.body && login.body.ok, 'Admin login API failed for browser setup');
  const cookie = cookieFromLogin(login.res);
  assert(cookie, 'Missing admin cookie after login');

  const testProductId = await ensureProductForUi(cookie);

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    throw new Error('Playwright is not installed. Run `npm install` in a network-enabled environment.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const hasCards = (await page.locator('#productsGrid .product').count()) > 0;
    const hasEmpty = (await page.getByText('No products available.').count()) > 0;
    assert(hasCards || hasEmpty, 'Expected product cards or empty state on storefront');

    if (hasCards) {
      await page.locator('#productsGrid .product .product-media').first().click();
      await page.waitForURL(/\/product\.html\?id=/, { timeout: 10000 });
      await page.waitForSelector('.product-price-lg, .price');

      const addBtn = page.locator('#addToCartBtn');
      const enabled = await addBtn.isEnabled();
      if (enabled) {
        const before = Number(await page.locator('[data-cart-count]').first().innerText());
        await addBtn.click();
        await page.waitForTimeout(400);
        const after = Number(await page.locator('[data-cart-count]').first().innerText());
        assert(after >= before + 1, 'Add to cart did not increase cart count');

        await page.goto(`${BASE_URL}/cart.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#cartList');
        const rows = await page.locator('#cartList [data-id]').count();
        assert(rows > 0, 'Expected cart to list at least one item');

        const subtotalBefore = await page.locator('#cartSubtotal').innerText();
        const inc = page.locator('#cartList [data-inc]').first();
        if (await inc.count()) {
          await inc.click();
          await page.waitForTimeout(300);
          const subtotalAfter = await page.locator('#cartSubtotal').innerText();
          assert(subtotalAfter !== subtotalBefore, 'Subtotal did not update after qty increment');
        }

        const removeBtn = page.locator('#cartList [data-remove]').first();
        await removeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.goto(`${BASE_URL}/product.html?id=${encodeURIComponent(testProductId)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const soldOutVisible = (await page.getByText('Sold out').count()) > 0;
    if (soldOutVisible) {
      assert(!(await page.locator('#addToCartBtn').isEnabled()), 'Sold-out product should disable add-to-cart');
    }

    await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' });
    if (page.url().endsWith('/admin/login')) {
      await page.goto(`${BASE_URL}/admin/login.html`, { waitUntil: 'domcontentloaded' });
    }
    await page.fill('#token', ADMIN_TOKEN);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });
    await page.waitForTimeout(1800);

    const cmsError = (await page.getByText('Error loading CMS configuration').count()) > 0;
    assert(!cmsError, 'Admin loaded with CMS configuration error');
    assert((await page.locator('#stAiLauncher').count()) > 0, 'AI panel launcher missing in admin UI');
    assert((await page.locator('#stDbProductsLauncher').count()) > 0, 'DB products launcher missing in admin UI');
  } finally {
    await browser.close();
  }
}

(async function main() {
  const smoke = spawnSync(process.execPath, [require('path').join(__dirname, 'smoke.js')], { stdio: 'inherit', env: process.env });
  if (smoke.status !== 0) process.exit(smoke.status || 1);

  try {
    await runBrowserSuite();
    console.log('\n✅ Browser suite passed');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Browser suite failed: ${err.message}`);
    process.exit(1);
  }
})();
