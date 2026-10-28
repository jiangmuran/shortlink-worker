// Chat rooms.
//   Console: /api/rooms (list, create, destroy, delete) — session auth.
//   Public:  /api/room/:code/meta — join-page info, host-aware, no auth.
// The live WebSocket (/_ws/:code) is handled in index.js and talks to the
// ChatRoom Durable Object. Rooms are always end-to-end encrypted: the room key
// lives only in the invite link's # fragment, so the server relays ciphertext.

import { capsOf, canSeeAll, isAdmin, getSettings } from './auth.js';
import { createCodeFor, resolveUsableDomain, linkFromRow, fetchLinkRow, deleteLinkCascade } from './links-service.js';
import { lookupDomain, hostOf } from './domains.js';
import { hashPassword } from './crypto.js';
import { audit } from './audit.js';
import { ok, HttpError, readJsonBody, parseIntOr, safeParseJson } from './util.js';
import { NOTE_THEMES, sanitizeDisplay, sanitizeTheme } from './api-notes.js';

export const ROOM_TYPES = ['dm', 'group', 'burn'];

function sanitizePolicy(raw, caps) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const vis = p.visible && typeof p.visible === 'object' ? p.visible : {};
  return {
    retain: parseIntOr(p.retain, 0, { min: 0, max: 500 }),
    disappear: parseIntOr(p.disappear, 0, { min: 0, max: 86400 }),
    hold: !!p.hold,
    hide_on_blur: !!p.hide_on_blur,
    display: sanitizeDisplay(p.display),
    theme: sanitizeTheme(p.theme),
    visible: { device: !!vis.device, geo: !!vis.geo, ip: caps.logs.ip === 'full' ? !!vis.ip : false, local_time: !!vis.local_time, typing: vis.typing !== false, read: !!vis.read },
    features: { image: p.features?.image !== false },
  };
}

function roomFromRow(link, room) {
  return {
    ...linkFromRow(link),
    label: link.note || '',
    type: room.type,
    max_members: room.max_members,
    policy: safeParseJson(room.policy, {}),
    needs_password: !!safeParseJson(room.access, {}).pw_hash,
    destroyed_at: room.destroyed_at || null,
    room_status: room.destroyed_at ? 'destroyed' : link.enabled ? 'open' : 'closed',
  };
}

const ROOM_SELECT = `SELECT l.*, d.hostname AS domain_hostname, u.username AS owner_name,
  r.type, r.max_members, r.policy, r.access, r.destroyed_at
  FROM links l JOIN domains d ON d.id = l.domain_id JOIN rooms r ON r.link_id = l.id
  LEFT JOIN users u ON u.id = l.created_by WHERE l.kind = 'room'`;

async function fetchRoom(env, id) {
  return env.DB.prepare(`${ROOM_SELECT} AND l.id = ?`).bind(Number(id)).first();
}

export function registerChatRoutes(r) {
  r.get('/api/rooms', async (ctx) => {
    const where = canSeeAll(ctx.user) ? '' : ' AND l.created_by = ?';
    const binds = canSeeAll(ctx.user) ? [] : [ctx.user.id];
    const { results } = await ctx.env.DB.prepare(`${ROOM_SELECT}${where} ORDER BY l.created_at DESC LIMIT 200`).bind(...binds).all();
    return ok({ items: (results || []).map((row) => roomFromRow(row, row)) });
  });

  r.get('/api/rooms/:id', async (ctx) => {
    const row = await fetchRoom(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '聊天室不存在');
    return ok({ item: roomFromRow(row, row) });
  });

  r.post('/api/rooms', async (ctx) => {
    const caps = capsOf(ctx.user).rooms;
    if (!caps.create) throw new HttpError(403, 'forbidden', '该账户没有创建聊天室的权限');
    const body = await readJsonBody(ctx.req);
    const domain = await resolveUsableDomain(ctx.env, ctx.user, body.domain_id);
    const type = ROOM_TYPES.includes(body.type) ? body.type : 'group';

    if (!isAdmin(ctx.user) && caps.max > 0) {
      const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM links l JOIN rooms r ON r.link_id = l.id WHERE l.created_by = ? AND l.kind = 'room' AND r.destroyed_at IS NULL").bind(ctx.user.id).first();
      if (n.n >= caps.max) throw new HttpError(403, 'quota_exceeded', `进行中的聊天室已达上限（${caps.max} 个）`);
    }

    let maxMembers = parseIntOr(body.max_members, type === 'dm' ? 2 : 20, { min: 2, max: 1000 });
    if (type === 'dm') maxMembers = 2;
    if (caps.max_members > 0) maxMembers = Math.min(maxMembers, caps.max_members);
    const policy = sanitizePolicy(body.policy, capsOf(ctx.user));
    if (type === 'burn') policy.retain = 0; // burn rooms never store messages
    const password = typeof body.password === 'string' && body.password ? body.password.slice(0, 200) : null;
    const access = { login_required: !!body.login_required };
    if (password) access.pw_hash = await hashPassword(password);

    const linkId = await createCodeFor(ctx.env, ctx.user, 'room', {
      domain,
      code: body.code,
      randomLength: body.random_length || 8,
      note: typeof body.label === 'string' ? body.label.trim() : '',
    });
    try {
      await ctx.env.DB.prepare('INSERT INTO rooms(link_id, type, max_members, policy, access) VALUES(?,?,?,?,?)')
        .bind(linkId, type, maxMembers, JSON.stringify(policy), JSON.stringify(access))
        .run();
    } catch (e) {
      await deleteLinkCascade(ctx.env, linkId);
      throw e;
    }
    audit(ctx, 'room.create', { type: 'room', id: linkId, detail: `${domain.hostname} · ${type}` });
    const row = await fetchRoom(ctx.env, linkId);
    return ok({ item: roomFromRow(row, row) }, { status: 201 });
  });

  r.post('/api/rooms/:id/destroy', async (ctx) => {
    const row = await fetchRoom(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '聊天室不存在');
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE rooms SET destroyed_at = ? WHERE link_id = ?').bind(Date.now(), row.id),
      ctx.env.DB.prepare('UPDATE links SET enabled = 0 WHERE id = ?').bind(row.id),
    ]);
    try {
      const stub = ctx.env.ROOM.get(ctx.env.ROOM.idFromName(`room:${row.id}`));
      await stub.fetch('https://room/destroy', { method: 'POST' });
    } catch (e) {
      console.error('room destroy', e);
    }
    if (row.created_by !== ctx.user.id) audit(ctx, 'room.destroy', { type: 'room', id: row.id, detail: `${row.domain_hostname}/${row.code}` });
    return ok({});
  });

  r.delete('/api/rooms/:id', async (ctx) => {
    const row = await fetchRoom(ctx.env, ctx.params.id);
    if (!row || (!canSeeAll(ctx.user) && row.created_by !== ctx.user.id)) throw new HttpError(404, 'not_found', '聊天室不存在');
    try {
      const stub = ctx.env.ROOM.get(ctx.env.ROOM.idFromName(`room:${row.id}`));
      await stub.fetch('https://room/destroy', { method: 'POST' });
    } catch {}
    await ctx.env.DB.batch([
      ctx.env.DB.prepare('DELETE FROM rooms WHERE link_id = ?').bind(row.id),
      ...[], // link + logs below
    ]);
    await deleteLinkCascade(ctx.env, row.id);
    return ok({});
  });

  // ---------- public join-page meta ----------
  r.get(
    '/api/room/:code/meta',
    async (ctx) => {
      const domain = await lookupDomain(ctx.env, hostOf(ctx.req));
      if (!domain || domain.is_admin) throw new HttpError(404, 'not_found', '聊天室不存在');
      const row = await ctx.env.DB.prepare(`${ROOM_SELECT} AND l.domain_id = ? AND l.code = ?`).bind(domain.id, ctx.params.code).first();
      if (!row) throw new HttpError(404, 'not_found', '聊天室不存在');
      const settings = await getSettings(ctx.env);
      const policy = safeParseJson(row.policy, {});
      const access = safeParseJson(row.access, {});
      const live = await roomCount(ctx.env, row.id);
      return ok({
        site: settings.site_name,
        code: row.code,
        label: policy.title || '',
        type: row.type,
        status: row.destroyed_at ? 'destroyed' : row.enabled ? 'open' : 'closed',
        max_members: row.max_members,
        online: live,
        theme: safeParseJson(row.theme || JSON.stringify(policy.theme || {}), policy.theme || {}),
        policy: { display: policy.display, disappear: policy.disappear, hold: policy.hold, visible: policy.visible, type: row.type },
        needs_password: !!access.pw_hash,
        login_required: !!access.login_required,
      });
    },
    { auth: 'none' }
  );
}

export async function roomCount(env, linkId) {
  try {
    const stub = env.ROOM.get(env.ROOM.idFromName(`room:${linkId}`));
    const r = await stub.fetch('https://room/info');
    const j = await r.json();
    return j.count || 0;
  } catch {
    return 0;
  }
}

export { fetchRoom, sanitizePolicy };
