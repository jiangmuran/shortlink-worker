// Small shared utilities: encoding, validation, formatting, JSON responses.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export function b64urlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  if (!B64URL_RE.test(str)) throw new Error('invalid base64url');
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlToHex(str) {
  return [...b64urlDecode(str)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function randomToken(n = 32) {
  return b64urlEncode(randomBytes(n));
}

// Unambiguous alphabet for random short codes.
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode(len = 6) {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[out[i] % CODE_ALPHABET.length];
  return s;
}

export function isValidCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code);
}

export function isValidHostname(h) {
  return (
    typeof h === 'string' &&
    h.length <= 253 &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)
  );
}

export function normalizeTargetUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  return u.toString();
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}

export function ok(data, init = {}) {
  return json({ ok: true, data }, init);
}

export function fail(err) {
  if (err instanceof HttpError) {
    return json({ ok: false, error: { code: err.code, message: err.message, ...(err.extra || {}) } }, { status: err.status });
  }
  console.error('unhandled error:', err);
  return json({ ok: false, error: { code: 'internal', message: '服务器内部错误' } }, { status: 500 });
}

export function safeParseJson(text, fallback) {
  if (typeof text !== 'string') {
    return text === null || text === undefined ? fallback : text;
  }
  try {
    const v = JSON.parse(text);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export async function readJsonBody(req) {
  try {
    const v = await req.json();
    if (!v || typeof v !== 'object') throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'invalid_json', '请求体不是有效的 JSON');
  }
}

export function parseIntOr(v, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function parseDateToMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) {
    // accept seconds or ms
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

export function clampStyle(style, mode, siteDefaults = {}) {
  // Validate user-provided redirect page customization.
  const ANIMS = ['orbit', 'progress', 'pulse', 'fade'];
  const hex = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);
  const out = {};
  if (mode === 'page') {
    out.animation = ANIMS.includes(style.animation) ? style.animation : siteDefaults.animation || 'orbit';
    out.duration = parseIntOr(style.duration, 1200, { min: 500, max: 5000 });
    out.title = str(style.title, 80);
    out.desc = str(style.desc, 140);
    out.color = hex(style.color) || siteDefaults.color || null;
  } else if (mode === 'confirm') {
    out.title = str(style.title, 80);
    out.desc = str(style.desc, 140);
    out.button = str(style.button, 30);
    out.color = hex(style.color) || siteDefaults.color || null;
  }
  return out;

  function str(v, max) {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  }
}

export function linkUrl(domainHostname, code) {
  return `https://${domainHostname}/${code}`;
}
