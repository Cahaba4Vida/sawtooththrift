const { query } = require('./_db');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}


async function ensureProductColumns() {
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'clothes'`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS clothing_subcategory TEXT NOT NULL DEFAULT ''`);
}

function toProduct(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    price: Number((Number(row.price_cents || 0) / 100).toFixed(2)),
    price_cents: row.price_cents,
    currency: row.currency || 'usd',
    photos: Array.isArray(row.photos) ? row.photos : [],
    inventory: Number.isInteger(row.inventory) ? row.inventory : Number(row.inventory || 0),
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: String(row.category || 'clothes').toLowerCase(),
    clothing_subcategory: String(row.clothing_subcategory || '').toLowerCase(),
    search_keywords: Array.isArray(row.search_keywords) ? row.search_keywords : [],
    source_notes: row.source_notes || '',
    buy_price_max_cents: row.buy_price_max_cents,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

exports.handler = async (event) => {
  try {
    if ((event && event.httpMethod) !== 'GET') return json(405, { ok: false, error: 'Method Not Allowed' });

    await ensureProductColumns();

    const { rows } = await query(
      `SELECT id,status,category,clothing_subcategory,title,description,price_cents,currency,photos,inventory,tags,search_keywords,source_notes,buy_price_max_cents,created_at,updated_at
       FROM products
       WHERE status='active'
       ORDER BY created_at DESC`
    );

    return json(200, { ok: true, products: rows.map(toProduct) });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error', products: [] });
  }
};
