/**
 * Netlify Function: stripe-orders
 * Admin-only helper to fetch latest paid checkout session for a Stripe payment link.
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

function extractRecipient(session) {
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

    const paymentLinkId = event && event.queryStringParameters ? String(event.queryStringParameters.payment_link_id || "").trim() : "";
    if (!paymentLinkId) {
      return json(400, { ok: false, error: "Missing payment_link_id query parameter." });
    }

    const params = new URLSearchParams();
    params.set("limit", "25");
    params.set("payment_link", paymentLinkId);
    params.set("payment_status", "paid");
    params.append("expand[]", "data.customer_details");
    params.append("expand[]", "data.shipping_details");

    const data = await stripeGet(`/v1/checkout/sessions?${params.toString()}`, secretKey);
    const sessions = Array.isArray(data.data) ? data.data : [];

    const best = sessions
      .map((s) => ({ session: s, recipient: extractRecipient(s) }))
      .find((x) => hasRequiredAddress(x.recipient));

    if (!best) {
      return json(200, { ok: true, order: null, message: "No paid order with full shipping address found yet." });
    }

    return json(200, {
      ok: true,
      order: {
        id: best.session.id,
        created: best.session.created || null,
        payment_link: best.session.payment_link || paymentLinkId,
        customer_email: best.recipient.email || "",
        recipient: best.recipient,
      },
    });
  } catch (err) {
    const statusCode = err && err.status ? err.status : 500;
    return json(statusCode, { ok: false, error: err.message || "Server error" });
  }
};
