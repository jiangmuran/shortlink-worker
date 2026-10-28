// Sessions, API keys, settings access and permission helpers.

import { sha256Hex, verifyPassword } from './crypto.js';
import { randomToken, safeParseJson, HttpError, parseIntOr } from './util.js';
import { FULL_CAPS, FALLBACK_CAPS, ALL_SCOPES, ADMIN_PERMS, normalizeCaps, mergeCaps } from './caps.js';

export { ALL_SCOPES };

export const SESSION_COOKIE = 'sl_session';
export const CHALLENGE_COOKIE = 'sl_challenge';

// ---------- settings (cached per isolate: read on every redirect) ----------

const SETTINGS_TTL = 30_000;
let settingsCache = null;

export async function getSettings(env) {
  if (settingsCache && settingsCache.expires > Date.now()) return settingsCache.value;
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const raw = {};
  for (const r of results || []) raw[r.key] = safeParseJson(r.value, undefined);
  const value = {
    site_name: typeof raw.site_name === 'string' && raw.site_name.trim() ? raw.site_name.trim().slice(0, 40) : 'ShortLink',
    retention_days: parseIntOr(raw.retention_days, 90, { min: 1, max: 3650 }),
    session_days: parseIntOr(raw.session_days, 14, { min: 1, max: 90 }),
    auto_delete_expired_days: parseIntOr(raw.auto_delete_expired_days, 30, { min: 0, max: 3650 }),
    default_mode: ['direct', 'page', 'confirm'].includes(raw.default_mode) ? raw.default_mode : 'direct',
    default_style: raw.default_style && typeof raw.default_style === 'object' ? raw.default_style : {},
    rollup_until: Number(raw.rollup_until) || 0,
  };
  settingsCache = { value, expires: Date.now() + SETTINGS_TTL };
  return value;
}

export async function setSettings(env, patch) {
  const allowed = ['site_name', 'retention_days', 'session_days', 'auto_delete_expired_days', 'default_mode', 'default_style', 'rollup_until'];
  const stmts = [];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    stmts.push(env.DB.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, JSON.stringify(patch[k])));
  }
  if (stmts.length) await env.DB.batch(stmts);
  settingsCache = null;
}

// ---------- groups (cached per isolate) ----------

const GROUP_TTL = 30_000;
const groupCache = new Map();

export async function getGroup(env, id) {
  if (!id) return null;
  const hit = groupCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = await env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first();
  const value = row ? { ...row, caps: normalizeCaps(safeParseJson(row.caps, {})) } : null;
  groupCache.set(id, { value, expires: Date.now() + GROUP_TTL });
  return value;
}

export function invalidateGroup(id) {
  if (id) groupCache.delete(Number(id));
  else groupCache.clear();
}

// Attach effective capabilities to a user row (mutates and returns it).
export async function hydrateUser(env, user) {
  if (!user) return user;
  if (user.role === 'admin') {
    user._caps = FULL_CAPS;
    user._group = null;
    return user;
  }
  const group = await getGroup(env, user.group_id);
  const base = group ? group.caps : FALLBACK_CAPS;
  user._group = group ? { id: group.id, name: group.name, builtin: group.builtin } : null;
  user._caps = mergeCaps(base, normalizeCaps(safeParseJson(user.caps_override, {}), { partial: true }));
  return user;
}

export function userActive(user) {
  if (!user || user.disabled) return false;
  if (user.expires_at && user.expires_at < Date.now()) return false;
  return true;
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

export function adminPermsOf(user) {
  if (user.is_owner) return Object.fromEntries(ADMIN_PERMS.map((p) => [p, true]));
  if (user.role !== 'admin') return Object.fromEntries(ADMIN_PERMS.map((p) => [p, false]));
  const raw = safeParseJson(user.admin_perms, {});
  return Object.fromEntries(ADMIN_PERMS.map((p) => [p, !!raw[p]]));
}

export function publicUser(u) {
  const caps = u._caps || FALLBACK_CAPS;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    role: u.role,
    is_owner: !!u.is_owner,
    admin_perms: adminPermsOf(u),
    group: u._group || null,
    group_id: u.group_id || null,
    caps,
    caps_override: safeParseJson(u.caps_override, {}),
    // legacy fields kept for API compatibility
    perms: { create_links: !!caps.links.create, view_logs: !!caps.logs.view, use_api: !!caps.api.use },
    quota_max_links: caps.links.max,
    domain_ids: u.role === 'admin' ? 'all' : safeParseJson(u.domain_ids, []).map(Number),
    disabled: !!u.disabled,
    frozen: !!u.frozen_at,
    expires_at: u.expires_at || null,
    must_change_password: !!u.must_change_password,
    has_password: !!u.password_hash,
    note: u.note || '',
    created_via: u.created_via || '',
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
  if (!userActive(user)) {
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
  return { user: await hydrateUser(env, user), sessionId: hash };
}

export async function destroySession(env, req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return;
  const hash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(hash).run();
}

// ---------- API keys ----------

export async function resolveApiKey(env, req, ctx) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(sk_[A-Za-z0-9_-]+)\s*$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  const key = await env.DB.prepare('SELECT * FROM api_keys WHERE key_hash = ?').bind(hash).first();
  if (!key) return null;
  if (key.expires_at && key.expires_at < Date.now()) return null;
  const user = await userById(env, key.user_id);
  if (!userActive(user)) return null;
  await hydrateUser(env, user);
  if (!user._caps.api.use) return null;
  ctx.waitUntil(env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(Date.now(), key.id).run());
  return { user, key };
}

// Scopes a key may actually use: what it was created with ∩ what the group allows now.
export function effectiveScopes(user, key) {
  const allowed = user._caps.api.scopes;
  return safeParseJson(key.scopes, []).filter((s) => allowed.includes(s));
}

// ---------- permissions ----------

export function isAdmin(user) {
  return user.role === 'admin';
}

export function adminPerm(user, perm) {
  return adminPermsOf(user)[perm] === true;
}

// Sees and manages everyone's links, notes and logs.
export function canSeeAll(user) {
  return adminPerm(user, 'content');
}

export function capsOf(user) {
  return user._caps || FALLBACK_CAPS;
}

export function canCreateLinks(user) {
  return !!capsOf(user).links.create;
}

export function canViewLogs(user) {
  return !!capsOf(user).logs.view;
}

export function canUseApi(user) {
  return !!capsOf(user).api.use;
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
  return canSeeAll(user) || link.created_by === user.id;
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
  assertCanSignIn(user);
  return user;
}

export function assertCanSignIn(user) {
  if (user.frozen_at) throw new HttpError(403, 'user_frozen', '该账户已被冻结');
  if (user.disabled) throw new HttpError(403, 'user_disabled', '该账户已被停用');
  if (user.expires_at && user.expires_at < Date.now()) throw new HttpError(403, 'user_expired', '该账户已过期');
}
