const { query } = require('./_db');
const { requireAdmin, authErrorResponse } = require('./_adminAuth');

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
  if (!match) throw new Error('Missing multipart boundary.');
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
      if (!bytes.length) throw new Error('Uploaded file is empty.');
      file = { filename, contentType: contentTypeValue, bytes };
    } else if (fieldName) {
      fields[fieldName] = bodyText.trim();
    }
  }

  if (!file) throw new Error('Missing file field in multipart upload.');
  return { file, fields };
}

async function uploadToCloudinary(file) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw Object.assign(new Error('Missing Cloudinary env vars. Required: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'), { statusCode: 500 });
  }

  const form = new FormData();
  form.append('file', new Blob([file.bytes], { type: file.contentType }), file.filename);
  form.append('folder', 'sawtooththrift/admin-products');

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error && data.error.message ? data.error.message : `Cloudinary upload failed (${res.status})`;
    throw Object.assign(new Error(msg), { statusCode: 502 });
  }

  return String(data.secure_url || data.url || '').trim();
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

    const { file, fields } = parseMultipart(event);
    if (!String(file.contentType).toLowerCase().startsWith('image/')) {
      return json(400, { ok: false, error: 'Only image uploads are allowed.' });
    }

    const productId = String((event.queryStringParameters && event.queryStringParameters.product_id) || fields.product_id || '').trim();
    if (productId) {
      const { rows } = await query('SELECT status FROM products WHERE id=$1 LIMIT 1', [productId]);
      if (!rows.length) return json(404, { ok: false, error: 'Product not found' });
      if (String(rows[0].status || '').toLowerCase() === 'archived') {
        return json(400, { ok: false, error: 'Cannot add photos to archived products' });
      }
    }

    const url = await uploadToCloudinary(file);
    if (!url) return json(502, { ok: false, error: 'Cloudinary did not return a URL.' });

    return json(200, { ok: true, url });
  } catch (err) {
    return json(err.statusCode || 500, { ok: false, error: err.message || 'Server error' });
  }
};
