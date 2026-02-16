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


function normalizeCategory(value) {
  const category = String(value || 'clothes').trim().toLowerCase();
  if (!['shoes', 'clothes', 'furniture'].includes(category)) {
    throw Object.assign(new Error('category must be shoes, clothes, or furniture'), { statusCode: 400 });
  }
  return category;
}

function normalizeClothingSubcategory(value, category) {
  const subcategory = String(value || '').trim().toLowerCase();
  if (category !== 'clothes') return '';
  if (!['mens', 'womens'].includes(subcategory)) {
    throw Object.assign(new Error('clothing_subcategory must be mens or womens when category is clothes'), { statusCode: 400 });
  }
  return subcategory;
}

function toProduct(row) {
  return {
    ...row,
    price: Number((Number(row.price_cents || 0) / 100).toFixed(2)),
    photos: Array.isArray(row.photos) ? row.photos : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    search_keywords: Array.isArray(row.search_keywords) ? row.search_keywords : [],
    category: String(row.category || 'clothes').toLowerCase(),
    clothing_subcategory: String(row.clothing_subcategory || '').toLowerCase(),
  };
}

async function ensureProductColumns() {
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_out_since TIMESTAMPTZ`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'clothes'`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS clothing_subcategory TEXT NOT NULL DEFAULT ''`);
  await query(`CREATE INDEX IF NOT EXISTS products_category_idx ON products(category)`);
}


async function ensureProductImagesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      content_type TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS product_images_product_id_idx ON product_images(product_id)`);
}

exports.handler = async (event, _context) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    await ensureProductColumns();
    await ensureProductImagesTable();

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
        const fieldIndexes = new Map();
        const setField = (col, val) => {
          if (fieldIndexes.has(col)) {
            values[fieldIndexes.get(col)] = val;
            return;
          }
          fieldIndexes.set(col, values.length);
          fields.push(`${col}=$${values.length + 1}`);
          values.push(val);
        };

        let nextInventory = current.inventory;
        let inventoryProvided = false;
        let nextStatus = String(current.status || 'draft').toLowerCase();
        let statusProvided = false;
        let nextCategory = String(current.category || 'clothes').toLowerCase();
        let categoryProvided = false;
        let nextClothingSubcategory = String(current.clothing_subcategory || '').toLowerCase();
        let clothingProvided = false;

        if (updates.title != null) setField('title', String(updates.title).trim());
        if (updates.description != null) setField('description', String(updates.description));
        if (updates.currency != null) setField('currency', String(updates.currency).toLowerCase().trim() || 'usd');
        if (updates.photos != null) setField('photos', JSON.stringify(Array.isArray(updates.photos) ? updates.photos : []));
        if (updates.tags != null) setField('tags', JSON.stringify(Array.isArray(updates.tags) ? updates.tags : []));
        if (updates.search_keywords != null) setField('search_keywords', JSON.stringify(Array.isArray(updates.search_keywords) ? updates.search_keywords : []));
        if (updates.source_notes != null) setField('source_notes', String(updates.source_notes));
        if (updates.buy_price_max_cents != null) {
          const v = Number(updates.buy_price_max_cents);
          if (!Number.isInteger(v) || v < 0) throw Object.assign(new Error('buy_price_max_cents must be >= 0'), { statusCode: 400 });
          setField('buy_price_max_cents', v);
        }
        if (updates.inventory != null) {
          const inv = Number(updates.inventory);
          if (!Number.isInteger(inv) || inv < 0) throw Object.assign(new Error('inventory must be integer >= 0'), { statusCode: 400 });
          nextInventory = inv;
          inventoryProvided = true;
          setField('inventory', inv);
        }
        if (updates.status != null) {
          const status = String(updates.status).toLowerCase().trim();
          if (!['draft', 'active', 'archived'].includes(status)) throw Object.assign(new Error('Invalid status'), { statusCode: 400 });
          nextStatus = status;
          statusProvided = true;
          setField('status', status);
        }
        if (updates.category != null) {
          const category = normalizeCategory(updates.category);
          nextCategory = category;
          categoryProvided = true;
          setField('category', category);
          if (category !== 'clothes') {
            nextClothingSubcategory = '';
            setField('clothing_subcategory', '');
          }
        }
        if (updates.clothing_subcategory != null) {
          nextClothingSubcategory = String(updates.clothing_subcategory || '').trim().toLowerCase();
          clothingProvided = true;
        }
        if (updates.price_cents != null || updates.price != null) {
          const cents = updates.price_cents != null ? Number(updates.price_cents) : Math.round(Number(updates.price) * 100);
          if (!Number.isInteger(cents) || cents < 0) throw Object.assign(new Error('price must be >= 0'), { statusCode: 400 });
          setField('price_cents', cents);
        }

        if (categoryProvided || clothingProvided) {
          const normalizedSubcategory = normalizeClothingSubcategory(nextClothingSubcategory, nextCategory);
          setField('clothing_subcategory', normalizedSubcategory);
        }

        if (inventoryProvided) {
          const prevInventory = Number(current.inventory || 0);
          if (nextInventory > 0) {
            setField('sold_out_since', null);
          } else if (nextInventory <= 0 && prevInventory > 0) {
            setField('sold_out_since', new Date().toISOString());
          }
        }

        if (statusProvided) {
          const prevStatus = String(current.status || '').toLowerCase();
          if (nextStatus === 'archived') {
            await client.query('DELETE FROM product_images WHERE product_id=$1', [id]);
            setField('photos', JSON.stringify([]));
            setField('archived_at', new Date().toISOString());
          } else if (prevStatus === 'archived' && nextStatus !== 'archived') {
            setField('archived_at', null);
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
      const category = normalizeCategory(body.category || 'clothes');
      const clothingSubcategory = normalizeClothingSubcategory(body.clothing_subcategory || '', category);
      const photos = Array.isArray(body.photos) ? body.photos.map((x) => String(x || '').trim()).filter(Boolean) : [];
      const inventory = body.inventory == null || body.inventory === '' ? 1 : Number(body.inventory);

      if (!['draft', 'active', 'archived'].includes(status)) return json(400, { ok: false, error: 'Invalid status' });
      if (!Number.isInteger(inventory) || inventory < 0) return json(400, { ok: false, error: 'inventory must be integer >= 0' });

      const cents = body.price_cents != null ? Number(body.price_cents) : Math.round(Number(body.price) * 100);
      if (!Number.isInteger(cents) || cents < 0) return json(400, { ok: false, error: 'price must be >= 0' });

      const soldOutSince = inventory <= 0 ? new Date().toISOString() : null;
      const archivedAt = status === 'archived' ? new Date().toISOString() : null;

      const { rows } = await query(
        `INSERT INTO products (id, status, category, clothing_subcategory, title, description, price_cents, currency, photos, inventory, sold_out_since, archived_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
         RETURNING *`,
        [id, status, category, clothingSubcategory, title, description, cents, currency, JSON.stringify(photos), inventory, soldOutSince, archivedAt]
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
