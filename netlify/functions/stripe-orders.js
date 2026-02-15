const Stripe = require("stripe");
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

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

function isPaidSession(session) {
  if (!session || session.payment_status !== 'paid') return false;
  if (typeof session.status === 'string' && session.status !== 'complete') return false;
  return true;
}

function stripeError(err) {
  return json(502, {
    ok: false,
    error: err && err.message ? `Stripe API error: ${err.message}` : 'Stripe API request failed.',
  });
}

exports.handler = async (event, _context) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY env var." });

    const stripe = new Stripe(secretKey);
    const rawLimit = parseInt(event?.queryStringParameters?.limit || "50", 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);

    const rawStatus = String(event?.queryStringParameters?.status || "unshipped").toLowerCase();
    const status = rawStatus === "shipped" || rawStatus === "all" ? rawStatus : "unshipped";
    const q = String(event?.queryStringParameters?.q || "").trim().toLowerCase();

    let sessionsResp;
    try {
      sessionsResp = await stripe.checkout.sessions.list({ limit });
    } catch (err) {
      return stripeError(err);
    }

    const sessions = (Array.isArray(sessionsResp.data) ? sessionsResp.data : []).filter(isPaidSession);

    const orders = await Promise.all(
      sessions.map(async (session) => {
        let lineItemsResp;
        try {
          lineItemsResp = await stripe.checkout.sessions.listLineItems(session.id, {
            limit: 100,
            expand: ["data.price"],
          });
        } catch (err) {
          throw err;
        }

        const metadata = session && session.metadata ? session.metadata : {};
        const fulfillment_status = metadata.fulfillment_status === "shipped" ? "shipped" : "unshipped";

        return {
          id: session.id,
          created: session.created || 0,
          customer_email: (session.customer_details && session.customer_details.email) || session.customer_email || "",
          recipient: normalizeRecipient(session),
          items: normalizeItems(lineItemsResp.data),
          amount_total: typeof session.amount_total === "number" ? session.amount_total : null,
          currency: session.currency || "usd",
          fulfillment_status,
          tracking: metadata.tracking || "",
          shipped_at: metadata.shipped_at || "",
        };
      })
    ).catch((err) => {
      throw err;
    });

    const filtered = orders
      .filter((order) => {
        if (status !== "all" && order.fulfillment_status !== status) return false;
        if (!q) return true;
        return order.id.toLowerCase().includes(q) || String(order.customer_email || "").toLowerCase().includes(q);
      })
      .sort((a, b) => (b.created || 0) - (a.created || 0));

    return json(200, { ok: true, orders: filtered });
  } catch (err) {
    return stripeError(err);
  }
};
