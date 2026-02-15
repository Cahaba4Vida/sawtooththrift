const Stripe = require("stripe");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function normalizeRecipient(session) {
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
    country: addr.country || "",
  };
}

function normalizeItems(lineItems) {
  return (lineItems || []).map((item) => {
    const price = item && item.price ? item.price : null;
    return {
      name: (item && item.description) || (price && price.nickname) || "Item",
      quantity: (item && item.quantity) || 1,
      unit_amount: price && typeof price.unit_amount === "number" ? price.unit_amount : null,
      currency: (price && price.currency) || (item && item.currency) || "usd",
    };
  });
}

exports.handler = async (event, context) => {
  try {
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: "Unauthorized" });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY env var." });

    const stripe = new Stripe(secretKey);
    const rawLimit = parseInt(event?.queryStringParameters?.limit || "50", 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);

    const sessionsResp = await stripe.checkout.sessions.list({
      limit,
      payment_status: "paid",
      expand: ["data.customer_details", "data.shipping_details", "data.payment_intent"],
    });

    const sessions = Array.isArray(sessionsResp.data) ? sessionsResp.data : [];

    const orders = await Promise.all(
      sessions.map(async (session) => {
        const lineItemsResp = await stripe.checkout.sessions.listLineItems(session.id, {
          limit: 100,
          expand: ["data.price"],
        });

        const sessionMeta = session && session.metadata ? session.metadata : {};
        const piMeta = session && session.payment_intent && session.payment_intent.metadata ? session.payment_intent.metadata : {};
        const mergedMeta = { ...piMeta, ...sessionMeta };
        const shipped = mergedMeta.fulfillment_status === "shipped";

        return {
          id: session.id,
          created: session.created || 0,
          customer_email: (session.customer_details && session.customer_details.email) || session.customer_email || "",
          amount_total: typeof session.amount_total === "number" ? session.amount_total : null,
          currency: session.currency || "usd",
          recipient: normalizeRecipient(session),
          items: normalizeItems(lineItemsResp.data),
          status: shipped ? "shipped" : "paid",
          tracking: mergedMeta.tracking || "",
          shipped_at: mergedMeta.shipped_at || "",
        };
      })
    );

    return json(200, { ok: true, orders });
  } catch (err) {
    return json(500, { ok: false, error: err && err.message ? err.message : "Server error" });
  }
};
