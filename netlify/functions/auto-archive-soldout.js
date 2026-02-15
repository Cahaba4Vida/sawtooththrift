const { query } = require('./_db');

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

    const { rowCount } = await query(
      `UPDATE products
       SET status='archived',
           archived_at=now(),
           updated_at=now()
       WHERE status != 'archived'
         AND inventory <= 0
         AND sold_out_since IS NOT NULL
         AND sold_out_since <= now() - interval '7 days'`
    );

    return json(200, { ok: true, archived_count: Number(rowCount || 0) });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};
