const { ensureOpportunities } = require('./_ai-db');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

exports.handler = async (_event, context) => {
  try {
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: 'Unauthorized' });

    const opportunities = await ensureOpportunities(3);
    return json(200, { ok: true, opportunities: opportunities.map(formatOpp) });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};


function formatOpp(row) {
  return {
    ...row,
    max_buy_price: Number((Number(row.max_buy_price_cents || 0) / 100).toFixed(2)),
    suggested_price: Number((Number(row.suggested_price_cents || 0) / 100).toFixed(2)),
    margin_estimate: row.expected_margin_pct != null ? `${row.expected_margin_pct}%` : '',
    checklist: Array.isArray(row.condition_checklist) ? row.condition_checklist : [],
  };
}
