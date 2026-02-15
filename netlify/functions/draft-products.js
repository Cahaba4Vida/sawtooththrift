const { query } = require('./_db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}


function formatDraft(row) {
  return {
    ...row,
    price: Number((Number(row.price_cents || 0) / 100).toFixed(2)),
    photos: Array.isArray(row.photos) ? row.photos : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    search_keywords: Array.isArray(row.search_keywords) ? row.search_keywords : [],
  };
}

exports.handler = async (event, _context) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    if (event.httpMethod === 'GET') {
      const { rows } = await query(`SELECT * FROM products WHERE tags ? 'ai-draft' AND status IN ('draft','active') ORDER BY created_at DESC`);
      return json(200, { ok: true, drafts: rows.map(formatDraft) });
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const id = String(body.id || '').trim();
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};
      if (!id) return json(400, { ok: false, error: 'Missing id' });

      const sets = [];
      const vals = [];
      const add = (c, v) => { sets.push(`${c}=$${vals.length + 1}`); vals.push(v); };
      if (updates.inventory != null) {
        const inv = Number(updates.inventory);
        if (!Number.isInteger(inv) || inv < 0) return json(400, { ok: false, error: 'inventory must be an integer >= 0' });
        add('inventory', inv);
      }
      if (updates.title != null) add('title', String(updates.title));
      if (updates.description != null) add('description', String(updates.description));
      if (updates.status != null) {
        const status = String(updates.status).toLowerCase().trim();
        if (!['draft', 'active', 'archived'].includes(status)) return json(400, { ok: false, error: 'Invalid status' });
        add('status', status);
      }
      if (updates.price != null || updates.price_cents != null) {
        const cents = updates.price_cents != null ? Number(updates.price_cents) : Math.round(Number(updates.price) * 100);
        if (!Number.isInteger(cents) || cents < 0) return json(400, { ok: false, error: 'price must be >= 0' });
        add('price_cents', cents);
      }
      if (!sets.length) return json(400, { ok: false, error: 'No updates' });

      sets.push('updated_at=now()');
      vals.push(id);
      const { rows } = await query(`UPDATE products SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
      if (!rows.length) return json(404, { ok: false, error: 'Draft not found' });
      const drafts = await query(`SELECT * FROM products WHERE tags ? 'ai-draft' AND status IN ('draft','active') ORDER BY created_at DESC`);
      return json(200, { ok: true, draft: formatDraft(rows[0]), drafts: drafts.rows.map(formatDraft) });
    }

    return json(405, { ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};
