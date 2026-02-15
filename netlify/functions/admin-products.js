const { query, withTransaction } = require('./_db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function parseBody(event) {
  if (!event || !event.body) return {};
  try { return JSON.parse(event.body); } catch { return {}; }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function generateProductId(title) {
  const base = slugify(title) || `product-${Date.now()}`;
  let candidate = base;
  let counter = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await query('SELECT id FROM products WHERE id=$1 LIMIT 1', [candidate]);
    if (!existing.rows.length) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
  }
}

function isMissingTablesError(err) {
  return err && (err.code === '42P01' || /relation .* does not exist/i.test(String(err.message || '')));
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

async function ensureProductColumns() {
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_out_since TIMESTAMPTZ`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
}

exports.handler = async (event, _context) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    await ensureProductColumns();

    if (event.httpMethod === 'GET') {
      const { rows } = await query(`SELECT * FROM products ORDER BY created_at DESC`);
      return json(200, { ok: true, products: rows.map(toProduct) });
    }

    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      const id = String(body.id || '').trim();
      if (!id) return json(400, { ok: false, error: 'Missing id' });
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : body;

      const updated = await withTransaction(async (client) => {
        const currentRes = await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [id]);
        if (!currentRes.rows.length) return null;
        const current = currentRes.rows[0];

        const fields = [];
        const values = [];
        const push = (col, val) => { fields.push(`${col}=$${values.length + 1}`); values.push(val); };

        let nextInventory = current.inventory;
        let inventoryProvided = false;
        let nextStatus = String(current.status || 'draft').toLowerCase();
        let statusProvided = false;

        if (updates.title != null) push('title', String(updates.title).trim());
        if (updates.description != null) push('description', String(updates.description));
        if (updates.currency != null) push('currency', String(updates.currency).toLowerCase().trim() || 'usd');
        if (updates.photos != null) push('photos', JSON.stringify(Array.isArray(updates.photos) ? updates.photos : []));
        if (updates.tags != null) push('tags', JSON.stringify(Array.isArray(updates.tags) ? updates.tags : []));
        if (updates.search_keywords != null) push('search_keywords', JSON.stringify(Array.isArray(updates.search_keywords) ? updates.search_keywords : []));
        if (updates.source_notes != null) push('source_notes', String(updates.source_notes));
        if (updates.buy_price_max_cents != null) {
          const v = Number(updates.buy_price_max_cents);
          if (!Number.isInteger(v) || v < 0) throw Object.assign(new Error('buy_price_max_cents must be >= 0'), { statusCode: 400 });
          push('buy_price_max_cents', v);
        }
        if (updates.inventory != null) {
          const inv = Number(updates.inventory);
          if (!Number.isInteger(inv) || inv < 0) throw Object.assign(new Error('inventory must be integer >= 0'), { statusCode: 400 });
          nextInventory = inv;
          inventoryProvided = true;
          push('inventory', inv);
        }
        if (updates.status != null) {
          const status = String(updates.status).toLowerCase().trim();
          if (!['draft', 'active', 'archived'].includes(status)) throw Object.assign(new Error('Invalid status'), { statusCode: 400 });
          nextStatus = status;
          statusProvided = true;
          push('status', status);
        }
        if (updates.price_cents != null || updates.price != null) {
          const cents = updates.price_cents != null ? Number(updates.price_cents) : Math.round(Number(updates.price) * 100);
          if (!Number.isInteger(cents) || cents < 0) throw Object.assign(new Error('price must be >= 0'), { statusCode: 400 });
          push('price_cents', cents);
        }

        if (inventoryProvided) {
          const prevInventory = Number(current.inventory || 0);
          if (nextInventory > 0) {
            push('sold_out_since', null);
          } else if (nextInventory <= 0 && prevInventory > 0) {
            push('sold_out_since', new Date().toISOString());
          }
        }

        if (statusProvided) {
          const prevStatus = String(current.status || '').toLowerCase();
          if (nextStatus === 'archived') {
            push('archived_at', new Date().toISOString());
          } else if (prevStatus === 'archived' && nextStatus !== 'archived') {
            push('archived_at', null);
          }
        }

        if (!fields.length) throw Object.assign(new Error('No valid updates'), { statusCode: 400 });

        fields.push('updated_at=now()');
        values.push(id);
        const { rows } = await client.query(`UPDATE products SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`, values);
        return rows[0] || null;
      });

      if (!updated) return json(404, { ok: false, error: 'Product not found' });
      return json(200, { ok: true, product: toProduct(updated) });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      const title = String(body.title || '').trim();
      if (!title) return json(400, { ok: false, error: 'Title is required' });

      const rawId = String(body.id || '').trim();
      const id = rawId || await generateProductId(title);
      const description = String(body.description || '');
      const currency = String(body.currency || 'usd').toLowerCase().trim() || 'usd';
      const status = String(body.status || 'draft').toLowerCase().trim() || 'draft';
      const photos = Array.isArray(body.photos) ? body.photos.map((x) => String(x || '').trim()).filter(Boolean) : [];
      const inventory = body.inventory == null || body.inventory === '' ? 1 : Number(body.inventory);

      if (!['draft', 'active', 'archived'].includes(status)) return json(400, { ok: false, error: 'Invalid status' });
      if (!Number.isInteger(inventory) || inventory < 0) return json(400, { ok: false, error: 'inventory must be integer >= 0' });

      const cents = body.price_cents != null ? Number(body.price_cents) : Math.round(Number(body.price) * 100);
      if (!Number.isInteger(cents) || cents < 0) return json(400, { ok: false, error: 'price must be >= 0' });

      const soldOutSince = inventory <= 0 ? new Date().toISOString() : null;
      const archivedAt = status === 'archived' ? new Date().toISOString() : null;

      const { rows } = await query(
        `INSERT INTO products (id, status, title, description, price_cents, currency, photos, inventory, sold_out_since, archived_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
         RETURNING *`,
        [id, status, title, description, cents, currency, JSON.stringify(photos), inventory, soldOutSince, archivedAt]
      );

      return json(201, { ok: true, product: toProduct(rows[0]) });
    }

    return json(405, { ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    if (isMissingTablesError(err)) {
      return json(500, { ok: false, error: 'DB tables missing. Go to Settings -> Initialize Database.' });
    }
    return json(err.statusCode || 500, { ok: false, error: err.message || 'Server error' });
  }
};
