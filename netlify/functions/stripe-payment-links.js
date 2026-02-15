/**
 * Netlify Function: stripe-payment-links
 * Admin-only (Netlify Identity): returns Stripe Payment Links with product/price info
 *
 * Required env:
 *   STRIPE_SECRET_KEY
 * Optional env:
 *   ADMIN_EMAILS (comma-separated allowlist)
 */
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function normalizeEmailList(v) {
  if (!v) return null;
  const arr = String(v)
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return arr.length ? arr : null;
}

async function stripeGet(path, secretKey) {
  const url = "https://api.stripe.com" + path;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Stripe-Version": "2024-06-20",
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : "Stripe API error";
    const code = data && data.error && data.error.code ? data.error.code : undefined;
    const type = data && data.error && data.error.type ? data.error.type : undefined;
    const status = res.status || 500;
    throw Object.assign(new Error(msg), { status, code, type, stripe: data });
  }
  return data;
}

async function listAll(secretKey, resourcePath, params) {
  const out = [];
  let starting_after = null;

  while (true) {
    const q = new URLSearchParams(params || {});
    q.set("limit", "100");
    if (starting_after) q.set("starting_after", starting_after);
    const data = await stripeGet(`${resourcePath}?${q.toString()}`, secretKey);
    if (Array.isArray(data.data)) out.push(...data.data);
    if (!data.has_more) break;
    starting_after = out[out.length - 1]?.id;
    if (!starting_after) break;
  }
  return out;
}

exports.handler = async (event, context) => {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY env var." });

    // Auth: require Netlify Identity user context
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: "Unauthorized (login required)." });

    const allow = normalizeEmailList(process.env.ADMIN_EMAILS);
    const email = (user.email || "").toLowerCase();
    if (allow && !allow.includes(email)) {
      return json(403, { ok: false, error: "Forbidden (not in ADMIN_EMAILS)." });
    }

    // 1) Pull products (for name lookup)
    const products = await listAll(secretKey, "/v1/products", { active: "true" });
    const productNameById = new Map(products.map(p => [p.id, p.name || p.id]));

    // 2) Pull payment links with expanded line_items
    const paymentLinks = await listAll(secretKey, "/v1/payment_links", { expand: ["data.line_items"] });

    // Build a map: priceId -> paymentLink URL (prefer active links)
    const priceToLink = new Map();
    const entries = [];

    for (const pl of paymentLinks) {
      const plUrl = pl.url || "";
      const plActive = pl.active !== false;

      const lineItems = pl.line_items && pl.line_items.data ? pl.line_items.data : [];
      for (const li of lineItems) {
        const price = li.price || null;
        if (!price) continue;

        const priceId = price.id;
        const unitAmount = price.unit_amount; // integer cents
        const currency = (price.currency || "").toLowerCase();
        const recurring = !!price.recurring;

        const prod = price.product;
        const productId = typeof prod === "string" ? prod : (prod && prod.id) ? prod.id : null;
        const productName = productId ? (productNameById.get(productId) || productId) : (li.description || "");

        // record mapping (prefer active link, then first seen)
        if (priceId && plUrl) {
          const existing = priceToLink.get(priceId);
          if (!existing || (plActive && !existing.active)) {
            priceToLink.set(priceId, { url: plUrl, active: plActive, payment_link_id: pl.id });
          }
        }

        entries.push({
          payment_link_id: pl.id,
          payment_link_url: plUrl,
          payment_link_active: plActive,
          product_id: productId,
          product_name: productName,
          price_id: priceId,
          unit_amount: unitAmount,
          currency,
          recurring,
        });
      }
    }

    // Dedupe: keep best payment link per price_id
    const bestByPrice = new Map();
    for (const e of entries) {
      if (!e.price_id) continue;
      const cur = bestByPrice.get(e.price_id);
      if (!cur) { bestByPrice.set(e.price_id, e); continue; }
      // prefer active links
      if (!cur.payment_link_active && e.payment_link_active) bestByPrice.set(e.price_id, e);
    }

    // Return sorted list
    const result = Array.from(bestByPrice.values()).sort((a,b) => {
      const an = (a.product_name||"").toLowerCase();
      const bn = (b.product_name||"").toLowerCase();
      return an.localeCompare(bn);
    });

    return json(200, { ok: true, items: result });
  } catch (err) {
    const statusCode = err && err.status ? err.status : 500;
    return json(statusCode, { ok: false, error: err.message || "Server error" });
  }
};
