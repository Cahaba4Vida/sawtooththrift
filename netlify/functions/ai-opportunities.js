const { ensureOpportunities } = require('./_ai-db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

exports.handler = async (event, _context) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

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
    buy_links: Array.isArray(row.buy_links) ? row.buy_links : [],
    local_pickup: Array.isArray(row.local_pickup) ? row.local_pickup : [],
  };
}
