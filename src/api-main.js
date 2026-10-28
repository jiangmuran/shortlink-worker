// /api/links, /api/domains, /api/logs, /api/stats — core resources.

import { isAdmin, canViewLogs, canManageLink, canSeeAll, allowedDomainIds, getSettings, capsOf } from './auth.js';
import {
  RESERVED_CODES,
  MODES,
  linkSelect,
  fetchLinkRow,
  linkFromRow,
  createLink,
  updateLink,
  deleteLinkCascade,
  resolveUsableDomain,
} from './links-service.js';
import { applyIpPolicy } from './caps.js';
import { invalidateDomains } from './domains.js';
import { audit } from './audit.js';
import { ok, HttpError, readJsonBody, isValidCode, isValidHostname, clampStyle, parseIntOr, safeParseJson, linkUrl } from './util.js';

export { fetchLinkRow };

const DAY = 86400000;
const COUNTED = "('hit', 'opened')";

function domainFromRow(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    remark: row.remark || '',
    is_admin: !!row.is_admin,
    defaults: safeParseJson(row.defaults, {}),
    link_count: row.link_count ?? undefined,
    created_at: row.created_at,
  };
}

export function registerMainRoutes(r) {
  // ---------- links ----------

  r.get('/api/links', async (ctx) => {
    const q = ctx.query;
    const page = parseIntOr(q.get('page'), 1, { min: 1, max: 10000 });
    const perPage = parseIntOr(q.get('per'), 20, { min: 5, max: 100 });
    const kind = ['link', 'note', 'room'].includes(q.get('kind')) ? q.get('kind') : 'link';

    const where = ['l.kind = ?'];
    const condParams = [kind];
    if (!canSeeAll(ctx.user) || q.get('mine') === '1') {
      where.push('l.created_by = ?');
      condParams.push(ctx.user.id);
    }
    if (q.get('domain_id')) {
      where.push('l.domain_id = ?');
      condParams.push(Number(q.get('domain_id')));
    }
    if (q.get('owner_id') && canSeeAll(ctx.user)) {
      where.push('l.created_by = ?');
      condParams.push(Number(q.get('owner_id')));
    }
    const search = (q.get('q') || '').trim();
    if (search) {
      where.push("(l.code LIKE ? ESCAPE '\\' OR l.target LIKE ? ESCAPE '\\' OR l.note LIKE ? ESCAPE '\\')");
      const like = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      condParams.push(like, like, like);
    }
    switch (q.get('status')) {
      case 'active':
        where.push('l.enabled = 1 AND (l.expires_at IS NULL OR l.expires_at >= ?)');
        condParams.push(Date.now());
        break;
      case 'disabled':
        where.push('l.enabled = 0');
        break;
      case 'expired':
        where.push('l.expires_at IS NOT NULL AND l.expires_at < ?');
        condParams.push(Date.now());
        break;
    }
    const whereSql = ' WHERE ' + where.join(' AND ');

    const { sql, binds } = await linkSelect(ctx.env);
    const countRow = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM links l${whereSql}`).bind(...condParams).first();
    const { results } = await ctx.env.DB
      .prepare(`${sql}${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, ...condParams, perPage, (page - 1) * perPage)
      .all();
    return ok({
      items: (results || []).map(linkFromRow),
      total: countRow?.n || 0,
      page,
      per_page: perPage,
    });
  });

  r.get('/api/links/:id', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row)) throw new HttpError(403, 'forbidden', '无权访问该短链');
    return ok({ item: linkFromRow(row) });
  });

  r.post('/api/links', async (ctx) => {
    const body = await readJsonBody(ctx.req);
    const domain = await resolveUsableDomain(ctx.env, ctx.user, body.domain_id);
    const row = await createLink(ctx.env, ctx.user, {
      domain,
      target: body.target,
      code: body.code,
      randomLength: body.random_length,
      note: body.note,
      mode: body.mode,
      style: body.style,
      expiresAt: body.expires_at,
    });
    return ok({ item: linkFromRow(row) }, { status: 201 });
  });

  r.patch('/api/links/:id', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row)) throw new HttpError(403, 'forbidden', '无权修改该短链');
    const body = await readJsonBody(ctx.req);
    const updated = await updateLink(ctx.env, ctx.user, row, {
      target: body.target,
      note: body.note,
      mode: body.mode,
      style: body.style,
      enabled: body.enabled,
      expiresAt: body.expires_at,
      code: body.code,
      domainId: body.domain_id,
    });
    return ok({ item: linkFromRow(updated) });
  });

  r.delete('/api/links/:id', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row)) throw new HttpError(403, 'forbidden', '无权删除该短链');
    await deleteLinkCascade(ctx.env, row.id);
    if (row.created_by !== ctx.user.id) audit(ctx, 'link.delete', { type: 'link', id: row.id, detail: `${row.domain_hostname}/${row.code}` });
    return ok({});
  });

  r.get('/api/code-check', async (ctx) => {
    const domainId = Number(ctx.query.get('domain_id'));
    const code = (ctx.query.get('code') || '').trim();
    const caps = capsOf(ctx.user).links;
    if (!isValidCode(code)) return ok({ available: false, reason: 'invalid' });
    if (RESERVED_CODES.has(code)) return ok({ available: false, reason: 'reserved' });
    if (!caps.custom_code) return ok({ available: false, reason: 'forbidden' });
    if (code.length < caps.min_code_len) return ok({ available: false, reason: 'too_short', min: caps.min_code_len });
    const exists = await ctx.env.DB
      .prepare('SELECT 1 FROM links WHERE domain_id = ? AND code = ?')
      .bind(domainId, code)
      .first();
    return ok({ available: !exists, reason: exists ? 'taken' : null });
  });

  // ---------- per-link logs ----------

  r.get('/api/links/:id/logs', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row)) throw new HttpError(403, 'forbidden', '无权访问该短链');
    if (!canViewLogs(ctx.user)) throw new HttpError(403, 'forbidden', '该账户没有查看访问记录的权限');
    const logs = await fetchLogs(ctx, 'g.link_id = ?', [row.id]);
    return ok({ link: { id: row.id, code: row.code, hostname: row.domain_hostname, url: linkUrl(row.domain_hostname, row.code) }, ...logs });
  });

  r.get('/api/links/:id/logs.csv', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row) || !canViewLogs(ctx.user)) throw new HttpError(403, 'forbidden', '无权导出该记录');
    if (!capsOf(ctx.user).logs.export) throw new HttpError(403, 'forbidden', '当前账户不能导出访问记录');
    const { results } = await ctx.env.DB
      .prepare('SELECT ts, ip, country, city, ua, referer, status FROM logs WHERE link_id = ? ORDER BY ts DESC LIMIT 20000')
      .bind(row.id)
      .all();
    const policy = capsOf(ctx.user).logs.ip;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['time,ip,country,city,user_agent,referer,status'];
    for (const g of results || []) {
      lines.push(
        [new Date(g.ts).toISOString(), applyIpPolicy(g.ip, policy), g.country, g.city, g.ua, g.referer, g.status].map(esc).join(',')
      );
    }
    return new Response('﻿' + lines.join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="logs-${row.code}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });

  // ---------- domains ----------

  r.get('/api/domains', async (ctx) => {
    const admin = isAdmin(ctx.user);
    const allowed = allowedDomainIds(ctx.user);
    const { results } = await ctx.env.DB
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM links l WHERE l.domain_id = d.id) AS link_count FROM domains d ORDER BY d.is_admin DESC, d.hostname ASC`
      )
      .all();
    const items = (results || [])
      .filter((d) => admin || d.is_admin || allowed.includes(d.id))
      .map((d) => ({ ...domainFromRow(d), can_use: admin || (!d.is_admin && allowed.includes(d.id)) }));
    return ok({ items });
  });

  r.post(
    '/api/domains',
    async (ctx) => {
      const body = await readJsonBody(ctx.req);
      const hostname = normalizeHostname(body.hostname);
      if (!isValidHostname(hostname)) throw new HttpError(400, 'invalid_hostname', '域名格式无效');
      const exists = await ctx.env.DB.prepare('SELECT 1 FROM domains WHERE hostname = ?').bind(hostname).first();
      if (exists) throw new HttpError(409, 'domain_exists', '该域名已存在');
      const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, 200) : '';
      const defaults = sanitizeDefaults(body.defaults);
      const res = await ctx.env.DB
        .prepare('INSERT INTO domains(hostname, remark, is_admin, defaults, created_at) VALUES(?,?,?,?,?)')
        .bind(hostname, remark, body.is_admin ? 1 : 0, JSON.stringify(defaults), Date.now())
        .run();
      invalidateDomains();
      audit(ctx, 'domain.create', { type: 'domain', id: res.meta.last_row_id, detail: hostname });
      const row = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(res.meta.last_row_id).first();
      return ok({ item: domainFromRow(row) }, { status: 201 });
    },
    { auth: 'admin', perm: 'domains' }
  );

  r.patch(
    '/api/domains/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '域名不存在');
      const body = await readJsonBody(ctx.req);
      const sets = [];
      const params = [];

      if (body.remark !== undefined) {
        sets.push('remark = ?');
        params.push(String(body.remark).trim().slice(0, 200));
      }
      if (body.defaults !== undefined) {
        sets.push('defaults = ?');
        params.push(JSON.stringify(sanitizeDefaults({ ...safeParseJson(row.defaults, {}), ...sanitizeDefaults(body.defaults) })));
      }
      if (body.is_admin !== undefined) {
        const want = body.is_admin ? 1 : 0;
        if (!want && row.is_admin) {
          const others = await ctx.env.DB
            .prepare('SELECT COUNT(*) AS n FROM domains WHERE is_admin = 1 AND id != ?')
            .bind(row.id)
            .first();
          if (!others.n) throw new HttpError(400, 'last_admin_domain', '至少保留一个管理域名，否则将无法访问控制台');
        }
        sets.push('is_admin = ?');
        params.push(want);
      }
      if (!sets.length) return ok({ item: domainFromRow(row) });
      params.push(row.id);
      await ctx.env.DB.prepare(`UPDATE domains SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
      invalidateDomains();
      audit(ctx, 'domain.update', { type: 'domain', id: row.id, detail: row.hostname });
      const updated = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(row.id).first();
      return ok({ item: domainFromRow(updated) });
    },
    { auth: 'admin', perm: 'domains' }
  );

  r.delete(
    '/api/domains/:id',
    async (ctx) => {
      const row = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(ctx.params.id).first();
      if (!row) throw new HttpError(404, 'not_found', '域名不存在');
      if (row.is_admin) {
        const others = await ctx.env.DB
          .prepare('SELECT COUNT(*) AS n FROM domains WHERE is_admin = 1 AND id != ?')
          .bind(row.id)
          .first();
        if (!others.n) throw new HttpError(400, 'last_admin_domain', '不能删除唯一的管理域名');
      }
      let deleted = 0;
      if (ctx.query.get('with_links') === '1') {
        const { results } = await ctx.env.DB.prepare('SELECT id FROM links WHERE domain_id = ?').bind(row.id).all();
        for (const l of results || []) await deleteLinkCascade(ctx.env, l.id);
        deleted = (results || []).length;
      }
      await ctx.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(row.id).run();
      invalidateDomains();
      audit(ctx, 'domain.delete', { type: 'domain', id: row.id, detail: row.hostname });
      return ok({ deleted_links: deleted });
    },
    { auth: 'admin', perm: 'domains' }
  );

  // ---------- global logs ----------

  r.get(
    '/api/logs',
    async (ctx) => {
      const logs = await fetchLogs(ctx, '1=1', [], { withLink: true });
      return ok(logs);
    },
    { auth: 'admin', perm: 'content' }
  );

  // ---------- stats (rollups + live tail since the rollup watermark) ----------

  r.get('/api/stats', async (ctx) => {
    const all = canSeeAll(ctx.user);
    const db = ctx.env.DB;
    const settings = await getSettings(ctx.env);
    const now = Date.now();
    const today = Math.floor(now / DAY);
    const watermark = Math.max(settings.rollup_until, now - 30 * DAY);
    const own = all ? '' : ' AND l.created_by = ?';
    const ownBind = all ? [] : [ctx.user.id];

    const [rolledDays, liveDays, rolledLinks, liveLinks, totals, recentRows] = await Promise.all([
      db.prepare(`SELECT x.day, SUM(x.clicks) AS c FROM link_daily x JOIN links l ON l.id = x.link_id WHERE x.day >= ?${own} GROUP BY x.day`)
        .bind(today - 29, ...ownBind).all(),
      db.prepare(`SELECT CAST(g.ts / ${DAY} AS INTEGER) AS day, COUNT(*) AS c FROM logs g JOIN links l ON l.id = g.link_id WHERE g.ts >= ? AND g.status IN ${COUNTED}${own} GROUP BY day`)
        .bind(watermark, ...ownBind).all(),
      db.prepare(`SELECT x.link_id, SUM(x.clicks) AS c FROM link_daily x JOIN links l ON l.id = x.link_id WHERE x.day >= ?${own} GROUP BY x.link_id ORDER BY c DESC LIMIT 20`)
        .bind(today - 6, ...ownBind).all(),
      db.prepare(`SELECT g.link_id, COUNT(*) AS c FROM logs g JOIN links l ON l.id = g.link_id WHERE g.ts >= ? AND g.status IN ${COUNTED}${own} GROUP BY g.link_id`)
        .bind(Math.max(watermark, now - 7 * DAY), ...ownBind).all(),
      db.prepare(`SELECT
          SUM(CASE WHEN l.kind = 'link' THEN 1 ELSE 0 END) AS links,
          SUM(CASE WHEN l.kind = 'note' THEN 1 ELSE 0 END) AS notes
        FROM links l WHERE 1=1${own}`).bind(...ownBind).first(),
      db.prepare(`SELECT g.ts, g.ip, g.country, g.city, g.ua, g.status, l.code, l.kind, l.id AS link_id, d.hostname
         FROM logs g JOIN links l ON l.id = g.link_id JOIN domains d ON d.id = l.domain_id
         WHERE g.status IN ${COUNTED}${own} ORDER BY g.id DESC LIMIT 8`).bind(...ownBind).all(),
    ]);

    const byDay = new Map();
    for (const r of rolledDays.results || []) byDay.set(r.day, (byDay.get(r.day) || 0) + r.c);
    for (const r of liveDays.results || []) byDay.set(r.day, (byDay.get(r.day) || 0) + r.c);
    const sumDays = (n) => {
      let s = 0;
      for (let d = today - n + 1; d <= today; d++) s += byDay.get(d) || 0;
      return s;
    };
    const series = [];
    for (let d = today - 13; d <= today; d++) {
      series.push({ day: d, date: new Date(d * DAY).toISOString().slice(0, 10), count: byDay.get(d) || 0 });
    }

    const byLink = new Map();
    for (const r of rolledLinks.results || []) byLink.set(r.link_id, (byLink.get(r.link_id) || 0) + r.c);
    for (const r of liveLinks.results || []) byLink.set(r.link_id, (byLink.get(r.link_id) || 0) + r.c);
    const topIds = [...byLink.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    let topLinks = [];
    if (topIds.length) {
      const { results } = await db
        .prepare(`SELECT l.id, l.code, l.kind, l.click_count, d.hostname FROM links l JOIN domains d ON d.id = l.domain_id WHERE l.id IN (${topIds.map(() => '?').join(',')})`)
        .bind(...topIds.map((t) => t[0]))
        .all();
      const rows = new Map((results || []).map((r) => [r.id, r]));
      topLinks = topIds
        .filter(([id]) => rows.has(id))
        .map(([id, c]) => {
          const t = rows.get(id);
          return { id, code: t.code, kind: t.kind, hostname: t.hostname, url: linkUrl(t.hostname, t.code), clicks_7d: c, click_count: t.click_count };
        });
    }

    const policy = capsOf(ctx.user).logs.ip;
    let users_n = 0;
    let domains_n = 0;
    if (all) {
      const [u, d] = await Promise.all([
        db.prepare('SELECT COUNT(*) AS n FROM users').first(),
        db.prepare('SELECT COUNT(*) AS n FROM domains WHERE is_admin = 0').first(),
      ]);
      users_n = u.n;
      domains_n = d.n;
    } else {
      const ids = allowedDomainIds(ctx.user);
      domains_n = ids === 'all' ? (await db.prepare('SELECT COUNT(*) AS n FROM domains WHERE is_admin = 0').first()).n : ids.length;
    }

    return ok({
      links_total: totals?.links || 0,
      notes_total: totals?.notes || 0,
      clicks_today: byDay.get(today) || 0,
      clicks_7d: sumDays(7),
      clicks_30d: sumDays(30),
      series,
      top_links: topLinks,
      recent: (recentRows.results || []).map((g) => ({ ...g, ip: applyIpPolicy(g.ip, policy) })),
      users_total: users_n,
      domains_total: domains_n,
      scope: all ? 'all' : 'own',
    });
  });
}

async function fetchLogs(ctx, whereSql, params, { withLink = false } = {}) {
  const q = ctx.query;
  const page = parseIntOr(q.get('page'), 1, { min: 1, max: 100000 });
  const perPage = parseIntOr(q.get('per'), 20, { min: 5, max: 100 });
  const conditions = [whereSql];
  const binds = [...params];
  if (withLink) {
    const domainId = Number(q.get('domain_id')) || null;
    if (domainId) {
      conditions.push('l.domain_id = ?');
      binds.push(domainId);
    }
    const kind = q.get('kind');
    if (['link', 'note', 'room'].includes(kind)) {
      conditions.push('l.kind = ?');
      binds.push(kind);
    }
    const search = (q.get('q') || '').trim();
    if (search) {
      conditions.push("(l.code LIKE ? ESCAPE '\\' OR g.ip LIKE ? ESCAPE '\\' OR g.ua LIKE ? ESCAPE '\\')");
      const like = `%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      binds.push(like, like, like);
    }
  }
  const where = ' WHERE ' + conditions.join(' AND ');
  const from = withLink
    ? ' FROM logs g JOIN links l ON l.id = g.link_id JOIN domains d ON d.id = l.domain_id'
    : ' FROM logs g';

  const countRow = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n${from}${where}`).bind(...binds).first();
  const { results } = await ctx.env.DB
    .prepare(`SELECT g.*${withLink ? ', l.code, l.kind, l.id AS link_id, d.hostname' : ''}${from}${where} ORDER BY g.id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, perPage, (page - 1) * perPage)
    .all();
  const policy = capsOf(ctx.user).logs.ip;
  const items = (results || []).map((g) => ({ ...g, ip: applyIpPolicy(g.ip, policy) }));
  return { items, total: countRow?.n || 0, page, per_page: perPage, ip_policy: policy, can_export: !!capsOf(ctx.user).logs.export };
}

function normalizeHostname(raw) {
  let h = String(raw || '').trim().toLowerCase();
  if (!h) return h;
  if (!/^[a-z]+:\/\//.test(h)) h = 'https://' + h;
  try {
    return new URL(h).hostname;
  } catch {
    return '';
  }
}

function sanitizeDefaults(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (MODES.has(d.mode)) out.mode = d.mode;
  const style = clampStyle(safeParseJson(d.style, {}), out.mode || d.mode || 'page');
  if (Object.keys(style).length) out.style = style;
  return out;
}
