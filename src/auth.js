// Sessions, API keys, settings access and permission helpers.

import { sha256Hex, verifyPassword } from './crypto.js';
import { randomToken, safeParseJson, HttpError, parseIntOr } from './util.js';

export const SESSION_COOKIE = 'sl_session';
export const CHALLENGE_COOKIE = 'sl_challenge';

// ---------- settings ----------

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const raw = {};
  for (const r of results || []) raw[r.key] = safeParseJson(r.value, undefined);
  return {
    site_name: typeof raw.site_name === 'string' && raw.site_name.trim() ? raw.site_name.trim().slice(0, 40) : 'ShortLink',
    retention_days: parseIntOr(raw.retention_days, 90, { min: 1, max: 3650 }),
    session_days: parseIntOr(raw.session_days, 14, { min: 1, max: 90 }),
    auto_delete_expired_days: parseIntOr(raw.auto_delete_expired_days, 30, { min: 0, max: 3650 }),
    default_mode: ['direct', 'page', 'confirm'].includes(raw.default_mode) ? raw.default_mode : 'direct',
    default_style: raw.default_style && typeof raw.default_style === 'object' ? raw.default_style : {},
  };
}

export async function setSettings(env, patch) {
  const allowed = ['site_name', 'retention_days', 'session_days', 'auto_delete_expired_days', 'default_mode', 'default_style'];
  const stmts = [];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    stmts.push(env.DB.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, JSON.stringify(patch[k])));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

// ---------- sessions ----------

export async function createSession(env, req, userId) {
  const settings = await getSettings(env);
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions(id, user_id, created_at, expires_at, last_seen_at, ip, ua) VALUES(?,?,?,?,?,?,?)'
  )
    .bind(
      id,
      userId,
      now,
      now + settings.session_days * 86400000,
      now,
      req.headers.get('cf-connecting-ip') || '',
      (req.headers.get('user-agent') || '').slice(0, 250)
    )
    .run();
  return { token, maxAge: settings.session_days * 86400 };
}

export function sessionCookieHeader(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

function getCookie(req, name) {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

async function userById(env, id) {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return row || null;
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    role: u.role,
    perms: u.role === 'admin' ? { create_links: true, view_logs: true, use_api: true } : safeParseJson(u.perms, {}),
    domain_ids: u.role === 'admin' ? 'all' : safeParseJson(u.domain_ids, []).map(Number),
    quota_max_links: u.quota_max_links || 0,
    disabled: !!u.disabled,
    has_password: !!u.password_hash,
    created_at: u.created_at,
  };
}

export async function resolveSessionUser(env, req, ctx) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(hash).first();
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(hash).run());
    return null;
  }
  const user = await userById(env, session.user_id);
  if (!user || user.disabled) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(session.user_id).run());
    return null;
  }
  // slide expiry if we're past half the session lifetime
  if (Date.now() - session.last_seen_at > (session.expires_at - session.last_seen_at) / 2) {
    const settings = await getSettings(env);
    ctx.waitUntil(
      env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
        .bind(Date.now(), Date.now() + settings.session_days * 86400000, hash)
        .run()
    );
  }
  return { user, sessionId: hash };
}

export async function destroySession(env, req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return;
  const hash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(hash).run();
}

// ---------- API keys ----------

export const ALL_SCOPES = ['links:read', 'links:write', 'logs:read', 'domains:read'];

export async function resolveApiKey(env, req, ctx) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(sk_[A-Za-z0-9_-]+)\s*$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  const key = await env.DB.prepare('SELECT * FROM api_keys WHERE key_hash = ?').bind(hash).first();
  if (!key) return null;
  if (key.expires_at && key.expires_at < Date.now()) return null;
  const user = await userById(env, key.user_id);
  if (!user || user.disabled) return null;
  ctx.waitUntil(env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(Date.now(), key.id).run());
  return { user, key };
}

// ---------- permissions ----------

export function isAdmin(user) {
  return user.role === 'admin';
}

export function userPerms(user) {
  return safeParseJson(user.perms, {});
}

export function canCreateLinks(user) {
  return isAdmin(user) || !!userPerms(user).create_links;
}

export function canViewLogs(user) {
  return isAdmin(user) || !!userPerms(user).view_logs;
}

export function canUseApi(user) {
  return isAdmin(user) || !!userPerms(user).use_api;
}

export function allowedDomainIds(user) {
  if (isAdmin(user)) return 'all';
  return safeParseJson(user.domain_ids, []).map(Number);
}

export function canAccessDomain(user, domainId) {
  const ids = allowedDomainIds(user);
  return ids === 'all' || ids.includes(Number(domainId));
}

export function canManageLink(user, link) {
  return isAdmin(user) || link.created_by === user.id;
}

// ---------- login ----------

export async function loginWithPassword(env, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'invalid_input', '请输入用户名和密码');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username.trim().toLowerCase()).first();
  // constant-ish response regardless of user existence
  const valid = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!user || !valid) throw new HttpError(401, 'bad_credentials', '用户名或密码错误');
  if (user.disabled) throw new HttpError(403, 'user_disabled', '该账户已被停用');
  return user;
}
