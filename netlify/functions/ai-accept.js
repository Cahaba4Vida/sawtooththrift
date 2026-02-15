const { withTransaction } = require('./_db');
const { ensureOpportunities } = require('./_ai-db');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function slugify(value) {
  return String(value || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

exports.handler = async (event, context) => {
  try {
    const user = context && context.clientContext && context.clientContext.user;
    if (!user) return json(401, { ok: false, error: 'Unauthorized' });
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

    const body = event.body ? JSON.parse(event.body) : {};
    const oppId = String(body.opp_id || '').trim();
    if (!oppId) return json(400, { ok: false, error: 'Missing opp_id' });

    const draft = await withTransaction(async (client) => {
      const selected = await client.query(`SELECT * FROM ai_opportunities WHERE opp_id=$1 FOR UPDATE`, [oppId]);
      if (!selected.rows.length) throw Object.assign(new Error('Opportunity not found'), { statusCode: 404 });
      const opp = selected.rows[0];

      await client.query(`DELETE FROM ai_opportunities WHERE opp_id=$1`, [oppId]);

      const base = slugify(opp.title);
      let id = base;
      let n = 2;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const exists = await client.query(`SELECT 1 FROM products WHERE id=$1 LIMIT 1`, [id]);
        if (!exists.rows.length) break;
        id = `${base}-${n}`;
        n += 1;
      }

      const title = opp.title;
      const description = `AI draft listing for ${opp.title}. Keywords: ${(opp.search_keywords || []).join(', ')}. Condition checklist: ${(opp.condition_checklist || []).join('; ')}.`;

      const inserted = await client.query(
        `INSERT INTO products (id,status,title,description,price_cents,currency,photos,inventory,tags,source_notes,buy_price_max_cents,search_keywords)
         VALUES ($1,'draft',$2,$3,$4,'usd','[]'::jsonb,1,$5::jsonb,$6,$7,$8::jsonb)
         RETURNING *`,
        [id, title, description, opp.suggested_price_cents, JSON.stringify(['ai-draft']), opp.notes || '', opp.max_buy_price_cents, JSON.stringify(opp.search_keywords || [])]
      );

      return inserted.rows[0];
    });

    const opportunities = await ensureOpportunities(3);
    return json(200, { ok: true, product: draft, draft_product: draft, opportunities: opportunities.map(formatOpp) });
  } catch (err) {
    const code = err.statusCode || 500;
    return json(code, { ok: false, error: err.message || 'Server error' });
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
