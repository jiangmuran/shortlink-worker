// /api/users, /api/groups, /api/access-tokens, /api/audit, /api/keys,
// /api/settings, /api/admin/cleanup — administration.

import {
  isAdmin,
  adminPerm,
  canUseApi,
  capsOf,
  getSettings,
  setSettings,
  publicUser,
  hydrateUser,
  getGroup,
  invalidateGroup,
} from './auth.js';
import { ALL_SCOPES, ADMIN_PERMS, normalizeCaps, diffCaps, FALLBACK_CAPS } from './caps.js';
import { hashPassword, sha256Hex } from './crypto.js';
import { runMaintenance } from './cleanup.js';
import { audit } from './audit.js';
import { todayUsage } from './usage.js';
import { ok, HttpError, readJsonBody, randomToken, parseIntOr, safeParseJson } from './util.js';

const DAY = 86400000;

function parseDomainIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function parseScopes(raw, allowed = ALL_SCOPES) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter((s) => allowed.includes(s)))];
}

function parseAdminPerms(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(ADMIN_PERMS.map((k) => [k, !!p[k]]));
}

// Legacy body fields (perms / quota_max_links) → caps override entries.
function legacyOverride(body) {
  const o = {};
  if (body.perms && typeof body.perms === 'object') {
    if (body.perms.create_links !== undefined) (o.links ||= {}).create = !!body.perms.create_links;
    if (body.perms.view_logs !== undefined) (o.logs ||= {}).view = !!body.perms.view_logs;
    if (body.perms.use_api !== undefined) {
      (o.api ||= {}).use = !!body.perms.use_api;
      if (body.perms.use_api) o.api.scopes = [...ALL_SCOPES];
    }
  }
  if (body.quota_max_links !== undefined) (o.links ||= {}).max = parseIntOr(body.quota_max_links, 100, { min: 0, max: 1_000_000 });
  return o;
}

function parseExpiry(body) {
  if (body.expires_in_days !== undefined && body.expires_in_days !== null && body.expires_in_days !== '') {
    const d = parseIntOr(body.expires_in_days, 0, { min: 0, max: 3650 });
    return d > 0 ? Date.now() + d * DAY : null;
  }
  if (body.expires_at !== undefined) {
    if (!body.expires_at) return null;
    const t = typeof body.expires_at === 'number' ? body.expires_at : Date.parse(body.expires_at);
    return Number.isFinite(t) ? t : null;
  }
  return undefined;
}

async function resolveGroupId(env, raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const g = await getGroup(env, Number(raw));
  if (!g) throw new HttpError(400, 'invalid_group', '用户组不存在');
  return g.id;
}

async function defaultGroupId(env) {
  const row = await env.DB.prepare("SELECT id FROM groups WHERE builtin = 'member'").first();
  return row?.id || null;
}

async function userWithCounts(env, row) {
  await hydrateUser(env, row);
  const [links, notes, keys, passkeys, tokens] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE created_by = ? AND kind = 'link'").bind(row.id).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM links l JOIN notes n ON n.link_id = l.id WHERE l.created_by = ? AND n.burned_at IS NULL").bind(row.id).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?').bind(row.id).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(row.id).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM access_tokens WHERE kind = 'login' AND user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR uses < max_uses)").bind(row.id, Date.now()).first(),
  ]);
  return {
    ...publicUser(row),
    link_count: links.n,
    note_count: notes.n,
    key_count: keys.n,
    passkey_count: passkeys.n,
    login_link_count: tokens.n,
  };
}

// Admin accounts (and the owner) can only be touched by the owner.
function assertCanManage(actor, target) {
  if (target.is_owner && actor.id !== target.id) throw new HttpError(403, 'forbidden', '不能修改所有者账户');
  if (target.role === 'admin' && !actor.is_owner && actor.id !== target.id) {
    throw new HttpError(403, 'forbidden', '只有所有者可以管理管理员账户');
  }
}

function tokenUrl(req, kind, token) {
  const origin = new URL(req.url).origin;
  return kind === 'invite' ? `${origin}/invite/${token}` : `${origin}/login/${token}`;
}

function tokenFromRow(t) {
  const now = Date.now();
  let status = 'active';
  if (t.revoked_at) status = 'revoked';
  else if (t.expires_at && t.expires_at < now) status = 'expired';
  else if (t.max_uses > 0 && t.uses >= t.max_uses) status = 'used_up';
  return {
    id: t.id,
    kind: t.kind,
    prefix: t.prefix,
    label: t.label,
    user: t.user_id ? { id: t.user_id, username: t.username || `#${t.user_id}` } : null,
    group: t.group_id ? { id: t.group_id, name: t.group_name || `#${t.group_id}` } : null,
    domain_ids: safeParseJson(t.domain_ids, []),
    account_days: t.account_days || null,
    max_uses: t.max_uses,
    uses: t.uses,
    expires_at: t.expires_at || null,
    created_at: t.created_at,
    last_used_at: t.last_used_at || null,
    creator: t.creator_name || null,
    status,
  };
}

export function registerAdminRoutes(r) {
  // ---------- users ----------

  r.get(
    '/api/users',
    async (ctx) => {
      const { results } = await ctx.env.DB.prepare('SELECT * FROM users ORDER BY is_owner DESC, role ASC, id ASC').all();
      const items = [];
      for (const row of results || []) items.push(await userWithCounts(ctx.env, row));
      return ok({ items });
    },
    { auth: 'admin', perm: 'users' }
  );

  r.get(
    '/api/users/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户不存在');
      const [item, usage, recent] = await Promise.all([
        userWithCounts(ctx.env, row),
        todayUsage(ctx.env, row.id),
        ctx.env.DB.prepare('SELECT ts, action, target_type, target_id, detail, ip FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 20').bind(row.id).all(),
      ]);
      return ok({ item, usage_today: usage, recent_actions: recent.results || [] });
    },
    { auth: 'admin', perm: 'users' }
  );

  r.post(
    '/api/users',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_.-]{2,32}$/.test(username)) {
        throw new HttpError(400, 'invalid_username', '用户名需为 2-32 位字母、数字或 _ . -');
      }
      const password = String(body.password || '');
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (role === 'admin' && !ctx.user.is_owner) throw new HttpError(403, 'forbidden', '只有所有者可以创建管理员');
      if (role === 'admin' && !password) throw new HttpError(400, 'invalid_input', '管理员必须设置密码');
      if (password && password.length < 8) throw new HttpError(400, 'weak_password', '密码至少需要 8 个字符');
      const exists = await ctx.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
      if (exists) throw new HttpError(409, 'username_taken', '用户名已存在');

      const groupId = role === 'admin' ? null : (await resolveGroupId(ctx.env, body.group_id)) ?? (await defaultGroupId(ctx.env));
      const group = groupId ? await getGroup(ctx.env, groupId) : null;
      let override = {};
      if (role === 'user') {
        const wanted = normalizeCaps({ ...legacyOverride(body), ...(body.caps_override || {}) }, { partial: true });
        override = diffCaps(group ? group.caps : FALLBACK_CAPS, wanted);
      }
      const now = Date.now();
      const expiresAt = parseExpiry(body) ?? null;
      const res = await ctx.env.DB
        .prepare(
          `INSERT INTO users(username, display_name, password_hash, role, perms, domain_ids, quota_max_links, disabled, created_at, updated_at,
             group_id, caps_override, admin_perms, expires_at, must_change_password, note, created_via)
           VALUES(?,?,?,?,'{}',?,0,?,?,?,?,?,?,?,?,?,'admin')`
        )
        .bind(
          username,
          String(body.display_name || '').trim().slice(0, 60),
          password ? await hashPassword(password) : null,
          role,
          JSON.stringify(role === 'admin' ? [] : parseDomainIds(body.domain_ids)),
          body.disabled ? 1 : 0,
          now,
          now,
          groupId,
          JSON.stringify(override),
          JSON.stringify(role === 'admin' ? parseAdminPerms(body.admin_perms ?? { users: true, domains: true, settings: true, content: true }) : {}),
          expiresAt,
          password && body.must_change_password ? 1 : 0,
          String(body.note || '').trim().slice(0, 200)
        )
        .run();
      audit(ctx, 'user.create', { type: 'user', id: res.meta.last_row_id, detail: `${username}（${role === 'admin' ? '管理员' : group?.name || '成员'}）` });
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(res.meta.last_row_id).first();
      return ok({ item: await userWithCounts(ctx.env, row) }, { status: 201 });
    },
    { auth: 'admin', perm: 'users' }
  );

  r.patch(
    '/api/users/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户不存在');
      assertCanManage(ctx.user, row);
      const body = await readJsonBody(ctx.req);
      const sets = [];
      const params = [];
      const changes = [];
      const selfEdit = row.id === ctx.user.id;
      let privilegeChange = false;

      if (body.display_name !== undefined) {
        sets.push('display_name = ?');
        params.push(String(body.display_name).trim().slice(0, 60));
      }
      if (body.note !== undefined) {
        sets.push('note = ?');
        params.push(String(body.note).trim().slice(0, 200));
      }
      if (body.password !== undefined && String(body.password || '') !== '') {
        const password = String(body.password);
        if (password.length < 8) throw new HttpError(400, 'weak_password', '密码至少需要 8 个字符');
        sets.push('password_hash = ?');
        params.push(await hashPassword(password));
        changes.push('重置密码');
        privilegeChange = true;
      }
      if (body.must_change_password !== undefined) {
        sets.push('must_change_password = ?');
        params.push(body.must_change_password ? 1 : 0);
      }
      let role = row.role;
      if (body.role !== undefined) {
        const wantRole = body.role === 'admin' ? 'admin' : 'user';
        if (wantRole !== row.role) {
          if (!ctx.user.is_owner) throw new HttpError(403, 'forbidden', '只有所有者可以修改角色');
          if (row.is_owner) throw new HttpError(400, 'owner_role', '所有者必须是管理员');
          role = wantRole;
          sets.push('role = ?');
          params.push(wantRole);
          changes.push(`角色 → ${wantRole === 'admin' ? '管理员' : '成员'}`);
          privilegeChange = true;
          if (wantRole === 'admin') {
            sets.push('admin_perms = ?');
            params.push(JSON.stringify(parseAdminPerms(body.admin_perms ?? { users: true, domains: true, settings: true, content: true })));
          }
        }
      }
      if (body.admin_perms !== undefined && role === 'admin' && body.role === undefined) {
        if (!ctx.user.is_owner) throw new HttpError(403, 'forbidden', '只有所有者可以修改管理权限');
        sets.push('admin_perms = ?');
        params.push(JSON.stringify(parseAdminPerms(body.admin_perms)));
        changes.push('管理权限');
        privilegeChange = true;
      }

      let groupId = row.group_id;
      if (body.group_id !== undefined && role === 'user') {
        groupId = await resolveGroupId(ctx.env, body.group_id);
        if (groupId !== row.group_id) {
          sets.push('group_id = ?');
          params.push(groupId);
          changes.push('用户组');
          privilegeChange = true;
        }
      }
      if ((body.caps_override !== undefined || body.perms !== undefined || body.quota_max_links !== undefined) && role === 'user') {
        const group = groupId ? await getGroup(ctx.env, groupId) : null;
        const base = body.caps_override === null ? {} : normalizeCaps(safeParseJson(row.caps_override, {}), { partial: true });
        const incoming = normalizeCaps({ ...legacyOverride(body), ...(body.caps_override || {}) }, { partial: true });
        const merged = {};
        for (const s of new Set([...Object.keys(base), ...Object.keys(incoming)])) merged[s] = { ...(base[s] || {}), ...(incoming[s] || {}) };
        sets.push('caps_override = ?');
        params.push(JSON.stringify(diffCaps(group ? group.caps : FALLBACK_CAPS, body.caps_override === null ? {} : merged)));
        changes.push('个人权限');
        privilegeChange = true;
      }
      if (body.domain_ids !== undefined) {
        sets.push('domain_ids = ?');
        params.push(JSON.stringify(parseDomainIds(body.domain_ids)));
        changes.push('可用域名');
      }
      const expiresAt = parseExpiry(body);
      if (expiresAt !== undefined) {
        if (selfEdit && expiresAt) throw new HttpError(400, 'invalid_input', '不能给自己设置到期时间');
        sets.push('expires_at = ?');
        params.push(expiresAt);
        changes.push(expiresAt ? `到期 ${new Date(expiresAt).toISOString().slice(0, 10)}` : '取消到期');
      }
      if (body.disabled !== undefined) {
        if (selfEdit && body.disabled) throw new HttpError(400, 'cannot_disable_self', '不能停用自己的账户');
        sets.push('disabled = ?');
        params.push(body.disabled ? 1 : 0);
        changes.push(body.disabled ? '停用' : '启用');
        privilegeChange = true;
      }
      if (!sets.length) return ok({ item: await userWithCounts(ctx.env, row) });

      sets.push('updated_at = ?');
      params.push(Date.now(), row.id);
      await ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

      if (privilegeChange) {
        const keep = selfEdit ? ctx.sessionId : '';
        await ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(row.id, keep).run();
      }
      audit(ctx, 'user.update', { type: 'user', id: row.id, detail: `${row.username}：${changes.join('、') || '资料'}` });
      const updated = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.id).first();
      return ok({ item: await userWithCounts(ctx.env, updated) });
    },
    { auth: 'admin', perm: 'users' }
  );

  // Freeze: disable the account and everything it published, sign it out everywhere.
  r.post(
    '/api/users/:id/freeze',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户不存在');
      assertCanManage(ctx.user, row);
      if (row.id === ctx.user.id) throw new HttpError(400, 'invalid_input', '不能冻结自己');
      const body = await readJsonBody(ctx.req);
      const now = Date.now();
      if (body.frozen === false) {
        const res = await ctx.env.DB.batch([
          ctx.env.DB.prepare('UPDATE users SET frozen_at = NULL, disabled = 0, updated_at = ? WHERE id = ?').bind(now, row.id),
          ctx.env.DB.prepare('UPDATE links SET enabled = 1, frozen = 0 WHERE created_by = ? AND frozen = 1').bind(row.id),
        ]);
        audit(ctx, 'user.unfreeze', { type: 'user', id: row.id, detail: row.username });
        return ok({ restored: res[1].meta.changes || 0 });
      }
      const res = await ctx.env.DB.batch([
        ctx.env.DB.prepare('UPDATE users SET frozen_at = ?, disabled = 1, updated_at = ? WHERE id = ?').bind(now, now, row.id),
        ctx.env.DB.prepare('UPDATE links SET enabled = 0, frozen = 1 WHERE created_by = ? AND enabled = 1').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, row.id),
      ]);
      audit(ctx, 'user.freeze', { type: 'user', id: row.id, detail: `${row.username}，停用 ${res[1].meta.changes || 0} 条内容` });
      return ok({ disabled_items: res[1].meta.changes || 0 });
    },
    { auth: 'admin', perm: 'users' }
  );

  r.delete(
    '/api/users/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户不存在');
      if (row.id === ctx.user.id) throw new HttpError(400, 'cannot_delete_self', '不能删除当前登录的账户');
      assertCanManage(ctx.user, row);
      await ctx.env.DB.batch([
        ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM access_tokens WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM usage_counters WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('UPDATE links SET created_by = NULL WHERE created_by = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(row.id),
      ]);
      audit(ctx, 'user.delete', { type: 'user', id: row.id, detail: row.username });
      return ok({});
    },
    { auth: 'admin', perm: 'users' }
  );

  // ---------- groups ----------

  r.get(
    '/api/groups',
    async (ctx) => {
      const { results } = await ctx.env.DB
        .prepare('SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.role = \'user\') AS members FROM groups g ORDER BY g.id')
        .all();
      return ok({
        items: (results || []).map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          builtin: g.builtin,
          caps: normalizeCaps(safeParseJson(g.caps, {})),
          members: g.members,
          created_at: g.created_at,
        })),
        defaults: FALLBACK_CAPS,
      });
    },
    { auth: 'admin', perm: 'users' }
  );

  async function saveGroup(ctx, id) {
    const body = await readJsonBody(ctx.req);
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 30) : undefined;
    if (name !== undefined && !name) throw new HttpError(400, 'invalid_input', '请填写用户组名称');
    const now = Date.now();
    if (!id) {
      const caps = normalizeCaps(body.caps || {});
      try {
        const res = await ctx.env.DB
          .prepare('INSERT INTO groups(name, description, caps, created_at, updated_at) VALUES(?,?,?,?,?)')
          .bind(name || '新用户组', String(body.description || '').trim().slice(0, 200), JSON.stringify(caps), now, now)
          .run();
        audit(ctx, 'group.create', { type: 'group', id: res.meta.last_row_id, detail: name });
        return ok({ id: res.meta.last_row_id }, { status: 201 });
      } catch (e) {
        if (String(e?.message || '').includes('UNIQUE')) throw new HttpError(409, 'name_taken', '已有同名用户组');
        throw e;
      }
    }
    const row = await ctx.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first();
    if (!row) throw new HttpError(404, 'not_found', '用户组不存在');
    const sets = [];
    const params = [];
    if (name !== undefined) {
      sets.push('name = ?');
      params.push(name);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      params.push(String(body.description).trim().slice(0, 200));
    }
    if (body.caps !== undefined) {
      sets.push('caps = ?');
      params.push(JSON.stringify(normalizeCaps(body.caps, { base: normalizeCaps(safeParseJson(row.caps, {})) })));
    }
    if (!sets.length) return ok({ id: row.id });
    sets.push('updated_at = ?');
    params.push(now, row.id);
    try {
      await ctx.env.DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE')) throw new HttpError(409, 'name_taken', '已有同名用户组');
      throw e;
    }
    invalidateGroup(row.id);
    audit(ctx, 'group.update', { type: 'group', id: row.id, detail: name || row.name });
    return ok({ id: row.id });
  }

  r.post('/api/groups', (ctx) => saveGroup(ctx, null), { auth: 'admin', perm: 'users' });
  r.patch('/api/groups/:id', (ctx) => saveGroup(ctx, Number(ctx.params.id)), { auth: 'admin', perm: 'users' });

  r.delete(
    '/api/groups/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户组不存在');
      const members = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE group_id = ?').bind(row.id).first();
      if (members.n) throw new HttpError(400, 'group_in_use', `还有 ${members.n} 位用户在这个组里，请先把他们移到其他组`);
      await ctx.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(row.id).run();
      invalidateGroup(row.id);
      audit(ctx, 'group.delete', { type: 'group', id: row.id, detail: row.name });
      return ok({});
    },
    { auth: 'admin', perm: 'users' }
  );

  // ---------- invite & login links ----------

  r.get(
    '/api/access-tokens',
    async (ctx) => {
      const kind = ctx.query.get('kind');
      const userId = Number(ctx.query.get('user_id')) || null;
      const where = [];
      const binds = [];
      if (kind === 'invite' || kind === 'login') {
        where.push('t.kind = ?');
        binds.push(kind);
      }
      if (userId) {
        where.push('t.user_id = ?');
        binds.push(userId);
      }
      const { results } = await ctx.env.DB
        .prepare(
          `SELECT t.*, u.username, g.name AS group_name, c.username AS creator_name FROM access_tokens t
           LEFT JOIN users u ON u.id = t.user_id LEFT JOIN groups g ON g.id = t.group_id LEFT JOIN users c ON c.id = t.created_by
           ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 200`
        )
        .bind(...binds)
        .all();
      return ok({ items: (results || []).map(tokenFromRow) });
    },
    { auth: 'admin', perm: 'users' }
  );

  r.post(
    '/api/access-tokens',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const kind = body.kind === 'login' ? 'login' : 'invite';
      const label = String(body.label || '').trim().slice(0, 60);
      const maxUses = parseIntOr(body.max_uses, kind === 'login' ? 0 : 1, { min: 0, max: 10000 });
      const hours = parseIntOr(body.expires_in_hours, kind === 'login' ? 24 * 7 : 24 * 3, { min: 0, max: 24 * 365 });
      const expiresAt = hours > 0 ? Date.now() + hours * 3600000 : null;
      let userId = null;
      let groupId = null;
      let accountDays = null;
      let domainIds = [];
      if (kind === 'login') {
        const target = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(Number(body.user_id)).first();
        if (!target) throw new HttpError(400, 'invalid_user', '请选择账户');
        if (target.role === 'admin') throw new HttpError(400, 'invalid_user', '不能为管理员账户创建登录链接');
        if (target.frozen_at) throw new HttpError(400, 'invalid_user', '该账户已被冻结');
        userId = target.id;
      } else {
        groupId = (await resolveGroupId(ctx.env, body.group_id)) ?? (await defaultGroupId(ctx.env));
        accountDays = parseIntOr(body.account_days, 0, { min: 0, max: 3650 }) || null;
        domainIds = parseDomainIds(body.domain_ids);
      }
      const token = (kind === 'login' ? 'lgn_' : 'inv_') + randomToken(24);
      const res = await ctx.env.DB
        .prepare(
          `INSERT INTO access_tokens(kind, token_hash, prefix, label, user_id, group_id, domain_ids, account_days, max_uses, expires_at, created_by, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(kind, await sha256Hex(token), token.slice(0, 10), label, userId, groupId, JSON.stringify(domainIds), accountDays, maxUses, expiresAt, ctx.user.id, Date.now())
        .run();
      audit(ctx, kind === 'login' ? 'login_link.create' : 'invite.create', { type: kind === 'login' ? 'user' : 'group', id: userId || groupId, detail: label });
      return ok({ id: res.meta.last_row_id, token, url: tokenUrl(ctx.req, kind, token) }, { status: 201 });
    },
    { auth: 'admin', perm: 'users' }
  );

  r.delete(
    '/api/access-tokens/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM access_tokens WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '链接不存在');
      await ctx.env.DB.prepare('UPDATE access_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(Date.now(), row.id).run();
      audit(ctx, row.kind === 'login' ? 'login_link.revoke' : 'invite.revoke', { type: 'token', id: row.id, detail: row.label });
      return ok({});
    },
    { auth: 'admin', perm: 'users' }
  );

  // ---------- audit log ----------

  r.get(
    '/api/audit',
    async (ctx) => {
      const page = parseIntOr(ctx.query.get('page'), 1, { min: 1, max: 100000 });
      const per = parseIntOr(ctx.query.get('per'), 30, { min: 10, max: 100 });
      const actor = Number(ctx.query.get('actor_id')) || null;
      const where = actor ? 'WHERE a.actor_id = ?' : '';
      const binds = actor ? [actor] : [];
      const [count, rows] = await Promise.all([
        ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${where}`).bind(...binds).first(),
        ctx.env.DB
          .prepare(`SELECT a.*, u.username AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
          .bind(...binds, per, (page - 1) * per)
          .all(),
      ]);
      return ok({ items: rows.results || [], total: count.n, page, per_page: per });
    },
    { auth: 'admin', perm: 'users' }
  );

  // ---------- api keys ----------

  r.get('/api/keys', async (ctx) => {
    const all = adminPerm(ctx.user, 'users');
    const { results } = await ctx.env.DB
      .prepare(
        `SELECT k.*, u.username AS owner_name FROM api_keys k LEFT JOIN users u ON u.id = k.user_id ${
          all ? '' : 'WHERE k.user_id = ?'
        } ORDER BY k.id DESC`
      )
      .bind(...(all ? [] : [ctx.user.id]))
      .all();
    return ok({
      allowed_scopes: capsOf(ctx.user).api.use ? capsOf(ctx.user).api.scopes : [],
      items: (results || []).map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: safeParseJson(k.scopes, []),
        created_at: k.created_at,
        last_used_at: k.last_used_at || null,
        expires_at: k.expires_at || null,
        owner: k.user_id ? { id: k.user_id, username: k.owner_name || `#${k.user_id}` } : null,
        mine: k.user_id === ctx.user.id,
      })),
    });
  });

  r.post('/api/keys', async (ctx) => {
    if (!canUseApi(ctx.user)) throw new HttpError(403, 'forbidden', '该账户没有使用 API 的权限');
    const body = await readJsonBody(ctx.req);
    const name = String(body.name || '').trim().slice(0, 60) || 'API 密钥';
    const scopes = parseScopes(body.scopes, capsOf(ctx.user).api.scopes);
    if (!scopes.length) throw new HttpError(400, 'invalid_scopes', '至少选择一个权限范围');
    const expiresInDays = parseIntOr(body.expires_in_days, 0, { min: 0, max: 3650 });
    const expiresAt = expiresInDays > 0 ? Date.now() + expiresInDays * DAY : null;

    const secret = 'sk_' + randomToken(30);
    const hash = await sha256Hex(secret);
    const res = await ctx.env.DB
      .prepare('INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes, created_at, expires_at) VALUES(?,?,?,?,?,?,?)')
      .bind(ctx.user.id, name, secret.slice(0, 11), hash, JSON.stringify(scopes), Date.now(), expiresAt)
      .run();
    return ok({ id: res.meta.last_row_id, key: secret, name, scopes, expires_at: expiresAt }, { status: 201 });
  });

  r.delete('/api/keys/:id', async (ctx) => {
    const row = await ctx.env.DB.prepare('SELECT * FROM api_keys WHERE id = ?').bind(ctx.params.id).first();
    if (!row) throw new HttpError(404, 'not_found', '密钥不存在');
    if (row.user_id !== ctx.user.id && !adminPerm(ctx.user, 'users')) throw new HttpError(403, 'forbidden', '无权删除该密钥');
    await ctx.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(row.id).run();
    if (row.user_id !== ctx.user.id) audit(ctx, 'key.revoke', { type: 'user', id: row.user_id, detail: row.name });
    return ok({});
  });

  // ---------- settings ----------

  r.get(
    '/api/settings',
    async (ctx) => {
      const settings = await getSettings(ctx.env);
      const [domains, users, links, notes, logs, keys, passkeys] = await Promise.all([
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM domains').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
        ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE kind = 'link'").first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notes WHERE burned_at IS NULL').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM logs').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys').first(),
      ]);
      return ok({
        settings,
        counts: { domains: domains.n, users: users.n, links: links.n, notes: notes.n, logs: logs.n, keys: keys.n, passkeys: passkeys.n },
      });
    },
    { auth: 'admin', perm: 'settings' }
  );

  r.patch(
    '/api/settings',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const patch = {};
      if (body.site_name !== undefined) {
        const name = String(body.site_name).trim().slice(0, 40);
        patch.site_name = name || 'ShortLink';
      }
      if (body.retention_days !== undefined) patch.retention_days = parseIntOr(body.retention_days, 90, { min: 1, max: 3650 });
      if (body.session_days !== undefined) patch.session_days = parseIntOr(body.session_days, 14, { min: 1, max: 90 });
      if (body.auto_delete_expired_days !== undefined)
        patch.auto_delete_expired_days = parseIntOr(body.auto_delete_expired_days, 30, { min: 0, max: 3650 });
      if (body.default_mode !== undefined && ['direct', 'page', 'confirm'].includes(body.default_mode))
        patch.default_mode = body.default_mode;
      if (body.default_style !== undefined && typeof body.default_style === 'object') patch.default_style = body.default_style;
      await setSettings(ctx.env, patch);
      audit(ctx, 'settings.update', { detail: Object.keys(patch).join(', ') });
      return ok({ settings: await getSettings(ctx.env) });
    },
    { auth: 'admin', perm: 'settings' }
  );

  r.post(
    '/api/admin/cleanup',
    async (ctx) => {
      const result = await runMaintenance(ctx.env);
      audit(ctx, 'maintenance.run', { detail: `汇总 ${result.rolled_days} 条日统计 · 焚毁 ${result.notes_burned} 封密信 · 删除 ${result.logs_deleted} 条记录、${result.links_deleted} 条过期短链` });
      return ok(result);
    },
    { auth: 'admin', perm: 'settings' }
  );
}

export { isAdmin };
