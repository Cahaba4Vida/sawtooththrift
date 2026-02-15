const { query } = require('./_db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}


function parseBody(event) {
  if (!event || !event.body) return {};
  try { return JSON.parse(event.body); } catch { return {}; }
}

function toProduct(row) {
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
      const { rows } = await query(`SELECT * FROM products ORDER BY created_at DESC`);
      return json(200, { ok: true, products: rows.map(toProduct) });
    }

    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      const id = String(body.id || '').trim();
      if (!id) return json(400, { ok: false, error: 'Missing id' });
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : body;

      const fields = [];
      const values = [];
      const push = (col, val) => { fields.push(`${col}=$${values.length + 1}`); values.push(val); };

      if (updates.title != null) push('title', String(updates.title).trim());
      if (updates.description != null) push('description', String(updates.description));
      if (updates.currency != null) push('currency', String(updates.currency).toLowerCase().trim() || 'usd');
      if (updates.photos != null) push('photos', JSON.stringify(Array.isArray(updates.photos) ? updates.photos : []));
      if (updates.tags != null) push('tags', JSON.stringify(Array.isArray(updates.tags) ? updates.tags : []));
      if (updates.search_keywords != null) push('search_keywords', JSON.stringify(Array.isArray(updates.search_keywords) ? updates.search_keywords : []));
      if (updates.source_notes != null) push('source_notes', String(updates.source_notes));
      if (updates.buy_price_max_cents != null) {
        const v = Number(updates.buy_price_max_cents);
        if (!Number.isInteger(v) || v < 0) return json(400, { ok: false, error: 'buy_price_max_cents must be >= 0' });
        push('buy_price_max_cents', v);
      }
      if (updates.inventory != null) {
        const inv = Number(updates.inventory);
        if (!Number.isInteger(inv) || inv < 0) return json(400, { ok: false, error: 'inventory must be integer >= 0' });
        push('inventory', inv);
      }
      if (updates.status != null) {
        const status = String(updates.status).toLowerCase().trim();
        if (!['draft', 'active', 'archived'].includes(status)) return json(400, { ok: false, error: 'Invalid status' });
        push('status', status);
      }
      if (updates.price_cents != null || updates.price != null) {
        const cents = updates.price_cents != null ? Number(updates.price_cents) : Math.round(Number(updates.price) * 100);
        if (!Number.isInteger(cents) || cents < 0) return json(400, { ok: false, error: 'price must be >= 0' });
        push('price_cents', cents);
      }

      if (!fields.length) return json(400, { ok: false, error: 'No valid updates' });
      fields.push(`updated_at=now()`);
      values.push(id);
      const { rows } = await query(`UPDATE products SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`, values);
      if (!rows.length) return json(404, { ok: false, error: 'Product not found' });
      return json(200, { ok: true, product: toProduct(rows[0]) });
    }

    return json(405, { ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};
