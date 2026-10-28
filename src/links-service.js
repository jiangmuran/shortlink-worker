// Short-code lifecycle shared by the console API, /api/v1 and notes:
// capability checks, quotas, code allocation, and the list/detail query.

import { capsOf, canAccessDomain, canCreateLinks, getSettings, isAdmin } from './auth.js';
import { consumeCreation } from './usage.js';
import { HttpError, isValidCode, randomCode, safeParseJson, linkUrl, normalizeTargetUrl, clampStyle, parseDateToMs } from './util.js';

export const RESERVED_CODES = new Set(['favicon.ico', 'robots.txt', 'index.html', 'apple-touch-icon.png', '_sl']);
export const MODES = new Set(['direct', 'page', 'confirm']);
const DAY = 86400000;

// clicks_7d = rolled-up days + raw logs newer than the rollup watermark
const LINK_SELECT = `
  SELECT l.*, d.hostname AS domain_hostname, u.username AS owner_name,
    (SELECT COALESCE(SUM(clicks), 0) FROM link_daily x WHERE x.link_id = l.id AND x.day >= ?)
      + (SELECT COUNT(*) FROM logs g WHERE g.link_id = l.id AND g.ts >= ? AND g.status IN ('hit', 'opened')) AS clicks_7d
  FROM links l
  JOIN domains d ON d.id = l.domain_id
  LEFT JOIN users u ON u.id = l.created_by`;

export async function linkSelect(env) {
  const settings = await getSettings(env);
  const fromDay = Math.floor(Date.now() / DAY) - 6;
  const watermark = Math.max(settings.rollup_until, Date.now() - 7 * DAY);
  return { sql: LINK_SELECT, binds: [fromDay, watermark] };
}

export async function fetchLinkRow(env, id) {
  const { sql, binds } = await linkSelect(env);
  return env.DB.prepare(`${sql} WHERE l.id = ?`).bind(...binds, Number(id)).first();
}

export function linkStatus(row) {
  if (!row.enabled) return 'disabled';
  if (row.expires_at && row.expires_at < Date.now()) return 'expired';
  return 'active';
}

export function linkFromRow(row) {
  return {
    id: row.id,
    kind: row.kind || 'link',
    code: row.code,
    domain: { id: row.domain_id, hostname: row.domain_hostname },
    url: linkUrl(row.domain_hostname, row.code),
    target: row.target,
    note: row.note || '',
    mode: row.mode,
    style: safeParseJson(row.style, {}),
    enabled: !!row.enabled,
    frozen: !!row.frozen,
    expires_at: row.expires_at || null,
    click_count: row.click_count || 0,
    clicks_7d: row.clicks_7d ?? undefined,
    owner: row.created_by ? { id: row.created_by, username: row.owner_name || `#${row.created_by}` } : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    effective_status: linkStatus(row),
  };
}

export async function resolveUsableDomain(env, user, domainId) {
  const domain = await env.DB.prepare('SELECT * FROM domains WHERE id = ?').bind(Number(domainId)).first();
  if (!domain) throw new HttpError(400, 'invalid_domain', '请选择有效域名');
  if (domain.is_admin) throw new HttpError(400, 'invalid_domain', '管理域名不能用于短链');
  if (!canAccessDomain(user, domain.id)) throw new HttpError(403, 'forbidden', '没有该域名的使用权限');
  return domain;
}

async function allocateCode(env, user, domainId, { code, randomLength }) {
  const caps = capsOf(user).links;
  if (code !== undefined && code !== null && String(code).trim()) {
    const c = String(code).trim();
    if (!caps.custom_code) throw new HttpError(403, 'custom_code_forbidden', '当前账户只能使用随机后缀');
    if (!isValidCode(c)) throw new HttpError(400, 'invalid_code', '后缀仅支持 1-64 位字母、数字、下划线和连字符');
    if (c.length < caps.min_code_len) throw new HttpError(400, 'code_too_short', `后缀至少需要 ${caps.min_code_len} 位`);
    if (RESERVED_CODES.has(c)) throw new HttpError(400, 'invalid_code', '该后缀为保留字');
    return c;
  }
  const len = Math.max(caps.min_code_len, Math.min(10, Math.max(4, Number(randomLength) || 6)));
  for (let i = 0; i < 6; i++) {
    const candidate = randomCode(len);
    const exists = await env.DB.prepare('SELECT 1 FROM links WHERE domain_id = ? AND code = ?').bind(domainId, candidate).first();
    if (!exists) return candidate;
  }
  throw new HttpError(500, 'code_collision', '随机后缀分配失败，请重试');
}

export function allowedMode(user, mode, fallback) {
  const modes = capsOf(user).links.modes;
  if (!modes.length) throw new HttpError(403, 'forbidden', '当前账户没有可用的跳转方式');
  const wanted = MODES.has(mode) ? mode : fallback;
  if (modes.includes(wanted)) return wanted;
  if (mode && MODES.has(mode)) throw new HttpError(403, 'mode_forbidden', `当前账户不能使用该跳转方式`);
  return modes[0];
}

async function assertLinkQuota(env, user) {
  if (isAdmin(user)) return;
  const max = capsOf(user).links.max;
  if (max > 0) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM links WHERE kind = 'link' AND created_by = ?").bind(user.id).first();
    if (row.n >= max) throw new HttpError(403, 'quota_exceeded', `已达到短链数量上限（${max} 条）`);
  }
}

// input: { domain (row), target, code, randomLength, note, mode, style, expiresAt }
export async function createLink(env, user, input) {
  if (!canCreateLinks(user)) throw new HttpError(403, 'forbidden', '该账户没有创建短链的权限');
  const target = normalizeTargetUrl(input.target);
  if (!target) throw new HttpError(400, 'invalid_target', '目标链接必须是有效的 http(s) URL');
  await assertLinkQuota(env, user);
  const settings = await getSettings(env);
  const domainDefaults = safeParseJson(input.domain.defaults, {});
  const mode = allowedMode(user, input.mode, domainDefaults.mode || settings.default_mode);
  const style = clampStyle(safeParseJson(input.style, {}), mode, settings.default_style);
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  const expiresAt = parseDateToMs(input.expiresAt);
  const code = await allocateCode(env, user, input.domain.id, { code: input.code, randomLength: input.randomLength });
  await consumeCreation(env, user, 'links');
  const now = Date.now();
  try {
    const res = await env.DB
      .prepare(
        "INSERT INTO links(domain_id, code, target, note, mode, style, enabled, expires_at, created_by, click_count, created_at, updated_at, kind) VALUES(?,?,?,?,?,?,1,?,?,0,?,?,'link')"
      )
      .bind(input.domain.id, code, target, note, mode, JSON.stringify(style), expiresAt, user.id, now, now)
      .run();
    return fetchLinkRow(env, res.meta.last_row_id);
  } catch (e) {
    if (String(e?.message || '').includes('UNIQUE')) throw new HttpError(409, 'code_taken', '该后缀已被使用，请换一个');
    throw e;
  }
}

// Create the short code that carries a note or room (no redirect target).
export async function createCodeFor(env, user, kind, { domain, code, randomLength, note, expiresAt }) {
  const finalCode = await allocateCode(env, user, domain.id, { code, randomLength });
  const now = Date.now();
  try {
    const res = await env.DB
      .prepare(
        "INSERT INTO links(domain_id, code, target, note, mode, style, enabled, expires_at, created_by, click_count, created_at, updated_at, kind) VALUES(?,?,'',?,'direct','{}',1,?,?,0,?,?,?)"
      )
      .bind(domain.id, finalCode, (note || '').slice(0, 200), expiresAt || null, user.id, now, now, kind)
      .run();
    return res.meta.last_row_id;
  } catch (e) {
    if (String(e?.message || '').includes('UNIQUE')) throw new HttpError(409, 'code_taken', '该后缀已被使用，请换一个');
    throw e;
  }
}

// patch: { target, note, mode, style, enabled, expiresAt, code, domainId } (undefined = unchanged)
export async function updateLink(env, user, row, patch) {
  const caps = capsOf(user).links;
  const sets = [];
  const params = [];

  let finalCode = row.code;
  if (patch.code !== undefined && String(patch.code).trim() !== row.code) {
    const c = String(patch.code).trim();
    if (!caps.custom_code) throw new HttpError(403, 'custom_code_forbidden', '当前账户只能使用随机后缀');
    if (!isValidCode(c)) throw new HttpError(400, 'invalid_code', '后缀格式无效');
    if (c.length < caps.min_code_len) throw new HttpError(400, 'code_too_short', `后缀至少需要 ${caps.min_code_len} 位`);
    if (RESERVED_CODES.has(c)) throw new HttpError(400, 'invalid_code', '该后缀为保留字');
    finalCode = c;
  }
  let finalDomainId = row.domain_id;
  if (patch.domainId !== undefined && Number(patch.domainId) !== row.domain_id) {
    finalDomainId = (await resolveUsableDomain(env, user, patch.domainId)).id;
  }
  if (finalCode !== row.code || finalDomainId !== row.domain_id) {
    const exists = await env.DB
      .prepare('SELECT 1 FROM links WHERE domain_id = ? AND code = ? AND id != ?')
      .bind(finalDomainId, finalCode, row.id)
      .first();
    if (exists) throw new HttpError(409, 'code_taken', '该后缀在目标域名下已被使用');
    if (finalCode !== row.code) {
      sets.push('code = ?');
      params.push(finalCode);
    }
    if (finalDomainId !== row.domain_id) {
      sets.push('domain_id = ?');
      params.push(finalDomainId);
    }
  }

  if (patch.target !== undefined && row.kind === 'link') {
    const target = normalizeTargetUrl(patch.target);
    if (!target) throw new HttpError(400, 'invalid_target', '目标链接必须是有效的 http(s) URL');
    if (target !== row.target) {
      if (!caps.edit_target) throw new HttpError(403, 'edit_target_forbidden', '当前账户创建后不能修改目标链接');
      sets.push('target = ?');
      params.push(target);
    }
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    params.push(String(patch.note).trim().slice(0, 200));
  }
  const mode = patch.mode !== undefined && row.kind === 'link' ? allowedMode(user, patch.mode, row.mode) : row.mode;
  if (mode !== row.mode) {
    sets.push('mode = ?');
    params.push(mode);
  }
  if (patch.style !== undefined && row.kind === 'link') {
    sets.push('style = ?');
    params.push(JSON.stringify(clampStyle(safeParseJson(patch.style, {}), mode)));
  }
  if (patch.enabled !== undefined) {
    if (row.frozen && patch.enabled) throw new HttpError(403, 'frozen', '该内容所属账户已被冻结');
    sets.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.expiresAt !== undefined) {
    sets.push('expires_at = ?');
    params.push(parseDateToMs(patch.expiresAt));
  }
  if (!sets.length) return row;
  sets.push('updated_at = ?');
  params.push(Date.now(), row.id);
  await env.DB.prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  return fetchLinkRow(env, row.id);
}

export async function deleteLinkCascade(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM logs WHERE link_id = ?').bind(id),
    env.DB.prepare('DELETE FROM link_daily WHERE link_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notes WHERE link_id = ?').bind(id),
    env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id),
  ]);
}
