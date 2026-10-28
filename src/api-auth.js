// /api/auth/*, /api/bootstrap, /api/setup, /api/me/* — authentication & profile.

import {
  createSession,
  destroySession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSettings,
  publicUser,
  hydrateUser,
  loginWithPassword,
  assertCanSignIn,
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
} from './auth.js';
import { audit } from './audit.js';
import { todayUsage } from './usage.js';
import { sha256Hex } from './crypto.js';
import { hashPassword, verifyPassword, signValue, verifyValue, ensureSignSecret } from './crypto.js';
import { generateChallenge, verifyRegistration, verifyAssertion } from './webauthn.js';
import { ok, HttpError, readJsonBody, b64urlEncode, isValidHostname, safeParseJson } from './util.js';

const DAY = 86400000;

// Consume one use of an invite / login token atomically; returns the row or throws.
async function consumeToken(env, token, kind) {
  if (typeof token !== 'string' || !/^(inv|lgn)_[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new HttpError(404, 'invalid_token', '链接无效');
  }
  const hash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB
    .prepare(
      `UPDATE access_tokens SET uses = uses + 1, last_used_at = ?
       WHERE token_hash = ? AND kind = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR uses < max_uses)
       RETURNING *`
    )
    .bind(now, hash, kind, now)
    .first();
  if (!row) throw new HttpError(410, 'token_unusable', '链接已失效：可能已过期、已被撤销或次数用完');
  return row;
}

async function peekToken(env, token, kind) {
  if (typeof token !== 'string' || !/^(inv|lgn)_[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new HttpError(404, 'invalid_token', '链接无效');
  }
  const row = await env.DB.prepare('SELECT * FROM access_tokens WHERE token_hash = ? AND kind = ?').bind(await sha256Hex(token), kind).first();
  if (!row) throw new HttpError(404, 'invalid_token', '链接无效');
  const now = Date.now();
  if (row.revoked_at || (row.expires_at && row.expires_at < now) || (row.max_uses > 0 && row.uses >= row.max_uses)) {
    throw new HttpError(410, 'token_unusable', '链接已失效：可能已过期、已被撤销或次数用完');
  }
  return row;
}

const CHALLENGE_TTL_MS = 3 * 60 * 1000;

function originOf(req) {
  return new URL(req.url).origin;
}

function rpIdOf(req) {
  return new URL(req.url).hostname;
}

function challengeCookie(value) {
  return `${CHALLENGE_COOKIE}=${value}; Path=/; Max-Age=180; HttpOnly; SameSite=Lax; Secure`;
}

function clearChallengeCookie() {
  return `${CHALLENGE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

function b64(str) {
  return b64urlEncode(new TextEncoder().encode(str));
}

export function registerAuthRoutes(r) {
  // ---------- bootstrap (public) ----------
  r.get(
    '/api/bootstrap',
    async (ctx) => {
      const settings = await getSettings(ctx.env);
      const row = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
      return ok({
        needsSetup: !row || row.n === 0,
        site_name: settings.site_name,
        host: new URL(ctx.req.url).host,
        settings: { default_mode: settings.default_mode, default_style: settings.default_style },
      });
    },
    { auth: 'none' }
  );

  // ---------- first-run setup ----------
  r.post(
    '/api/setup',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const siteName = String(body.site_name || 'ShortLink').trim().slice(0, 40) || 'ShortLink';
      if (!/^[a-z0-9_.-]{2,32}$/.test(username)) {
        throw new HttpError(400, 'invalid_username', '用户名需为 2-32 位字母、数字或 _ . -');
      }
      if (password.length < 8) throw new HttpError(400, 'weak_password', '密码至少需要 8 个字符');
      const row = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
      if (row && row.n > 0) throw new HttpError(403, 'already_setup', '系统已完成初始化');

      const now = Date.now();
      const passwordHash = await hashPassword(password);
      const res = await ctx.env.DB
        .prepare(
          `INSERT INTO users(username, display_name, password_hash, role, created_at, updated_at, is_owner, admin_perms, created_via)
           VALUES(?,?,?,?,?,?,1,'{"users":true,"domains":true,"settings":true,"content":true}','setup')`
        )
        .bind(username, username, passwordHash, 'admin', now, now)
        .run();

      // register the host the admin is using right now as an admin domain
      const host = new URL(ctx.req.url).host.split(':')[0].toLowerCase();
      if (isValidHostname(host)) {
        await ctx.env.DB
          .prepare('INSERT INTO domains(hostname, remark, is_admin, created_at) VALUES(?,?,1,?) ON CONFLICT(hostname) DO UPDATE SET is_admin=1')
          .bind(host, '初始化时注册的管理域名', now)
          .run();
      }
      await ctx.env.DB
        .prepare("INSERT INTO settings(key, value) VALUES('site_name', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(JSON.stringify(siteName))
        .run();

      const session = await createSession(ctx.env, ctx.req, res.meta.last_row_id);
      return ok({ user: { id: res.meta.last_row_id, username, role: 'admin' } }, {
        headers: { 'set-cookie': sessionCookieHeader(session.token, session.maxAge) },
      });
    },
    { auth: 'none' }
  );

  // ---------- password login ----------
  r.post(
    '/api/auth/login',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      let user;
      try {
        user = await loginWithPassword(ctx.env, body.username, body.password);
      } catch (e) {
        audit(ctx, 'login.failed', { actorId: null, detail: String(body.username || '').slice(0, 40) + '：' + e.message });
        throw e;
      }
      const session = await createSession(ctx.env, ctx.req, user.id);
      audit(ctx, 'login.password', { actorId: user.id });
      await hydrateUser(ctx.env, user);
      return ok({ user: publicUser(user) }, {
        headers: { 'set-cookie': sessionCookieHeader(session.token, session.maxAge) },
      });
    },
    { auth: 'none' }
  );

  r.post('/api/auth/logout', async (ctx) => {
    await destroySession(ctx.env, ctx.req);
    return ok({}, { headers: { 'set-cookie': clearSessionCookieHeader() } });
  });

  // ---------- passkey login (usernameless or with username hint) ----------
  r.post(
    '/api/auth/passkey/options',
    async (ctx) => {
      let body = {};
      try {
        body = await ctx.req.json();
      } catch {}
      const rpId = rpIdOf(ctx.req);
      const options = {
        challenge: generateChallenge(),
        rpId,
        timeout: 120000,
        userVerification: 'preferred',
      };
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      let allow = [];
      if (username) {
        const user = await ctx.env.DB.prepare('SELECT id FROM users WHERE username = ? AND disabled = 0').bind(username).first();
        if (user) {
          const { results } = await ctx.env.DB
            .prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?')
            .bind(user.id)
            .all();
          allow = (results || []).map((p) => ({ id: p.credential_id, transports: safeArr(p.transports) }));
        }
      }
      if (allow.length) options.allowCredentials = allow;
      await ensureSignSecret(ctx.env);
      const token = await signValue({ ch: options.challenge, purpose: 'login', exp: Date.now() + CHALLENGE_TTL_MS });
      return ok(options, { headers: { 'set-cookie': challengeCookie(token) } });
    },
    { auth: 'none' }
  );

  r.post(
    '/api/auth/passkey/verify',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const challengeToken = cookieValue(ctx.req, CHALLENGE_COOKIE);
      await ensureSignSecret(ctx.env);
      const payload = await verifyValue(challengeToken);
      if (!payload || payload.purpose !== 'login') throw new HttpError(400, 'bad_challenge', '验证会话已过期，请重试');
      const assertion = body.credential || body;
      const credentialId = assertion.id;
      if (!credentialId) throw new HttpError(400, 'invalid_input', '缺少凭证');
      const passkey = await ctx.env.DB.prepare('SELECT * FROM passkeys WHERE credential_id = ?').bind(credentialId).first();
      if (!passkey) throw new HttpError(401, 'unknown_credential', '未识别的通行密钥');
      const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(passkey.user_id).first();
      if (!user) throw new HttpError(403, 'user_disabled', '该账户不可用');
      assertCanSignIn(user);

      let result;
      try {
        result = await verifyAssertion(assertion, passkey, {
          challenge: payload.ch,
          origin: originOf(ctx.req),
          rpId: rpIdOf(ctx.req),
        });
      } catch (e) {
        console.error('assertion verify failed:', e?.message);
        throw new HttpError(400, 'passkey_verify_failed', `通行密钥验证失败：${e?.message || '未知错误'}`);
      }
      ctx.waitUntil(
        ctx.env.DB.prepare('UPDATE passkeys SET counter = ?, backed_up = MAX(backed_up, ?) WHERE id = ?')
          .bind(result.counter, result.backedUp ? 1 : 0, passkey.id)
          .run()
      );
      const session = await createSession(ctx.env, ctx.req, user.id);
      audit(ctx, 'login.passkey', { actorId: user.id });
      await hydrateUser(ctx.env, user);
      const res = ok({ user: publicUser(user) });
      res.headers.append('set-cookie', sessionCookieHeader(session.token, session.maxAge));
      res.headers.append('set-cookie', clearChallengeCookie());
      return res;
    },
    { auth: 'none' }
  );

  // ---------- invite links (public) ----------
  r.get(
    '/api/invite/:token',
    async (ctx) => {
      const row = await peekToken(ctx.env, ctx.params.token, 'invite');
      const group = row.group_id ? await ctx.env.DB.prepare('SELECT name FROM groups WHERE id = ?').bind(row.group_id).first() : null;
      const settings = await getSettings(ctx.env);
      return ok({
        site_name: settings.site_name,
        label: row.label,
        group: group?.name || null,
        account_days: row.account_days || null,
        expires_at: row.expires_at || null,
      });
    },
    { auth: 'none' }
  );

  r.post(
    '/api/invite/:token',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9_.-]{2,32}$/.test(username)) throw new HttpError(400, 'invalid_username', '用户名需为 2-32 位字母、数字或 _ . -');
      if (password.length < 8) throw new HttpError(400, 'weak_password', '密码至少需要 8 个字符');
      await peekToken(ctx.env, ctx.params.token, 'invite');
      const exists = await ctx.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
      if (exists) throw new HttpError(409, 'username_taken', '用户名已被使用，换一个吧');
      const token = await consumeToken(ctx.env, ctx.params.token, 'invite');
      const now = Date.now();
      const res = await ctx.env.DB
        .prepare(
          `INSERT INTO users(username, display_name, password_hash, role, perms, domain_ids, quota_max_links, disabled, created_at, updated_at,
             group_id, caps_override, admin_perms, expires_at, must_change_password, note, created_via)
           VALUES(?,?,?,'user','{}',?,0,0,?,?,?,'{}','{}',?,0,?,?)`
        )
        .bind(
          username,
          String(body.display_name || '').trim().slice(0, 60) || username,
          await hashPassword(password),
          token.domain_ids || '[]',
          now,
          now,
          token.group_id,
          token.account_days ? now + token.account_days * DAY : null,
          token.label ? `邀请：${token.label}` : '',
          `invite:${token.id}`
        )
        .run();
      const userId = res.meta.last_row_id;
      audit(ctx, 'invite.use', { actorId: userId, type: 'token', id: token.id, detail: `${username} 通过邀请注册` });
      const session = await createSession(ctx.env, ctx.req, userId);
      return ok({ user: { id: userId, username } }, {
        status: 201,
        headers: { 'set-cookie': sessionCookieHeader(session.token, session.maxAge) },
      });
    },
    { auth: 'none' }
  );

  // ---------- login links (public) ----------
  r.get(
    '/api/login-link/:token',
    async (ctx) => {
      const row = await peekToken(ctx.env, ctx.params.token, 'login');
      const user = await ctx.env.DB.prepare('SELECT username, display_name FROM users WHERE id = ?').bind(row.user_id).first();
      if (!user) throw new HttpError(410, 'token_unusable', '链接已失效');
      const settings = await getSettings(ctx.env);
      return ok({
        site_name: settings.site_name,
        username: user.username,
        display_name: user.display_name || user.username,
        expires_at: row.expires_at || null,
        uses_left: row.max_uses > 0 ? row.max_uses - row.uses : null,
      });
    },
    { auth: 'none' }
  );

  r.post(
    '/api/login-link/:token',
    async (ctx) => {
      const row = await peekToken(ctx.env, ctx.params.token, 'login');
      const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
      if (!user) throw new HttpError(410, 'token_unusable', '链接已失效');
      assertCanSignIn(user);
      await consumeToken(ctx.env, ctx.params.token, 'login');
      const session = await createSession(ctx.env, ctx.req, user.id);
      audit(ctx, 'login.link', { actorId: user.id, type: 'token', id: row.id, detail: row.label });
      await hydrateUser(ctx.env, user);
      return ok({ user: publicUser(user) }, {
        headers: { 'set-cookie': sessionCookieHeader(session.token, session.maxAge) },
      });
    },
    { auth: 'none' }
  );

  // ---------- me ----------
  r.get('/api/me', async (ctx) => {
    const { results: passkeys } = await ctx.env.DB
      .prepare('SELECT id, name, transports, backup_eligible, backed_up, created_at, credential_id FROM passkeys WHERE user_id = ? ORDER BY id DESC')
      .bind(ctx.user.id)
      .all();
    return ok({ user: publicUser(ctx.user), passkeys: passkeys || [], usage_today: await todayUsage(ctx.env, ctx.user.id) });
  });

  r.patch('/api/me', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 60) : undefined;
    if (displayName === undefined) return ok({ user: publicUser(ctx.user) });
    await ctx.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(displayName, Date.now(), ctx.user.id).run();
    const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.user.id).first();
    await hydrateUser(ctx.env, user);
    return ok({ user: publicUser(user) });
  });

  r.post('/api/me/password', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const current = String(body.current || '');
    const next = String(body.next || '');
    if (next.length < 8) throw new HttpError(400, 'weak_password', '新密码至少需要 8 个字符');
    if (ctx.user.password_hash) {
      const valid = await verifyPassword(current, ctx.user.password_hash);
      if (!valid) throw new HttpError(401, 'bad_credentials', '当前密码不正确');
    }
    const hash = await hashPassword(next);
    await ctx.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').bind(hash, Date.now(), ctx.user.id).run();
    audit(ctx, 'password.change', {});
    // revoke all other sessions
    const sid = ctx.sessionId;
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(ctx.user.id, sid).run();
    return ok({});
  });

  // ---------- passkey registration ----------
  r.post('/api/me/passkeys/options', async (ctx) => {
    const { results: existing } = await ctx.env.DB
      .prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?')
      .bind(ctx.user.id)
      .all();
    const options = {
      challenge: generateChallenge(),
      rp: { name: await (await getSettings(ctx.env)).site_name, id: rpIdOf(ctx.req) },
      user: { id: b64(String(ctx.user.id)), name: ctx.user.username, displayName: ctx.user.display_name || ctx.user.username },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 120000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      excludeCredentials: (existing || []).map((p) => ({ id: p.credential_id, transports: safeArr(p.transports) })),
    };
    await ensureSignSecret(ctx.env);
    const token = await signValue({ ch: options.challenge, purpose: 'register', uid: ctx.user.id, exp: Date.now() + CHALLENGE_TTL_MS });
    return ok(options, { headers: { 'set-cookie': challengeCookie(token) } });
  });

  r.post('/api/me/passkeys/verify', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    await ensureSignSecret(ctx.env);
    const payload = await verifyValue(cookieValue(ctx.req, CHALLENGE_COOKIE));
    if (!payload || payload.purpose !== 'register' || payload.uid !== ctx.user.id) {
      throw new HttpError(400, 'bad_challenge', '验证会话已过期，请重试');
    }
    const registration = body.credential || body;
    let parsed;
    try {
      parsed = await verifyRegistration(registration, {
        challenge: payload.ch,
        origin: originOf(ctx.req),
        rpId: rpIdOf(ctx.req),
      });
    } catch (e) {
      console.error('registration verify failed:', e?.message);
      throw new HttpError(400, 'passkey_verify_failed', `通行密钥验证失败：${e?.message || '未知错误'}`);
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : '通行密钥';
    const res = await ctx.env.DB
      .prepare(
        `INSERT INTO passkeys(user_id, name, credential_id, public_key, alg, counter, transports, backup_eligible, backed_up, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(credential_id) DO UPDATE SET name = excluded.name, counter = excluded.counter`
      )
      .bind(
        ctx.user.id,
        name,
        parsed.credentialId,
        parsed.publicKey.slice(), // standalone copy: D1 rejects views into a larger buffer
        parsed.alg,
        parsed.counter,
        JSON.stringify(parsed.transports),
        parsed.backupEligible ? 1 : 0,
        parsed.backedUp ? 1 : 0,
        Date.now()
      )
      .run();
    return ok({ id: res.meta.last_row_id, name }, { headers: { 'set-cookie': clearChallengeCookie() } });
  });

  r.delete('/api/me/passkeys/:id', async (ctx) => {
    const res = await ctx.env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(ctx.params.id, ctx.user.id).run();
    if (!res.meta.changes) throw new HttpError(404, 'not_found', '通行密钥不存在');
    return ok({});
  });

  // ---------- sessions ----------
  r.get('/api/me/sessions', async (ctx) => {
    const { results } = await ctx.env.DB
      .prepare('SELECT id, created_at, last_seen_at, expires_at, ip, ua FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 50')
      .bind(ctx.user.id, Date.now())
      .all();
    const sid = ctx.sessionId;
    return ok({ sessions: (results || []).map((s) => ({ ...s, id: s.id.slice(0, 8), current: s.id === sid })) });
  });

  r.post('/api/me/sessions/revoke-others', async (ctx) => {
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(ctx.user.id, ctx.sessionId).run();
    return ok({});
  });
}

function cookieValue(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function safeArr(t) {
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
