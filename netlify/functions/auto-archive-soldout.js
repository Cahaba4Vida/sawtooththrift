const { query, withTransaction } = require('./_db');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.config = {
  schedule: '0 */6 * * *',
};

exports.handler = async () => {
  try {
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_out_since TIMESTAMPTZ`);
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);

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

    const result = await withTransaction(async (client) => {
      const candidates = await client.query(
        `SELECT id
         FROM products
         WHERE status != 'archived'
           AND inventory <= 0
           AND sold_out_since IS NOT NULL
           AND sold_out_since <= now() - interval '7 days'
         FOR UPDATE`
      );

      const productIds = candidates.rows.map((row) => row.id).filter(Boolean);
      if (!productIds.length) return { archivedCount: 0, deletedPhotosCount: 0 };

      const deleted = await client.query(
        `DELETE FROM product_images
         WHERE product_id = ANY($1::text[])`,
        [productIds]
      );

      const archived = await client.query(
        `UPDATE products
         SET status='archived',
             photos='[]'::jsonb,
             archived_at=now(),
             updated_at=now()
         WHERE id = ANY($1::text[])`,
        [productIds]
      );

      return {
        archivedCount: Number(archived.rowCount || 0),
        deletedPhotosCount: Number(deleted.rowCount || 0),
      };
    });

    return json(200, {
      ok: true,
      archived_count: result.archivedCount,
      photos_deleted_count: result.deletedPhotosCount,
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};
