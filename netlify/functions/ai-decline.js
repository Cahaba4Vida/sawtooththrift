const { query } = require('./_db');
const { ensureOpportunities } = require('./_ai-db');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

exports.handler = async (event, context) => {
  try {
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: 'Unauthorized' });
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

    const body = event.body ? JSON.parse(event.body) : {};
    const oppId = String(body.opp_id || '').trim();
    if (!oppId) return json(400, { ok: false, error: 'Missing opp_id' });

    await query(`DELETE FROM ai_opportunities WHERE opp_id=$1`, [oppId]);
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
