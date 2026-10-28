// Public REST API under /api/v1 — authenticated with API keys
// (Authorization: Bearer sk_...), CORS-enabled so it can be called from
// anywhere. See public/docs.html for the human-friendly reference.
// Link creation/editing goes through links-service.js, so group
// capabilities (quotas, custom codes, modes, target edits) apply here too.

import { canViewLogs, canAccessDomain, canSeeAll, capsOf, getSettings } from './auth.js';
import { linkSelect, fetchLinkRow, createLink, updateLink, deleteLinkCascade } from './links-service.js';
import { applyIpPolicy } from './caps.js';
import { ok, HttpError, readJsonBody, safeParseJson, linkUrl } from './util.js';

const DAY = 86400000;

function requireScope(ctx, scope) {
  if (!(ctx.key._scopes || []).includes(scope)) {
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
    const { results } = await env.DB.prepare('SELECT * FROM domains WHERE is_admin = 0 ORDER BY id').all();
    row = (results || []).find((d) => canAccessDomain(user, d.id)) || null;
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

async function ownedLink(ctx) {
  const row = await fetchLinkRow(ctx.env, ctx.params.id);
  if (!row || row.kind !== 'link' || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) {
    throw new HttpError(404, 'not_found', '短链不存在');
  }
  return row;
}

export function registerV1Routes(r) {
  r.get(
    '/api/v1/me',
    async (ctx) => {
      return ok({
        user: ctx.user.username,
        role: ctx.user.role,
        key: { name: ctx.key.name, scopes: ctx.key._scopes || [] },
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
      const where = ["l.kind = 'link'"];
      const params = [];
      if (!canSeeAll(ctx.user)) {
        where.push('l.created_by = ?');
        params.push(ctx.user.id);
      }
      const domainRef = q.get('domain');
      if (domainRef) {
        const domain = await findDomain(ctx.env, ctx.user, domainRef);
        where.push('l.domain_id = ?');
        params.push(domain.id);
      }
      const whereSql = ' WHERE ' + where.join(' AND ');
      const { sql, binds } = await linkSelect(ctx.env);
      const count = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM links l${whereSql}`).bind(...params).first();
      const { results } = await ctx.env.DB
        .prepare(`${sql}${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...binds, ...params, per, (page - 1) * per)
        .all();
      return ok({ items: (results || []).map(serialize), total: count.n, page, per_page: per });
    },
    { auth: 'key', scope: 'links:read' }
  );

  r.post(
    '/api/v1/links',
    async (ctx) => {
      requireScope(ctx, 'links:write');
      const body = await readJsonBody(ctx.req);
      const domain = await findDomain(ctx.env, ctx.user, body.domain ?? body.domain_id);
      const row = await createLink(ctx.env, ctx.user, {
        domain,
        target: body.url ?? body.target,
        code: body.code,
        randomLength: body.length,
        note: body.note,
        mode: body.mode,
        style: body.style,
        expiresAt: body.expires_at,
      });
      return ok(serialize(row), { status: 201 });
    },
    { auth: 'key', scope: 'links:write' }
  );

  r.get(
    '/api/v1/links/:id',
    async (ctx) => {
      requireScope(ctx, 'links:read');
      return ok(serialize(await ownedLink(ctx)));
    },
    { auth: 'key', scope: 'links:read' }
  );

  r.patch(
    '/api/v1/links/:id',
    async (ctx) => {
      requireScope(ctx, 'links:write');
      const row = await ownedLink(ctx);
      const body = await readJsonBody(ctx.req);
      const updated = await updateLink(ctx.env, ctx.user, row, {
        target: body.url ?? body.target,
        note: body.note,
        mode: body.mode,
        style: body.style,
        enabled: body.enabled,
        expiresAt: body.expires_at,
        code: body.code,
      });
      return ok(serialize(updated));
    },
    { auth: 'key', scope: 'links:write' }
  );

  r.delete(
    '/api/v1/links/:id',
    async (ctx) => {
      requireScope(ctx, 'links:write');
      const row = await ownedLink(ctx);
      await deleteLinkCascade(ctx.env, row.id);
      return ok({ deleted: true });
    },
    { auth: 'key', scope: 'links:write' }
  );

  r.get(
    '/api/v1/links/:id/stats',
    async (ctx) => {
      requireScope(ctx, 'links:read');
      if (!canViewLogs(ctx.user)) throw new HttpError(403, 'forbidden', '该账户没有查看统计的权限');
      const row = await ownedLink(ctx);
      const today = Math.floor(Date.now() / DAY);
      const [rolled, live, recent] = await Promise.all([
        ctx.env.DB.prepare('SELECT day, clicks FROM link_daily WHERE link_id = ? AND day >= ?').bind(row.id, today - 29).all(),
        ctx.env.DB.prepare("SELECT CAST(ts / 86400000 AS INTEGER) AS day, COUNT(*) AS c FROM logs WHERE link_id = ? AND ts >= ? AND status = 'hit' GROUP BY day")
          .bind(row.id, Math.max(Date.now() - 30 * DAY, (await getSettings(ctx.env)).rollup_until))
          .all(),
        ctx.env.DB.prepare('SELECT ts, ip, country, city, ua, referer FROM logs WHERE link_id = ? ORDER BY id DESC LIMIT 10').bind(row.id).all(),
      ]);
      const byDay = new Map();
      for (const x of rolled.results || []) byDay.set(x.day, (byDay.get(x.day) || 0) + x.clicks);
      for (const x of live.results || []) byDay.set(x.day, (byDay.get(x.day) || 0) + x.c);
      const sum = (n) => {
        let s = 0;
        for (let d = today - n + 1; d <= today; d++) s += byDay.get(d) || 0;
        return s;
      };
      const policy = capsOf(ctx.user).logs.ip;
      return ok({
        click_count: row.click_count,
        clicks_today: byDay.get(today) || 0,
        clicks_7d: sum(7),
        clicks_30d: sum(30),
        recent: (recent.results || []).map((g) => ({ ...g, ip: applyIpPolicy(g.ip, policy) })),
      });
    },
    { auth: 'key', scope: 'links:read' }
  );
}
