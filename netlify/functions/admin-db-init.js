const fs = require('fs');
const path = require('path');
const { query } = require('./_db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

const REQUIRED_TABLES = ['products', 'ai_opportunities', 'processed_stripe_sessions'];
const schemaPath = path.resolve(__dirname, '../../db/schema.sql');


async function applySchemaUpgrades() {
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_out_since TIMESTAMPTZ`);
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS buy_links JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE ai_opportunities ADD COLUMN IF NOT EXISTS local_pickup JSONB NOT NULL DEFAULT '[]'::jsonb`);
}

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

async function getSchemaStatus() {
  const { rows } = await query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES]
  );

  const found = new Set(rows.map((r) => r.table_name));
  const tables = {};
  for (const tableName of REQUIRED_TABLES) tables[tableName] = found.has(tableName);
  return tables;
}

exports.handler = async (event) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    if (event.httpMethod === 'GET') {
      const tables = await getSchemaStatus();
      return json(200, { ok: true, tables });
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { ok: false, error: 'Method Not Allowed' });
    }

    if (!fs.existsSync(schemaPath)) {
      return json(500, { ok: false, error: 'Schema file db/schema.sql is missing.' });
    }

    const sql = fs.readFileSync(schemaPath, 'utf8').trim();
    if (!sql) {
      return json(500, { ok: false, error: 'Schema file db/schema.sql is empty.' });
    }

    await query(sql);
    await applySchemaUpgrades();
    const tables = await getSchemaStatus();
    const created = REQUIRED_TABLES.filter((name) => tables[name]);

    return json(200, { ok: true, created, tables });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Server error' });
  }
};
