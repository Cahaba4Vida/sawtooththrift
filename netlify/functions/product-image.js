const { query } = require('./_db');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const id = String((event.queryStringParameters && event.queryStringParameters.id) || '').trim();
    if (!id) return { statusCode: 400, body: 'Missing id' };

    const { rows } = await query(
      'SELECT content_type, bytes FROM product_images WHERE id=$1 LIMIT 1',
      [id]
    );

    if (!rows.length) return { statusCode: 404, body: 'Not Found' };

    const row = rows[0];
    const contentType = String(row.content_type || 'application/octet-stream');
    const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes || '');

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: bytes.toString('base64'),
    };
  } catch (_err) {
    return { statusCode: 500, body: 'Server error' };
  }
};
