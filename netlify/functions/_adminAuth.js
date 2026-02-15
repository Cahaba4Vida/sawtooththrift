const crypto = require('crypto');

class AdminAuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 120;
const rateState = new Map();

function getHeader(event, name) {
  const headers = (event && event.headers) || {};
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === lower) return Array.isArray(v) ? v.join(',') : String(v || '');
  }
  return '';
}

function parseCookies(cookieHeader) {
  const out = Object.create(null);
  const header = String(cookieHeader || '');
  if (!header) return out;

  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(raw);
  }
  return out;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getClientIp(event) {
  const forwarded = getHeader(event, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const nfIp = getHeader(event, 'x-nf-client-connection-ip');
  if (nfIp) return nfIp.trim();
  return 'unknown';
}

function enforceRateLimit(event) {
  const now = Date.now();
  const ip = getClientIp(event);
  const key = ip || 'unknown';

  const rec = rateState.get(key);
  if (!rec || (now - rec.windowStart) > RATE_WINDOW_MS) {
    rateState.set(key, { windowStart: now, count: 1 });
  } else {
    rec.count += 1;
    if (rec.count > RATE_LIMIT) {
      throw new AdminAuthError(429, 'Too many admin requests. Please retry shortly.');
    }
  }

  if (rateState.size > 5000) {
    const cutoff = now - RATE_WINDOW_MS;
    for (const [k, v] of rateState.entries()) {
      if (v.windowStart < cutoff) rateState.delete(k);
    }
  }
}

function getPresentedToken(event) {
  const cookieHeader = getHeader(event, 'cookie');
  const cookies = parseCookies(cookieHeader);
  if (cookies.admin_auth) return cookies.admin_auth;

  const authHeader = getHeader(event, 'authorization');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireAdmin(event) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) throw new AdminAuthError(500, 'Missing ADMIN_TOKEN env var.');

  enforceRateLimit(event);

  const presented = getPresentedToken(event);
  if (!presented || !safeEqual(presented, expected)) {
    throw new AdminAuthError(401, 'Unauthorized');
  }

  return { ok: true };
}

function authErrorResponse(err) {
  const statusCode = err && err.statusCode ? err.statusCode : 500;
  const message = err && err.message ? err.message : 'Server error';
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ ok: false, error: message }),
  };
}

module.exports = {
  requireAdmin,
  authErrorResponse,
};
