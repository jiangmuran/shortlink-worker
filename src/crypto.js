// Password hashing (PBKDF2 via WebCrypto), digests and HMAC-signed values.
// The Workers runtime exposes the standard WebCrypto API.

const PBKDF2_ITERATIONS = 100000;

export function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return crypto.subtle.digest('SHA-256', bytes).then((buf) => {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  });
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1], 10);
  const salt = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
  const expected = atob(parts[3]);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  const actual = String.fromCharCode(...new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---- Signed (tamper-evident) short-lived values, used for WebAuthn challenges ----
// The HMAC secret must be stable across isolates (Cloudflare may serve requests
// from different instances), so it is persisted in D1 on first use via
// `ensureSignSecret()`. Callers must await that before signing/verifying.

let hmacKeyPromise = null;
let hmacSecretHex = null;

export async function ensureSignSecret(env) {
  if (hmacSecretHex) return;
  const existing = await env.DB
    .prepare("SELECT value FROM settings WHERE key = 'wa_sign_secret'")
    .first();
  if (existing?.value) {
    hmacSecretHex = existing.value;
  } else {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DB
      .prepare("INSERT INTO settings(key, value) VALUES('wa_sign_secret', ?) ON CONFLICT(key) DO NOTHING")
      .bind(hex)
      .run();
    const winner = await env.DB
      .prepare("SELECT value FROM settings WHERE key = 'wa_sign_secret'")
      .first();
    hmacSecretHex = winner.value;
  }
}

function getHmacKey() {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('shortlink-wa:' + hmacSecretHex),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }
  return hmacKeyPromise;
}

export async function signValue(payload) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getHmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return b64url(body) + '.' + b64url(sig);
}

export async function verifyValue(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  let body, sig;
  try {
    body = b64urlBytes(token.slice(0, dot));
    sig = b64urlBytes(token.slice(dot + 1));
  } catch {
    return null;
  }
  const key = await getHmacKey();
  const valid = await crypto.subtle.verify('HMAC', key, sig, body);
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(body));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function b64url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- Server-side note encryption (notes created without end-to-end encryption) ----
// A random AES-256 key persisted in D1 (settings.note_secret), so admins with
// content permission can read reported notes. End-to-end notes never use it.

let noteKeyPromise = null;

async function noteKey(env) {
  if (!noteKeyPromise) {
    noteKeyPromise = (async () => {
      let row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'note_secret'").first();
      if (!row?.value) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
        await env.DB.prepare("INSERT INTO settings(key, value) VALUES('note_secret', ?) ON CONFLICT(key) DO NOTHING").bind(hex).run();
        row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'note_secret'").first();
      }
      const raw = new Uint8Array(row.value.match(/.{2}/g).map((h) => parseInt(h, 16)));
      return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    })().catch((e) => {
      noteKeyPromise = null;
      throw e;
    });
  }
  return noteKeyPromise;
}

export async function serverEncrypt(env, plaintext) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await noteKey(env), new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function serverDecrypt(env, blob) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await noteKey(env), bytes.subarray(12));
  return new TextDecoder().decode(pt);
}
