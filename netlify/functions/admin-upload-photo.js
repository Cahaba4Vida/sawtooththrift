const crypto = require('crypto');
const { query } = require('./_db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

const MAX_FILE_BYTES = 6 * 1024 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function getHeader(event, name) {
  const headers = event && event.headers ? event.headers : {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : '';
}

function parseMultipart(event) {
  const contentType = String(getHeader(event, 'content-type') || '');
  const match = contentType.match(/boundary=([^;]+)/i);
  if (!match) throw Object.assign(new Error('Missing multipart boundary.'), { statusCode: 400 });
  const boundary = match[1].trim().replace(/^"|"$/g, '');
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'utf8');
  const data = raw.toString('latin1');
  const parts = data.split(`--${boundary}`);

  let file = null;
  const fields = {};

  for (const part of parts) {
    if (!part || part === '--') continue;
    const clean = part.replace(/^\r\n/, '').replace(/\r\n--$/, '').replace(/\r\n$/, '');
    const splitIndex = clean.indexOf('\r\n\r\n');
    if (splitIndex < 0) continue;

    const headerText = clean.slice(0, splitIndex);
    const bodyText = clean.slice(splitIndex + 4);

    const nameMatch = headerText.match(/name="([^"]+)"/i);
    const fieldName = nameMatch ? nameMatch[1] : '';
    const filenameMatch = headerText.match(/filename="([^"]+)"/i);

    if (filenameMatch && fieldName === 'file') {
      const mimeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
      const filename = filenameMatch[1] || `upload-${Date.now()}.jpg`;
      const contentTypeValue = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';
      const bytes = Buffer.from(bodyText, 'latin1');
      if (!bytes.length) throw Object.assign(new Error('Uploaded file is empty.'), { statusCode: 400 });
      file = { filename, contentType: contentTypeValue, bytes };
    } else if (fieldName) {
      fields[fieldName] = bodyText.trim();
    }
  }

  if (!file) throw Object.assign(new Error('Missing file field in multipart upload.'), { statusCode: 400 });
  return { file, fields };
}

async function ensureImageTable() {
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

exports.handler = async (event) => {
  try {
    try {
      requireAdmin(event);
    } catch (err) {
      return authErrorResponse(err);
    }

    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' });

    const contentType = String(getHeader(event, 'content-type') || '').toLowerCase();
    if (!contentType.startsWith('multipart/form-data')) {
      return json(400, { ok: false, error: 'Content-Type must be multipart/form-data' });
    }

    await ensureImageTable();

    const { file, fields } = parseMultipart(event);
    const normalizedType = String(file.contentType || '').toLowerCase();
    if (!normalizedType.startsWith('image/')) {
      return json(400, { ok: false, error: 'Only image uploads are allowed.' });
    }

    if (file.bytes.length > MAX_FILE_BYTES) {
      return json(413, { ok: false, error: 'Image must be 6MB or smaller.' });
    }

    const productId = String((event.queryStringParameters && event.queryStringParameters.product_id) || fields.product_id || '').trim();
    if (!productId) {
      return json(400, { ok: false, error: 'Missing product_id' });
    }

    const { rows } = await query('SELECT status FROM products WHERE id=$1 LIMIT 1', [productId]);
    if (!rows.length) return json(404, { ok: false, error: 'Product not found' });
    if (String(rows[0].status || '').toLowerCase() === 'archived') {
      return json(400, { ok: false, error: 'Cannot add photos to archived products' });
    }

    const imageId = crypto.randomUUID();
    await query(
      'INSERT INTO product_images (id, product_id, content_type, bytes) VALUES ($1,$2,$3,$4)',
      [imageId, productId, file.contentType, file.bytes]
    );

    const url = `/.netlify/functions/product-image?id=${encodeURIComponent(imageId)}`;
    return json(200, { ok: true, imageId, url });
  } catch (err) {
    return json(err.statusCode || 500, { ok: false, error: err.message || 'Server error' });
  }
};
