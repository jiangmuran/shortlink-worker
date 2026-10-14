// Public REST API under /api/v1 — authenticated with API keys
// (Authorization: Bearer sk_...), CORS-enabled so it can be called from
// anywhere. See public/docs.html for the human-friendly reference.

import { canCreateLinks, canViewLogs, canAccessDomain, getSettings } from './auth.js';
import { fetchLinkRow } from './api-main.js';
import {
  ok,
  HttpError,
  readJsonBody,
  isValidCode,
  normalizeTargetUrl,
  randomCode,
  clampStyle,
  parseDateToMs,
  safeParseJson,
  linkUrl,
} from './util.js';

const MODES = new Set(['direct', 'page', 'confirm']);
const RESERVED_CODES = new Set(['favicon.ico', 'robots.txt', 'index.html']);

function requireScope(ctx, scope) {
  const scopes = safeParseJson(ctx.key.scopes, []);
  if (!scopes.includes(scope)) {
    throw new HttpError(403, 'insufficient_scope', `该密钥缺少 ${scope} 权限`);
  }
}

async function findDomain(env, user, ref) {
  let row = null;
  if (ref) {
    if (/^\d+$/.test(String(ref))) {
      row = await env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(Number(ref)).first();
    } else {
      row = await env.DB.prepare('SELECT * FROM domains WHERE hostname = ?').bind(String(ref).toLowerCase()).first();
    }
  } else {
    row = await env.DB.prepare('SELECT * FROM domains WHERE is_admin = 0 ORDER BY id LIMIT 1').first();
  }
  if (!row) throw new HttpError(404, 'domain_not_found', '未找到可用域名，请先在控制台绑定');
  if (row.is_admin) throw new HttpError(400, 'invalid_domain', '管理域名不能用于短链');
  if (!canAccessDomain(user, row.id)) throw new HttpError(403, 'forbidden', '该密钥所属账户没有此域名的权限');
  return row;
}

function serialize(row) {
  return {
    id: row.id,
    short_url: linkUrl(row.domain_hostname, row.code),
    code: row.code,
    domain: row.domain_hostname,
    target: row.target,
    note: row.note || '',
    mode: row.mode,
    style: safeParseJson(row.style, {}),
    enabled: !!row.enabled,
    expires_at: row.expires_at || null,
    click_count: row.click_count || 0,
    clicks_7d: row.clicks_7d ?? undefined,
    created_at: row.created_at,
  };
}

export function registerV1Routes(r) {
  r.get(
    '/api/v1/me',
    async (ctx) => {
      return ok({
        user: ctx.user.username,
        role: ctx.user.role,
        key: { name: ctx.key.name, scopes: safeParseJson(ctx.key.scopes, []) },
      });
    },
    { auth: 'key' }
  );

  r.get(
    '/api/v1/domains',
    async (ctx) => {
      requireScope(ctx, 'domains:read');
      const { results } = await ctx.env.DB
        .prepare(`SELECT d.*, (SELECT COUNT(*) FROM links l WHERE l.domain_id = d.id) AS link_count FROM domains d WHERE d.is_admin = 0 ORDER BY d.id`)
        .all();
      return ok({
        items: (results || []).filter((d) => canAccessDomain(ctx.user, d.id)).map((d) => ({
          id: d.id,
          hostname: d.hostname,
          remark: d.remark || '',
          link_count: d.link_count,
        })),
      });
    },
    { auth: 'key', scope: 'domains:read' }
  );

  r.get(
    '/api/v1/links',
    async (ctx) => {
      requireScope(ctx, 'links:read');
      const q = ctx.query;
      const page = Math.min(10000, Math.max(1, Number(q.get('page')) || 1));
      const per = Math.min(100, Math.max(1, Number(q.get('per')) || 20));
      const weekAgo = Date.now() - 7 * 86400000;
      const where = [];
      const params = [];
      if (ctx.user.role !== 'admin') {
        where.push('l.created_by = ?');
        params.push(ctx.user.id);
      }
      const domainRef = q.get('domain');
      if (domainRef) {
        const domain = await findDomain(ctx.env, ctx.user, domainRef);
        where.push('l.domain_id = ?');
        params.push(domain.id);
      }
      const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const count = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM links l${whereSql}`).bind(...params).first();
      const { results } = await ctx.env.DB
        .prepare(
          `SELECT l.*, d.hostname AS domain_hostname,
            (SELECT COUNT(*) FROM logs g WHERE g.link_id = l.id AND g.ts >= ?) AS clicks_7d
           FROM links l JOIN domains d ON d.id = l.domain_id${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
        )
        .bind(weekAgo, ...params, per, (page - 1) * per)
        .all();
      return ok({ items: (results || []).map(serialize), total: count.n, page, per_page: per });
    },
    { auth: 'key', scope: 'links:read' }
  );

  r.post(
    '/api/v1/links',
    async (ctx) => {
      requireScope(ctx, 'links:write');
      if (!canCreateLinks(ctx.user)) throw new HttpError(403, 'forbidden', '该账户没有创建短链的权限');
      const body = await readJsonBody(ctx.req);
      const target = normalizeTargetUrl(body.url ?? body.target);
      if (!target) throw new HttpError(400, 'invalid_target', 'url 必须是有效的 http(s) 链接');
      const domain = await findDomain(ctx.env, ctx.user, body.domain ?? body.domain_id);

      if (ctx.user.role !== 'admin' && ctx.user.quota_max_links > 0) {
        const row = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM links WHERE created_by = ?').bind(ctx.user.id).first();
        if (row.n >= ctx.user.quota_max_links) throw new HttpError(403, 'quota_exceeded', `已达到短链数量上限（${ctx.user.quota_max_links} 条）`);
      }

      const settings = await getSettings(ctx.env);
      const mode = MODES.has(body.mode) ? body.mode : settings.default_mode;
      const style = clampStyle(safeParseJson(body.style, {}), mode, settings.default_style);
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
      const expiresAt = parseDateToMs(body.expires_at);

      let code;
      if (body.code && String(body.code).trim()) {
        code = String(body.code).trim();
        if (!isValidCode(code)) throw new HttpError(400, 'invalid_code', 'code 仅支持 1-64 位字母、数字、下划线和连字符');
        if (RESERVED_CODES.has(code)) throw new HttpError(400, 'invalid_code', '该 code 为保留字');
      } else {
        const len = Math.min(10, Math.max(4, Number(body.length) || 6));
        for (let i = 0; i < 6; i++) {
          const candidate = randomCode(len);
          const exists = await ctx.env.DB.prepare('SELECT 1 FROM links WHERE domain_id = ? AND code = ?').bind(domain.id, candidate).first();
          if (!exists) {
            code = candidate;
            break;
          }
        }
        if (!code) throw new HttpError(500, 'code_collision', '随机 code 分配失败，请重试');
      }

      const now = Date.now();
      try {
        const res = await ctx.env.DB
          .prepare('INSERT INTO links(domain_id, code, target, note, mode, style, enabled, expires_at, created_by, click_count, created_at, updated_at) VALUES(?,?,?,?,?,?,1,?,?,0,?,?)')
          .bind(domain.id, code, target, note, mode, JSON.stringify(style), expiresAt, ctx.user.id, now, now)
          .run();
        const row = await fetchLinkRow(ctx.env, res.meta.last_row_id);
        return ok(serialize(row), { status: 201 });
      } catch (e) {
        if (String(e?.message || '').includes('UNIQUE')) throw new HttpError(409, 'code_taken', '该 code 已被使用');
        throw e;
      }
    },
    { auth: 'key', scope: 'links:write' }
  );

  r.get(
    '/api/v1/links/:id',
    async (ctx) => {
      requireScope(ctx, 'links:read');
      const row = await fetchLinkRow(ctx.env, ctx.params.id);
      if (!row || (ctx.user.role !== 'admin' && row.created_by !== ctx.user.id)) {
        throw new HttpError(404, 'not_found', '短链不存在');
      }
      return ok(serialize(row));
    },
    { auth: 'key', scope: 'links:read' }
  );

  r.patch(
    '/api/v1/links/:id',
    async (ctx) => {
      requireScope(ctx, 'links:write');
      const row = await fetchLinkRow(ctx.env, ctx.params.id);
      if (!row || (ctx.user.role !== 'admin' && row.created_by !== ctx.user.id)) {
        throw new HttpError(404, 'not_found', '短链不存在');
      }
      const body = await readJsonBody(ctx.req);
      const sets = [];
      const params = [];
      if (body.url !== undefined || body.target !== undefined) {
        const target = normalizeTargetUrl(body.url ?? body.target);
        if (!target) throw new HttpError(400, 'invalid_target', 'url 必须是有效的 http(s) 链接');
        sets.push('target = ?');
        params.push(target);
      }
      if (body.note !== undefined) {
        sets.push('note = ?');
        params.push(String(body.note).trim().slice(0, 200));
      }
      if (body.mode !== undefined) {
        if (!MODES.has(body.mode)) throw new HttpError(400, 'invalid_mode', '无效的 mode');
        sets.push('mode = ?');
        params.push(body.mode);
      }
      if (body.style !== undefined) {
        sets.push('style = ?');
        params.push(JSON.stringify(clampStyle(safeParseJson(body.style, {}), body.mode || row.mode)));
      }
      if (body.enabled !== undefined) {
        sets.push('enabled = ?');
        params.push(body.enabled ? 1 : 0);
      }
      if (body.expires_at !== undefined) {
        sets.push('expires_at = ?');
        params.push(parseDateToMs(body.expires_at));
      }
      if (!sets.length) return ok(serialize(row));
      sets.push('updated_at = ?');
      params.push(Date.now());
      params.push(row.id);
      await ctx.env.DB.prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
      return ok(serialize(await fetchLinkRow(ctx.env, row.id)));
    },
    { auth: 'key', scope: 'links:write' }
  );

  r.delete(
    '/api/v1/links/:id',
    async (ctx) => {
      requireScope(ctx, 'links:write');
      const row = await fetchLinkRow(ctx.env, ctx.params.id);
      if (!row || (ctx.user.role !== 'admin' && row.created_by !== ctx.user.id)) {
        throw new HttpError(404, 'not_found', '短链不存在');
      }
      await ctx.env.DB.batch([
        ctx.env.DB.prepare('DELETE FROM logs WHERE link_id = ?').bind(row.id),
        ctx.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(row.id),
      ]);
      return ok({ deleted: true });
    },
    { auth: 'key', scope: 'links:write' }
  );

  r.get(
    '/api/v1/links/:id/stats',
    async (ctx) => {
      requireScope(ctx, 'links:read');
      if (!canViewLogs(ctx.user)) throw new HttpError(403, 'forbidden', '该账户没有查看统计的权限');
      const row = await fetchLinkRow(ctx.env, ctx.params.id);
      if (!row || (ctx.user.role !== 'admin' && row.created_by !== ctx.user.id)) {
        throw new HttpError(404, 'not_found', '短链不存在');
      }
      const now = Date.now();
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const [today, week, month, recent] = await Promise.all([
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE link_id = ? AND ts >= ?').bind(row.id, dayStart.getTime()).first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE link_id = ? AND ts >= ?').bind(row.id, now - 7 * 86400000).first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE link_id = ? AND ts >= ?').bind(row.id, now - 30 * 86400000).first(),
        ctx.env.DB.prepare('SELECT ts, ip, country, city, ua, referer FROM logs WHERE link_id = ? ORDER BY id DESC LIMIT 10').bind(row.id).all(),
      ]);
      return ok({
        click_count: row.click_count,
        clicks_today: today.n,
        clicks_7d: week.n,
        clicks_30d: month.n,
        recent: recent.results || [],
      });
    },
    { auth: 'key', scope: 'links:read' }
  );
}
