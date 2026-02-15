/**
 * Netlify Function: ai-insights
 * Admin-only assistant for sourcing + revenue insights.
 *
 * Required env:
 *   OPENAI_API_KEY
 * Optional env:
 *   OPENAI_MODEL (default: gpt-4.1-mini)
 *   STRIPE_SECRET_KEY (enables revenue context)
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
  const arr = String(v).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
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
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : "Stripe API error";
    throw new Error(msg);
  }
  return data;
}

async function fetchRevenueSnapshot(secretKey) {
  if (!secretKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const since = now - (30 * 24 * 60 * 60);

  const q = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
  const data = await stripeGet(`/v1/charges?${q.toString()}`, secretKey);
  const charges = Array.isArray(data.data) ? data.data : [];

  let gross = 0;
  let refunds = 0;
  let successful = 0;
  for (const c of charges) {
    if (c.paid && !c.disputed) {
      successful += 1;
      gross += Number(c.amount || 0);
      refunds += Number(c.amount_refunded || 0);
    }
  }

  return {
    window_days: 30,
    successful_charges: successful,
    gross_usd: Number((gross / 100).toFixed(2)),
    refunded_usd: Number((refunds / 100).toFixed(2)),
    net_usd: Number(((gross - refunds) / 100).toFixed(2)),
  };
}

exports.handler = async (event, context) => {
  try {
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: "Unauthorized (login required)." });

    const allow = normalizeEmailList(process.env.ADMIN_EMAILS);
    const email = String((user && user.email) || "").toLowerCase();
    if (allow && !allow.includes(email)) {
      return json(403, { ok: false, error: "Forbidden (not in ADMIN_EMAILS)." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json(500, { ok: false, error: "Missing OPENAI_API_KEY env var." });

    const body = event && event.body ? JSON.parse(event.body) : {};
    const question = String(body.question || "").trim() || "What products in Twin Falls are worth buying and reselling this week?";

    const revenue = await fetchRevenueSnapshot(process.env.STRIPE_SECRET_KEY).catch(() => null);

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const system = [
      "You are a thrift resale coach for Sawtooth Thrift in Twin Falls, Idaho.",
      "Respond super simply.",
      "Use short bullets and very plain words.",
      "Always include: 1) what to buy, 2) target buy price, 3) likely sell price, 4) quick risk note, 5) one next action.",
      "If revenue context exists, include one short revenue insight and one action.",
      "Do not overclaim certainty. If unsure, say 'estimate'.",
    ].join(" ");

    const input = [
      `Question: ${question}`,
      `Store context: mostly online shipping, nationwide buyers, curated thrift/vintage pieces.`,
      `Stripe revenue snapshot (if present): ${JSON.stringify(revenue)}`,
    ].join("\n\n");

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: input }] },
        ],
        max_output_tokens: 700,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = data && data.error && data.error.message ? data.error.message : "OpenAI request failed";
      return json(500, { ok: false, error: err });
    }

    let answer = "No response returned.";
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      answer = data.output_text.trim();
    }

    return json(200, {
      ok: true,
      answer,
      revenue,
      model,
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message || "Server error" });
  }
};
