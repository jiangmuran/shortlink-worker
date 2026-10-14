// /api/links, /api/domains, /api/logs, /api/stats — core resources.

import {
  isAdmin,
  canCreateLinks,
  canViewLogs,
  canAccessDomain,
  canManageLink,
  allowedDomainIds,
  getSettings,
} from './auth.js';
import {
  ok,
  HttpError,
  readJsonBody,
  isValidCode,
  isValidHostname,
  normalizeTargetUrl,
  randomCode,
  clampStyle,
  parseDateToMs,
  parseIntOr,
  safeParseJson,
  linkUrl,
} from './util.js';

const RESERVED_CODES = new Set(['favicon.ico', 'robots.txt', 'index.html']);
const MODES = new Set(['direct', 'page', 'confirm']);

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

function linkFromRow(row) {
  return {
    id: row.id,
    code: row.code,
    domain: { id: row.domain_id, hostname: row.domain_hostname },
    url: linkUrl(row.domain_hostname, row.code),
    target: row.target,
    note: row.note || '',
    mode: row.mode,
    style: safeParseJson(row.style, {}),
    enabled: !!row.enabled,
    expires_at: row.expires_at || null,
    click_count: row.click_count || 0,
    clicks_7d: row.clicks_7d ?? undefined,
    owner: row.created_by ? { id: row.created_by, username: row.owner_name || `#${row.created_by}` } : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    effective_status: linkStatus(row),
  };
}

function linkStatus(row) {
  if (!row.enabled) return 'disabled';
  if (row.expires_at && row.expires_at < Date.now()) return 'expired';
  return 'active';
}

const LINK_SELECT = `
  SELECT l.*, d.hostname AS domain_hostname, u.username AS owner_name,
    (SELECT COUNT(*) FROM logs g WHERE g.link_id = l.id AND g.ts >= ?) AS clicks_7d
  FROM links l
  JOIN domains d ON d.id = l.domain_id
  LEFT JOIN users u ON u.id = l.created_by`;

export function registerMainRoutes(r) {
  // ---------- links ----------

  r.get('/api/links', async (ctx) => {
    const q = ctx.query;
    const page = parseIntOr(q.get('page'), 1, { min: 1, max: 10000 });
    const perPage = parseIntOr(q.get('per'), 20, { min: 5, max: 100 });
    const weekAgo = Date.now() - 7 * 86400000;

    const where = [];
    const condParams = [];
    if (!isAdmin(ctx.user)) {
      where.push('l.created_by = ?');
      condParams.push(ctx.user.id);
    } else if (q.get('mine') === '1') {
      where.push('l.created_by = ?');
      condParams.push(ctx.user.id);
    }
    if (q.get('domain_id')) {
      where.push('l.domain_id = ?');
      condParams.push(Number(q.get('domain_id')));
    }
    if (q.get('owner_id')) {
      where.push('l.created_by = ?');
      condParams.push(Number(q.get('owner_id')));
    }
    const search = (q.get('q') || '').trim();
    if (search) {
      where.push('(l.code LIKE ? OR l.target LIKE ? OR l.note LIKE ?)');
      const like = `%${search.replace(/[%_]/g, (c) => '\\' + c)}%`;
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
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    const countRow = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM links l${whereSql}`).bind(...condParams).first();
    const { results } = await ctx.env.DB
      .prepare(`${LINK_SELECT}${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
      .bind(weekAgo, ...condParams, perPage, (page - 1) * perPage)
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
    if (!canCreateLinks(ctx.user)) throw new HttpError(403, 'forbidden', '该账户没有创建短链的权限');
    const body = await readJsonBody(ctx.req);

    const domainId = Number(body.domain_id);
    const domain = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first();
    if (!domain) throw new HttpError(400, 'invalid_domain', '请选择有效域名');
    if (domain.is_admin) throw new HttpError(400, 'invalid_domain', '管理域名不能用于短链');
    if (!canAccessDomain(ctx.user, domain.id)) throw new HttpError(403, 'forbidden', '没有该域名的使用权限');

    const target = normalizeTargetUrl(body.target);
    if (!target) throw new HttpError(400, 'invalid_target', '目标链接必须是有效的 http(s) URL');

    // quota
    if (!isAdmin(ctx.user) && ctx.user.quota_max_links > 0) {
      const row = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM links WHERE created_by = ?').bind(ctx.user.id).first();
      if (row.n >= ctx.user.quota_max_links) {
        throw new HttpError(403, 'quota_exceeded', `已达到短链数量上限（${ctx.user.quota_max_links} 条）`);
      }
    }

    const settings = await getSettings(ctx.env);
    const mode = MODES.has(body.mode) ? body.mode : settings.default_mode;
    const style = clampStyle(safeParseJson(body.style, {}), mode, settings.default_style);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
    const expiresAt = parseDateToMs(body.expires_at);

    const now = Date.now();
    let code;
    if (body.code && String(body.code).trim()) {
      code = String(body.code).trim();
      if (!isValidCode(code)) throw new HttpError(400, 'invalid_code', '后缀仅支持 1-64 位字母、数字、下划线和连字符');
      if (RESERVED_CODES.has(code)) throw new HttpError(400, 'invalid_code', '该后缀为保留字');
    } else {
      const len = parseIntOr(body.random_length, 6, { min: 4, max: 10 });
      for (let i = 0; i < 6; i++) {
        const candidate = randomCode(len);
        const exists = await ctx.env.DB
          .prepare('SELECT 1 FROM links WHERE domain_id = ? AND code = ?')
          .bind(domain.id, candidate)
          .first();
        if (!exists) {
          code = candidate;
          break;
        }
      }
      if (!code) throw new HttpError(500, 'code_collision', '随机后缀分配失败，请重试');
    }

    try {
      const res = await ctx.env.DB
        .prepare(
          'INSERT INTO links(domain_id, code, target, note, mode, style, enabled, expires_at, created_by, click_count, created_at, updated_at) VALUES(?,?,?,?,?,?,1,?,?,0,?,?)'
        )
        .bind(domain.id, code, target, note, mode, JSON.stringify(style), expiresAt, ctx.user.id, now, now)
        .run();
      const row = await fetchLinkRow(ctx.env, res.meta.last_row_id);
      return ok({ item: linkFromRow(row) }, { status: 201 });
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE')) {
        throw new HttpError(409, 'code_taken', '该后缀已被使用，请换一个');
      }
      throw e;
    }
  });

  r.patch('/api/links/:id', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row)) throw new HttpError(403, 'forbidden', '无权修改该短链');
    const body = await readJsonBody(ctx.req);
    const sets = [];
    const params = [];

    // resolve final code (for uniqueness checks when code and/or domain change)
    let finalCode = row.code;
    if (body.code !== undefined) {
      const code = String(body.code).trim();
      if (!isValidCode(code)) throw new HttpError(400, 'invalid_code', '后缀格式无效');
      if (RESERVED_CODES.has(code)) throw new HttpError(400, 'invalid_code', '该后缀为保留字');
      finalCode = code;
    }
    let finalDomainId = row.domain_id;
    if (body.domain_id !== undefined) {
      const domain = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(Number(body.domain_id)).first();
      if (!domain || domain.is_admin) throw new HttpError(400, 'invalid_domain', '无效的目标域名');
      if (!canAccessDomain(ctx.user, domain.id)) throw new HttpError(403, 'forbidden', '没有该域名的使用权限');
      finalDomainId = domain.id;
    }
    if (finalCode !== row.code || finalDomainId !== row.domain_id) {
      const exists = await ctx.env.DB
        .prepare('SELECT 1 FROM links WHERE domain_id = ? AND code = ? AND id != ?')
        .bind(finalDomainId, finalCode, row.id)
        .first();
      if (exists) throw new HttpError(409, 'code_taken', '该后缀在目标域名下已被使用');
    }

    if (body.target !== undefined) {
      const target = normalizeTargetUrl(body.target);
      if (!target) throw new HttpError(400, 'invalid_target', '目标链接必须是有效的 http(s) URL');
      sets.push('target = ?');
      params.push(target);
    }
    if (body.note !== undefined) {
      sets.push('note = ?');
      params.push(String(body.note).trim().slice(0, 200));
    }
    if (body.mode !== undefined) {
      if (!MODES.has(body.mode)) throw new HttpError(400, 'invalid_mode', '无效的跳转方式');
      sets.push('mode = ?');
      params.push(body.mode);
      if (body.style !== undefined) {
        sets.push('style = ?');
        params.push(JSON.stringify(clampStyle(safeParseJson(body.style, {}), body.mode)));
      }
    } else if (body.style !== undefined) {
      sets.push('style = ?');
      params.push(JSON.stringify(clampStyle(safeParseJson(body.style, {}), row.mode)));
    }
    if (body.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(body.enabled ? 1 : 0);
    }
    if (body.expires_at !== undefined) {
      sets.push('expires_at = ?');
      params.push(parseDateToMs(body.expires_at));
    }
    if (body.code !== undefined && finalCode !== row.code) {
      sets.push('code = ?');
      params.push(finalCode);
    }
    if (finalDomainId !== row.domain_id) {
      sets.push('domain_id = ?');
      params.push(finalDomainId);
    }
    if (!sets.length) return ok({ item: linkFromRow(row) });

    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(row.id);
    await ctx.env.DB.prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
    return ok({ item: linkFromRow(await fetchLinkRow(ctx.env, row.id)) });
  });

  r.delete('/api/links/:id', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row)) throw new HttpError(403, 'forbidden', '无权删除该短链');
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('DELETE FROM logs WHERE link_id = ?').bind(row.id),
      ctx.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(row.id),
    ]);
    return ok({});
  });

  r.get('/api/code-check', async (ctx) => {
    const domainId = Number(ctx.query.get('domain_id'));
    const code = (ctx.query.get('code') || '').trim();
    if (!isValidCode(code)) return ok({ available: false, reason: 'invalid' });
    if (RESERVED_CODES.has(code)) return ok({ available: false, reason: 'reserved' });
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
    const logs = await fetchLogs(ctx, 'link_id = ?', [row.id]);
    return ok({ link: { id: row.id, code: row.code, hostname: row.domain_hostname, url: linkUrl(row.domain_hostname, row.code) }, ...logs });
  });

  r.get('/api/links/:id/logs.csv', async (ctx) => {
    const row = await fetchLinkRow(ctx.env, ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', '短链不存在');
    if (!canManageLink(ctx.user, row) || !canViewLogs(ctx.user)) throw new HttpError(403, 'forbidden', '无权导出该记录');
    const { results } = await ctx.env.DB
      .prepare('SELECT ts, ip, country, city, ua, referer, status FROM logs WHERE link_id = ? ORDER BY ts DESC LIMIT 20000')
      .bind(row.id)
      .all();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['time,ip,country,city,user_agent,referer,status'];
    for (const g of results || []) {
      lines.push(
        [new Date(g.ts).toISOString(), g.ip, g.country, g.city, g.ua, g.referer, g.status].map(esc).join(',')
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
      const row = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(res.meta.last_row_id).first();
      return ok({ item: domainFromRow(row) }, { status: 201 });
    },
    { auth: 'admin' }
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
      const updated = await ctx.env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(row.id).first();
      return ok({ item: domainFromRow(updated) });
    },
    { auth: 'admin' }
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
      if (ctx.query.get('with_links') === '1') {
        const { results } = await ctx.env.DB.prepare('SELECT id FROM links WHERE domain_id = ?').bind(row.id).all();
        const ids = (results || []).map((l) => l.id);
        const stmts = [ctx.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(row.id)];
        if (ids.length) {
          stmts.push(
            ctx.env.DB.prepare(`DELETE FROM logs WHERE link_id IN (${ids.map(() => '?').join(',')})`).bind(...ids),
            ctx.env.DB.prepare(`DELETE FROM links WHERE domain_id = ?`).bind(row.id)
          );
        }
        await ctx.env.DB.batch(stmts);
        return ok({ deleted_links: ids.length });
      }
      await ctx.env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(row.id).run();
      return ok({ deleted_links: 0 });
    },
    { auth: 'admin' }
  );

  // ---------- global logs (admin) ----------

  r.get(
    '/api/logs',
    async (ctx) => {
      const logs = await fetchLogs(ctx, '1=1', [], { withLink: true });
      return ok(logs);
    },
    { auth: 'admin' }
  );

  // ---------- stats ----------

  r.get('/api/stats', async (ctx) => {
    const admin = isAdmin(ctx.user);
    const scopeLink = admin ? '' : ' AND l.created_by = ' + ctx.user.id;
    const scopeLog = admin ? '' : ' AND link_id IN (SELECT id FROM links WHERE created_by = ' + ctx.user.id + ')';
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [totals, today, week, month] = await Promise.all([
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM links l WHERE 1=1${scopeLink}`).first(),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM logs WHERE ts >= ?${scopeLog}`).bind(dayStart.getTime()).first(),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM logs WHERE ts >= ?${scopeLog}`).bind(now - 7 * 86400000).first(),
      ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM logs WHERE ts >= ?${scopeLog}`).bind(now - 30 * 86400000).first(),
    ]);

    const since14 = now - 14 * 86400000;
    const { results: seriesRows } = await ctx.env.DB
      .prepare(`SELECT CAST(ts / 86400000 AS INTEGER) AS day, COUNT(*) AS c FROM logs WHERE ts >= ?${scopeLog} GROUP BY day ORDER BY day`)
      .bind(since14)
      .all();
    const series = [];
    const countsByDay = new Map((seriesRows || []).map((r) => [r.day, r.c]));
    for (let i = 13; i >= 0; i--) {
      const t = now - i * 86400000;
      series.push({ day: Math.floor(t / 86400000), date: new Date(t).toISOString().slice(0, 10), count: countsByDay.get(Math.floor(t / 86400000)) || 0 });
    }

    const { results: topRows } = await ctx.env.DB
      .prepare(
        `SELECT l.id, l.code, l.click_count, d.hostname, COUNT(g.id) AS c7
         FROM logs g JOIN links l ON l.id = g.link_id JOIN domains d ON d.id = l.domain_id
         WHERE g.ts >= ?${admin ? '' : ' AND l.created_by = ' + ctx.user.id}
         GROUP BY l.id ORDER BY c7 DESC LIMIT 5`
      )
      .bind(now - 7 * 86400000)
      .all();

    const { results: recent } = await ctx.env.DB
      .prepare(
        `SELECT g.ts, g.ip, g.country, g.city, g.ua, l.code, l.id AS link_id, d.hostname
         FROM logs g JOIN links l ON l.id = g.link_id JOIN domains d ON d.id = l.domain_id
         WHERE 1=1${admin ? '' : ' AND l.created_by = ' + ctx.user.id}
         ORDER BY g.id DESC LIMIT 8`
      )
      .all();

    let users_n = 0;
    let domains_n = 0;
    if (admin) {
      const [u, d] = await Promise.all([
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
        ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM domains WHERE is_admin = 0').first(),
      ]);
      users_n = u.n;
      domains_n = d.n;
    }

    return ok({
      links_total: totals.n,
      clicks_today: today.n,
      clicks_7d: week.n,
      clicks_30d: month.n,
      series,
      top_links: (topRows || []).map((t) => ({ id: t.id, code: t.code, hostname: t.hostname, url: linkUrl(t.hostname, t.code), clicks_7d: t.c7, click_count: t.click_count })),
      recent: recent || [],
      users_total: users_n,
      domains_total: domains_n,
      scope: admin ? 'all' : 'own',
    });
  });
}

export async function fetchLinkRow(env, id) {
  const weekAgo = Date.now() - 7 * 86400000;
  return env.DB.prepare(`${LINK_SELECT} WHERE l.id = ?`).bind(weekAgo, Number(id)).first();
}

async function fetchLogs(ctx, whereSql, params, { withLink = false, } = {}) {
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
    const search = (q.get('q') || '').trim();
    if (search) {
      conditions.push('(l.code LIKE ? OR g.ip LIKE ? OR g.ua LIKE ?)');
      const like = `%${search.replace(/[%_]/g, (c) => '\\' + c)}%`;
      binds.push(like, like, like);
    }
  }
  const where = ' WHERE ' + conditions.join(' AND ');
  const from = withLink
    ? ' FROM logs g JOIN links l ON l.id = g.link_id JOIN domains d ON d.id = l.domain_id'
    : ' FROM logs g';

  const countRow = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n${from}${where}`).bind(...binds).first();
  const { results } = await ctx.env.DB
    .prepare(`SELECT g.*${withLink ? ', l.code, l.id AS link_id, d.hostname' : ''}${from}${where} ORDER BY g.id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, perPage, (page - 1) * perPage)
    .all();
  return { items: results || [], total: countRow?.n || 0, page, per_page: perPage };
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
