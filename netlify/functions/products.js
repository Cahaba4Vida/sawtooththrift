/**
 * Netlify Function: products
 *
 * Returns catalog JSON from Neon/Postgres when configured, otherwise falls back
 * to /public/data/products.json at runtime.
 *
 * Env:
 * - PRODUCTS_DATABASE_URL (preferred) or DATABASE_URL
 * - PRODUCTS_TABLE (optional, default: catalog)
 */

const fs = require("fs/promises");
const path = require("path");

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

async function readStaticCatalog() {
  const file = path.resolve(process.cwd(), "public/data/products.json");
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  return {
    currency: parsed.currency || "USD",
    products: Array.isArray(parsed.products) ? parsed.products : [],
    source: "static",
  };
}

async function readCatalogFromDb() {
  const connectionString = process.env.PRODUCTS_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;

  // Lazy import so static mode works even if pg is not installed in local preview.
  // eslint-disable-next-line global-require
  const { Client } = require("pg");

  const table = process.env.PRODUCTS_TABLE || "catalog";
  const safeTable = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table) ? table : "catalog";

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const q = `SELECT currency, products FROM ${safeTable} ORDER BY updated_at DESC NULLS LAST LIMIT 1`;
    const { rows } = await client.query(q);
    if (!rows.length) return { currency: "USD", products: [], source: "neon" };

    const row = rows[0] || {};
    return {
      currency: row.currency || "USD",
      products: Array.isArray(row.products) ? row.products : [],
      source: "neon",
    };
  } finally {
    await client.end().catch(() => {});
  }
}

exports.handler = async () => {
  try {
    const dbCatalog = await readCatalogFromDb();
    if (dbCatalog) return json(200, { ok: true, ...dbCatalog });

    const staticCatalog = await readStaticCatalog();
    return json(200, { ok: true, ...staticCatalog });
  } catch (err) {
    return json(500, {
      ok: false,
      error: err.message || "Failed to load catalog",
    });
  }
};
