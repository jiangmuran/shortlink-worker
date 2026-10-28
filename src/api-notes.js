// Burn-after-reading notes.
//   Console: /api/notes (list, create, burn, delete, server-side content view)
//   Public:  POST /api/n/:code/open on the short-link domain — the only call
//            that hands out the ciphertext, and the only one that counts an open.
// Opening is gated by: link enabled, not burned, not expired, password, open budget.

import { capsOf, canSeeAll, isAdmin } from './auth.js';
import { hashPassword, verifyPassword, serverEncrypt, serverDecrypt } from './crypto.js';
import { createCodeFor, resolveUsableDomain, linkSelect, linkFromRow, deleteLinkCascade } from './links-service.js';
import { lookupDomain, hostOf } from './domains.js';
import { consumeCreation } from './usage.js';
import { audit } from './audit.js';
import { ok, HttpError, readJsonBody, parseIntOr, parseDateToMs, safeParseJson, b64urlEncode, b64urlDecode, normalizeTargetUrl } from './util.js';

export const NOTE_THEMES = ['min', 'letter', 'term', 'noir'];
export const NOTE_MODES = ['direct', 'click', 'type', 'window', 'countdown'];
const HOUR = 3600000;

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function sanitizeDisplay(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const after = ['burned', 'message', 'redirect'].includes(d.after) ? d.after : 'burned';
  return {
    mode: NOTE_MODES.includes(d.mode) ? d.mode : 'click',
    chunk: parseIntOr(d.chunk, 2, { min: 1, max: 50 }),
    window: parseIntOr(d.window, 6, { min: 2, max: 40 }),
    speed: parseIntOr(d.speed, 120, { min: 30, max: 2000 }),
    seconds: parseIntOr(d.seconds, 30, { min: 3, max: 3600 }),
    skip: !!d.skip,
    hide_on_blur: !!d.hide_on_blur,
    after,
    after_text: after === 'message' ? str(d.after_text, 140) : null,
    after_url: after === 'redirect' ? normalizeTargetUrl(d.after_url) : null,
  };
}

export function sanitizeTheme(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  return {
    name: NOTE_THEMES.includes(t.name) ? t.name : 'min',
    accent: typeof t.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.accent) ? t.accent : null,
  };
}

export function sanitizeMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return { title: str(m.title, 60), from: str(m.from, 40), hint: str(m.hint, 140) };
}

export function noteStatus(row, now = Date.now()) {
  if (row.burned_at) return 'burned';
  if (!row.enabled) return 'disabled';
  if (row.expires_at && row.expires_at < now) return 'expired';
  if (row.first_open_at && row.open_ttl && row.first_open_at + row.open_ttl * 1000 < now) return 'expired';
  if (row.max_opens > 0 && row.opens >= row.max_opens) return 'burned';
  return row.opens > 0 ? 'opened' : 'pending';
}

function noteFromRow(row) {
  return {
    ...linkFromRow(row),
    label: row.note || '',
    enc: row.n_enc,
    size: row.n_size,
    max_opens: row.n_max_opens,
    opens: row.n_opens,
    open_ttl: row.n_open_ttl || null,
    first_open_at: row.n_first_open_at || null,
    has_password: !!row.n_pw_hash,
    pw_fail: row.n_pw_fail,
    pw_max_fail: row.n_pw_max_fail,
    display: safeParseJson(row.n_display, {}),
    theme: safeParseJson(row.n_theme, {}),
    meta: safeParseJson(row.n_meta, {}),
    burned_at: row.n_burned_at || null,
    burn_reason: row.n_burn_reason || null,
    status: noteStatus({
      burned_at: row.n_burned_at,
      enabled: row.enabled,
      expires_at: row.expires_at,
      first_open_at: row.n_first_open_at,
      open_ttl: row.n_open_ttl,
      max_opens: row.n_max_opens,
      opens: row.n_opens,
    }),
  };
}

const NOTE_COLS = `, n.enc AS n_enc, n.size AS n_size, n.max_opens AS n_max_opens, n.opens AS n_opens, n.open_ttl AS n_open_ttl,
  n.first_open_at AS n_first_open_at, n.pw_hash AS n_pw_hash, n.pw_fail AS n_pw_fail, n.pw_max_fail AS n_pw_max_fail,
  n.display AS n_display, n.theme AS n_theme, n.meta AS n_meta, n.burned_at AS n_burned_at, n.burn_reason AS n_burn_reason`;

async function noteSelect(env) {
  const { sql, binds } = await linkSelect(env);
  return { sql: sql.replace('FROM links l', `${NOTE_COLS} FROM links l JOIN notes n ON n.link_id = l.id`), binds };
}

async function fetchNoteRow(env, id) {
  const { sql, binds } = await noteSelect(env);
  return env.DB.prepare(`${sql} WHERE l.id = ? AND l.kind = 'note'`).bind(...binds, Number(id)).first();
}

async function burnNote(env, linkId, reason) {
  await env.DB
    .prepare('UPDATE notes SET cipher = NULL, burned_at = ?, burn_reason = ? WHERE link_id = ? AND burned_at IS NULL')
    .bind(Date.now(), reason, linkId)
    .run();
}

async function logOpen(env, ctx, linkId, req, status) {
  const cf = req.cf || {};
  ctx.waitUntil(
    env.DB.prepare('INSERT INTO logs(link_id, ts, ip, country, city, ua, referer, status) VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        linkId,
        Date.now(),
        req.headers.get('cf-connecting-ip') || null,
        typeof cf.country === 'string' ? cf.country : null,
        typeof cf.city === 'string' ? cf.city : null,
        (req.headers.get('user-agent') || '').slice(0, 400) || null,
        (req.headers.get('referer') || '').slice(0, 400) || null,
        status
      )
      .run()
      .catch((e) => console.error('note log failed', e))
  );
}

async function assertNoteQuota(env, user) {
  if (isAdmin(user)) return;
  const max = capsOf(user).notes.max_active;
  if (max <= 0) return;
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM links l JOIN notes n ON n.link_id = l.id WHERE l.created_by = ? AND l.kind = 'note' AND n.burned_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?)")
    .bind(user.id, Date.now())
    .first();
  if (row.n >= max) throw new HttpError(403, 'quota_exceeded', `进行中的密信已达上限（${max} 封），等已有密信焚毁或过期后再创建`);
}

export function registerNoteRoutes(r) {
  // ---------- console ----------

  r.get('/api/notes', async (ctx) => {
    const q = ctx.query;
    const page = parseIntOr(q.get('page'), 1, { min: 1, max: 10000 });
    const per = parseIntOr(q.get('per'), 20, { min: 5, max: 100 });
    const where = ["l.kind = 'note'"];
    const params = [];
    if (!canSeeAll(ctx.user) || q.get('mine') === '1') {
      where.push('l.created_by = ?');
      params.push(ctx.user.id);
    }
    const search = (q.get('q') || '').trim();
    if (search) {
      where.push("(l.code LIKE ? ESCAPE '\\' OR l.note LIKE ? ESCAPE '\\')");
      const like = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      params.push(like, like);
    }
    const status = q.get('status');
    if (status === 'live') where.push('n.burned_at IS NULL');
    if (status === 'burned') where.push('n.burned_at IS NOT NULL');
    const whereSql = ' WHERE ' + where.join(' AND ');
    const { sql, binds } = await noteSelect(ctx.env);
    const count = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM links l JOIN notes n ON n.link_id = l.id${whereSql}`).bind(...params).first();
    const { results } = await ctx.env.DB
      .prepare(`${sql}${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, ...params, per, (page - 1) * per)
      .all();
    return ok({ items: (results || []).map(noteFromRow), total: count.n, page, per_page: per });
  });

  r.get('/api/notes/:id', async (ctx) => {
    const row = await fetchNoteRow(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '密信不存在');
    return ok({ item: noteFromRow(row) });
  });

  r.post('/api/notes', async (ctx) => {
    const user = ctx.user;
    const caps = capsOf(user).notes;
    if (!caps.create) throw new HttpError(403, 'forbidden', '该账户没有创建密信的权限');
    const body = await readJsonBody(ctx.req);
    const domain = await resolveUsableDomain(ctx.env, user, body.domain_id);

    const enc = body.enc === 'server' ? 'server' : 'e2e';
    if (enc === 'e2e' && !caps.e2e) throw new HttpError(403, 'e2e_forbidden', '当前账户的密信需要使用服务端加密');
    let cipher;
    let kcv = null;
    if (enc === 'e2e') {
      try {
        cipher = b64urlDecode(String(body.cipher || ''));
      } catch {
        throw new HttpError(400, 'invalid_cipher', '加密内容格式无效');
      }
      if (cipher.length < 29) throw new HttpError(400, 'invalid_cipher', '加密内容格式无效');
      kcv = typeof body.kcv === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(body.kcv) ? body.kcv : null;
      if (!kcv) throw new HttpError(400, 'invalid_cipher', '缺少密钥校验值');
    } else {
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
      const text = typeof payload?.text === 'string' ? payload.text : '';
      if (!text.trim()) throw new HttpError(400, 'invalid_input', '请填写密信内容');
      cipher = await serverEncrypt(ctx.env, JSON.stringify({ v: 1, format: payload.format === 'markdown' ? 'markdown' : 'text', text }));
    }
    const limit = caps.max_kb * 1024 + 64;
    if (cipher.length > limit) throw new HttpError(413, 'too_large', `内容太长，上限约 ${caps.max_kb} KB`);

    let maxOpens = parseIntOr(body.max_opens, 1, { min: 0, max: 10000 });
    if (caps.max_opens > 0 && (maxOpens === 0 || maxOpens > caps.max_opens)) {
      throw new HttpError(400, 'too_many_opens', `打开次数最多 ${caps.max_opens} 次`);
    }
    let expiresAt = parseDateToMs(body.expires_at);
    let openTtl = body.open_ttl ? parseIntOr(body.open_ttl, 0, { min: 10, max: 365 * 86400 }) : null;
    if (caps.max_ttl_hours > 0) {
      const latest = Date.now() + caps.max_ttl_hours * HOUR;
      if (!expiresAt || expiresAt > latest) expiresAt = latest;
      if (openTtl && openTtl > caps.max_ttl_hours * 3600) openTtl = caps.max_ttl_hours * 3600;
    }
    if (expiresAt && expiresAt < Date.now()) throw new HttpError(400, 'invalid_input', '有效期不能早于现在');
    const password = typeof body.password === 'string' && body.password ? body.password.slice(0, 200) : null;

    await assertNoteQuota(ctx.env, user);
    const linkId = await createCodeFor(ctx.env, user, 'note', {
      domain,
      code: body.code,
      randomLength: body.random_length || 8,
      note: typeof body.label === 'string' ? body.label.trim() : '',
      expiresAt,
    });
    try {
      await consumeCreation(ctx.env, user, 'notes');
      await ctx.env.DB
        .prepare(
          `INSERT INTO notes(link_id, cipher, enc, kcv, size, max_opens, open_ttl, pw_hash, pw_max_fail, display, theme, meta)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          linkId,
          cipher,
          enc,
          kcv,
          cipher.length,
          maxOpens,
          openTtl,
          password ? await hashPassword(password) : null,
          parseIntOr(body.pw_max_fail, 5, { min: 0, max: 100 }),
          JSON.stringify(sanitizeDisplay(body.display)),
          JSON.stringify(sanitizeTheme(body.theme)),
          JSON.stringify(sanitizeMeta(body.meta))
        )
        .run();
    } catch (e) {
      await deleteLinkCascade(ctx.env, linkId);
      throw e;
    }
    const row = await fetchNoteRow(ctx.env, linkId);
    return ok({ item: noteFromRow(row) }, { status: 201 });
  });

  r.post('/api/notes/:id/burn', async (ctx) => {
    const row = await fetchNoteRow(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '密信不存在');
    await burnNote(ctx.env, row.id, 'manual');
    if (row.created_by !== ctx.user.id) audit(ctx, 'note.burn', { type: 'note', id: row.id, detail: `${row.domain_hostname}/${row.code}` });
    return ok({});
  });

  r.delete('/api/notes/:id', async (ctx) => {
    const row = await fetchNoteRow(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '密信不存在');
    await deleteLinkCascade(ctx.env, row.id);
    if (row.created_by !== ctx.user.id) audit(ctx, 'note.delete', { type: 'note', id: row.id, detail: `${row.domain_hostname}/${row.code}` });
    return ok({});
  });

  // Server-encrypted notes only: lets the author or a content admin read it without consuming an open.
  r.get('/api/notes/:id/content', async (ctx) => {
    const row = await fetchNoteRow(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '密信不存在');
    if (row.n_enc !== 'server') throw new HttpError(400, 'e2e', '端到端加密的密信，服务器无法读取内容');
    const raw = await ctx.env.DB.prepare('SELECT cipher FROM notes WHERE link_id = ?').bind(row.id).first();
    if (!raw?.cipher) throw new HttpError(410, 'burned', '密信已焚毁，内容已删除');
    if (row.created_by !== ctx.user.id) audit(ctx, 'note.view_content', { type: 'note', id: row.id, detail: `${row.domain_hostname}/${row.code}` });
    return ok({ payload: JSON.parse(await serverDecrypt(ctx.env, raw.cipher)) });
  });

  // ---------- public open ----------

  r.post(
    '/api/n/:code/open',
    async (ctx) => {
      const { env, req } = ctx;
      const domain = await lookupDomain(env, hostOf(req));
      if (!domain || domain.is_admin) throw new HttpError(404, 'not_found', '密信不存在');
      const link = await env.DB
        .prepare("SELECT l.*, n.burned_at, n.max_opens, n.opens, n.open_ttl, n.first_open_at, n.pw_hash, n.pw_fail, n.pw_max_fail, n.enc, n.kcv FROM links l JOIN notes n ON n.link_id = l.id WHERE l.domain_id = ? AND l.code = ? AND l.kind = 'note'")
        .bind(domain.id, ctx.params.code)
        .first();
      if (!link) throw new HttpError(404, 'not_found', '密信不存在');
      let body = {};
      try {
        body = await req.json();
      } catch {}
      const now = Date.now();
      const deny = async (status, http, code, message, extra = {}) => {
        await logOpen(env, ctx.ctx, link.id, req, status);
        throw Object.assign(new HttpError(http, code, message), { extra });
      };

      if (!link.enabled) await deny('disabled', 410, 'disabled', '这封密信已被停用');
      if (link.burned_at) await deny('burned', 410, 'burned', '这封密信已焚毁');
      if ((link.expires_at && link.expires_at < now) || (link.first_open_at && link.open_ttl && link.first_open_at + link.open_ttl * 1000 < now)) {
        await burnNote(env, link.id, 'expired');
        await deny('expired', 410, 'expired', '这封密信已过期，内容已销毁');
      }
      if (link.enc === 'e2e' && link.kcv && body.kcv !== link.kcv) {
        throw new HttpError(400, 'bad_key', '链接里的解密密钥不完整或不正确，请确认复制了完整链接（包括 # 后面的部分）');
      }
      if (link.pw_hash) {
        const pw = typeof body.password === 'string' ? body.password : '';
        if (!pw) throw new HttpError(401, 'password_required', '需要访问密码');
        if (!(await verifyPassword(pw, link.pw_hash))) {
          const f = await env.DB.prepare('UPDATE notes SET pw_fail = pw_fail + 1 WHERE link_id = ? RETURNING pw_fail').bind(link.id).first();
          const left = link.pw_max_fail > 0 ? Math.max(0, link.pw_max_fail - (f?.pw_fail || 0)) : null;
          if (left === 0) {
            await burnNote(env, link.id, 'password');
            await deny('denied_password', 410, 'burned', '密码错误次数过多，这封密信已被销毁');
          }
          await deny('denied_password', 401, 'bad_password', left === null ? '密码不正确' : `密码不正确，还可以尝试 ${left} 次`, { attempts_left: left });
        }
      }

      const opened = await env.DB
        .prepare(
          `UPDATE notes SET opens = opens + 1, first_open_at = COALESCE(first_open_at, ?)
           WHERE link_id = ? AND burned_at IS NULL AND (max_opens = 0 OR opens < max_opens)
           RETURNING opens, max_opens, cipher, enc, first_open_at, open_ttl`
        )
        .bind(now, link.id)
        .first();
      if (!opened || !opened.cipher) await deny('exhausted', 410, 'burned', '这封密信的查看次数已用完');

      const lastOpen = opened.max_opens > 0 && opened.opens >= opened.max_opens;
      const stmts = [env.DB.prepare('UPDATE links SET click_count = click_count + 1 WHERE id = ?').bind(link.id)];
      if (lastOpen) {
        stmts.push(env.DB.prepare("UPDATE notes SET cipher = NULL, burned_at = ?, burn_reason = 'exhausted' WHERE link_id = ?").bind(now, link.id));
      }
      await env.DB.batch(stmts);
      await logOpen(env, ctx.ctx, link.id, req, 'opened');

      const res = {
        enc: opened.enc,
        opens: opened.opens,
        max_opens: opened.max_opens,
        remaining: opened.max_opens > 0 ? opened.max_opens - opened.opens : null,
        burned: lastOpen,
        readable_until: opened.open_ttl ? opened.first_open_at + opened.open_ttl * 1000 : null,
      };
      if (opened.enc === 'server') res.payload = JSON.parse(await serverDecrypt(env, opened.cipher));
      else res.cipher = b64urlEncode(new Uint8Array(opened.cipher));
      return ok(res, { headers: { 'cache-control': 'no-store' } });
    },
    { auth: 'none' }
  );
}
