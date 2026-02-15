const Stripe = require("stripe");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event, context) => {
  try {
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: "Unauthorized" });

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method Not Allowed" });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return json(500, { ok: false, error: "Missing STRIPE_SECRET_KEY env var." });

    const body = event && event.body ? JSON.parse(event.body) : {};
    const sessionId = body && body.sessionId ? String(body.sessionId).trim() : "";
    const tracking = body && body.tracking ? String(body.tracking).trim() : "";

    if (!sessionId) return json(400, { ok: false, error: "Missing sessionId" });

    const stripe = new Stripe(secretKey);

    await stripe.checkout.sessions.update(sessionId, {
      metadata: {
        fulfillment_status: "shipped",
        tracking,
        shipped_at: new Date().toISOString(),
      },
    });

    return json(200, { ok: true });
  } catch (err) {
    return json(500, { ok: false, error: err && err.message ? err.message : "Server error" });
  }
};
