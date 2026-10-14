// /api/users, /api/keys, /api/settings, /api/admin/cleanup — administration.

import { isAdmin, canUseApi, getSettings, setSettings, publicUser, ALL_SCOPES } from './auth.js';
import { hashPassword, sha256Hex } from './crypto.js';
import { runCleanup } from './cleanup.js';
import { ok, HttpError, readJsonBody, randomToken, parseIntOr, safeParseJson } from './util.js';

function parsePerms(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    create_links: !!p.create_links,
    view_logs: !!p.view_logs,
    use_api: !!p.use_api,
  };
}

function parseDomainIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

function parseScopes(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter((s) => ALL_SCOPES.includes(s)))];
}

async function userWithCounts(env, row) {
  const [links, keys, passkeys] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM links WHERE created_by = ?').bind(row.id).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?').bind(row.id).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(row.id).first(),
  ]);
  return { ...publicUser(row), link_count: links.n, key_count: keys.n, passkey_count: passkeys.n };
}

export function registerAdminRoutes(r) {
  // ---------- users (admin) ----------

  r.get(
    '/api/users',
    async (ctx) => {
      const { results } = await ctx.env.DB.prepare('SELECT * FROM users ORDER BY id ASC').all();
      const items = [];
      for (const row of results || []) items.push(await userWithCounts(ctx.env, row));
      return ok({ items });
    },
    { auth: 'admin' }
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
      if (role === 'user' && !password) throw new HttpError(400, 'invalid_input', '普通用户必须设置初始密码');
      if (password && password.length < 8) throw new HttpError(400, 'weak_password', '密码至少需要 8 个字符');
      const exists = await ctx.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
      if (exists) throw new HttpError(409, 'username_taken', '用户名已存在');

      const now = Date.now();
      const res = await ctx.env.DB
        .prepare(
          'INSERT INTO users(username, display_name, password_hash, role, perms, domain_ids, quota_max_links, disabled, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        )
        .bind(
          username,
          String(body.display_name || '').trim().slice(0, 60),
          password ? await hashPassword(password) : null,
          role,
          JSON.stringify(parsePerms(body.perms)),
          JSON.stringify(role === 'admin' ? [] : parseDomainIds(body.domain_ids)),
          parseIntOr(body.quota_max_links, 100, { min: 0, max: 1000000 }),
          body.disabled ? 1 : 0,
          now,
          now
        )
        .run();
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(res.meta.last_row_id).first();
      return ok({ item: await userWithCounts(ctx.env, row) }, { status: 201 });
    },
    { auth: 'admin' }
  );

  r.patch(
    '/api/users/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户不存在');
      const body = await readJsonBody(ctx.req);
      const sets = [];
      const params = [];

      const selfEdit = row.id === ctx.user.id;
      if (body.display_name !== undefined) {
        sets.push('display_name = ?');
        params.push(String(body.display_name).trim().slice(0, 60));
      }
      if (body.password !== undefined && String(body.password || '') !== '') {
        const password = String(body.password);
        if (password.length < 8) throw new HttpError(400, 'weak_password', '密码至少需要 8 个字符');
        sets.push('password_hash = ?');
        params.push(await hashPassword(password));
      }
      if (body.role !== undefined) {
        const wantRole = body.role === 'admin' ? 'admin' : 'user';
        if (row.role === 'admin' && wantRole !== 'admin') {
          const others = await ctx.env.DB
            .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ?")
            .bind(row.id)
            .first();
          if (!others.n) throw new HttpError(400, 'last_admin', '至少保留一名管理员');
        }
        sets.push('role = ?');
        params.push(wantRole);
      }
      if (body.perms !== undefined) {
        sets.push('perms = ?');
        params.push(JSON.stringify(parsePerms(body.perms)));
      }
      if (body.domain_ids !== undefined) {
        sets.push('domain_ids = ?');
        params.push(JSON.stringify(parseDomainIds(body.domain_ids)));
      }
      if (body.quota_max_links !== undefined) {
        sets.push('quota_max_links = ?');
        params.push(parseIntOr(body.quota_max_links, 100, { min: 0, max: 1000000 }));
      }
      if (body.disabled !== undefined) {
        if (selfEdit && body.disabled) throw new HttpError(400, 'cannot_disable_self', '不能停用自己的账户');
        sets.push('disabled = ?');
        params.push(body.disabled ? 1 : 0);
      }
      if (!sets.length) return ok({ item: await userWithCounts(ctx.env, row) });

      sets.push('updated_at = ?');
      params.push(Date.now());
      params.push(row.id);
      await ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

      // privilege or password change: drop this user's sessions (except current one when self-editting)
      const keep = selfEdit ? ctx.sessionId : '';
      await ctx.env.DB
        .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
        .bind(row.id, keep)
        .run();

      const updated = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.id).first();
      return ok({ item: await userWithCounts(ctx.env, updated) });
    },
    { auth: 'admin' }
  );

  r.delete(
    '/api/users/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '用户不存在');
      if (row.id === ctx.user.id) throw new HttpError(400, 'cannot_delete_self', '不能删除当前登录的账户');
      if (row.role === 'admin') {
        const others = await ctx.env.DB
          .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ?")
          .bind(row.id)
          .first();
        if (!others.n) throw new HttpError(400, 'last_admin', '至少保留一名管理员');
      }
      await ctx.env.DB.batch([
        ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(row.id),
        ctx.env.DB.prepare('UPDATE links SET created_by = NULL WHERE created_by = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(row.id),
      ]);
      return ok({});
    },
    { auth: 'admin' }
  );

  // ---------- api keys ----------

  r.get('/api/keys', async (ctx) => {
    const admin = isAdmin(ctx.user);
    const { results } = await ctx.env.DB
      .prepare(
        `SELECT k.*, u.username AS owner_name FROM api_keys k LEFT JOIN users u ON u.id = k.user_id ${
          admin ? '' : 'WHERE k.user_id = ?'
        } ORDER BY k.id DESC`
      )
      .bind(...(admin ? [] : [ctx.user.id]))
      .all();
    return ok({
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
    const scopes = parseScopes(body.scopes);
    if (!scopes.length) throw new HttpError(400, 'invalid_scopes', '至少选择一个权限范围');
    const expiresInDays = parseIntOr(body.expires_in_days, 0, { min: 0, max: 3650 });
    const expiresAt = expiresInDays > 0 ? Date.now() + expiresInDays * 86400000 : null;

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
    if (row.user_id !== ctx.user.id && !isAdmin(ctx.user)) throw new HttpError(403, 'forbidden', '无权删除该密钥');
    await ctx.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(row.id).run();
    return ok({});
  });

  // ---------- settings (admin) ----------

  r.get(
    '/api/settings',
    async (ctx) => {
      const settings = await getSettings(ctx.env);
      const [domains, users, links, logs, keys, passkeys] = await Promise.all([
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM domains').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM links').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM logs').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys').first(),
      ]);
      return ok({
        settings,
        counts: { domains: domains.n, users: users.n, links: links.n, logs: logs.n, keys: keys.n, passkeys: passkeys.n },
      });
    },
    { auth: 'admin' }
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
      return ok({ settings: await getSettings(ctx.env) });
    },
    { auth: 'admin' }
  );

  r.post(
    '/api/admin/cleanup',
    async (ctx) => {
      const result = await runCleanup(ctx.env);
      return ok(result);
    },
    { auth: 'admin' }
  );
}
