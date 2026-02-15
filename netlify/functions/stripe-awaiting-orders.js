/**
 * Netlify Function: stripe-awaiting-orders
 * Admin-only helper to list recent paid checkout sessions with shipping details.
 *
 * Required env:
 *   STRIPE_SECRET_KEY
 * Optional env:
 *   ADMIN_EMAILS (comma-separated allowlist)
 */

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function normalizeEmailList(v) {
  if (!v) return null;
  const arr = String(v)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return arr.length ? arr : null;
}

async function stripeGet(path, secretKey) {
  const url = "https://api.stripe.com" + path;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": "2024-06-20",
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : "Stripe API error";
    const status = res.status || 500;
    throw Object.assign(new Error(msg), { status, stripe: data });
  }

  return data;
}

function recipientFromSession(session) {
  const shipping = session && session.shipping_details ? session.shipping_details : null;
  const customer = session && session.customer_details ? session.customer_details : null;
  const addr = (shipping && shipping.address) || (customer && customer.address) || {};

  return {
    name: (shipping && shipping.name) || (customer && customer.name) || "",
    line1: addr.line1 || "",
    line2: addr.line2 || "",
    city: addr.city || "",
    state: addr.state || "",
    zip: addr.postal_code || "",
    country: addr.country || "US",
    email: (customer && customer.email) || "",
  };
}

function hasRequiredAddress(recipient) {
  return !!(recipient && recipient.name && recipient.line1 && recipient.city && recipient.state && recipient.zip);
}

function extractItems(session) {
  const lineItems = session && session.line_items && Array.isArray(session.line_items.data) ? session.line_items.data : [];
  return lineItems.map((li) => {
    const qty = typeof li.quantity === "number" ? li.quantity : 1;
    const amount = li.amount_total != null ? li.amount_total : li.amount_subtotal;
    const currency = li.currency || "usd";
    const unitAmount = typeof amount === "number" ? Math.round(amount / Math.max(qty, 1)) : null;
    return {
      name: li.description || "Stripe item",
      quantity: qty,
      unit_amount: unitAmount,
      currency,
      amount_total: amount,
    };
  });
}

exports.handler = async (event, context) => {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY env var." });

    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: "Unauthorized (login required)." });

    const allow = normalizeEmailList(process.env.ADMIN_EMAILS);
    const email = (user.email || "").toLowerCase();
    if (allow && !allow.includes(email)) {
      return json(403, { ok: false, error: "Forbidden (not in ADMIN_EMAILS)." });
    }

    const limit = Math.min(Math.max(parseInt(event?.queryStringParameters?.limit || "25", 10) || 25, 1), 100);

    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("payment_status", "paid");
    params.append("expand[]", "data.customer_details");
    params.append("expand[]", "data.shipping_details");
    params.append("expand[]", "data.line_items");

    const data = await stripeGet(`/v1/checkout/sessions?${params.toString()}`, secretKey);
    const sessions = Array.isArray(data.data) ? data.data : [];

    const orders = sessions
      .filter((s) => s && s.status === "complete")
      .map((s) => {
        const recipient = recipientFromSession(s);
        const items = extractItems(s);
        const created = s.created || 0;
        return {
          id: s.id,
          created,
          payment_link_id: typeof s.payment_link === "string" ? s.payment_link : "",
          customer_email: recipient.email || "",
          recipient,
          has_full_address: hasRequiredAddress(recipient),
          items,
        };
      })
      .sort((a, b) => (b.created || 0) - (a.created || 0));

    return json(200, { ok: true, orders });
  } catch (err) {
    const statusCode = err && err.status ? err.status : 500;
    return json(statusCode, { ok: false, error: err.message || "Server error" });
  }
};
