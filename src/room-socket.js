// WebSocket entry for chat rooms: validate access, build the member identity,
// push room config to the Durable Object, then forward the upgrade to it.

import { lookupDomain, hostOf } from './domains.js';
import { verifyPassword, ensureSignSecret, verifyValue } from './crypto.js';
import { resolveSessionUser } from './auth.js';
import { safeParseJson } from './util.js';

function deviceOf(ua) {
  ua = ua || '';
  let os = '其他';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  let br = '其他';
  if (/Edg\//.test(ua)) br = 'Edge';
  else if (/Firefox\//.test(ua)) br = 'Firefox';
  else if (/Chrome\//.test(ua)) br = 'Chrome';
  else if (/Safari\//.test(ua)) br = 'Safari';
  return `${os} · ${br}`;
}

export async function handleRoomSocket(req, env, ctx, url) {
  const bad = (status, msg) => new Response(msg, { status });
  if (req.headers.get('upgrade') !== 'websocket') return bad(426, 'expected websocket');
  const code = decodeURIComponent(url.pathname.slice('/_ws/'.length)).replace(/\/+$/, '');
  if (!code) return bad(404, 'not found');

  const domain = await lookupDomain(env, hostOf(req));
  if (!domain || domain.is_admin) return bad(404, 'not found');

  const row = await env.DB
    .prepare(
      `SELECT l.id, l.enabled, r.type, r.max_members, r.policy, r.access, r.destroyed_at
       FROM links l JOIN rooms r ON r.link_id = l.id
       WHERE l.domain_id = ? AND l.code = ? AND l.kind = 'room'`
    )
    .bind(domain.id, code)
    .first();
  if (!row) return bad(404, 'not found');
  if (row.destroyed_at || !row.enabled) return bad(410, 'closed');

  const access = safeParseJson(row.access, {});
  const policy = safeParseJson(row.policy, {});
  const q = url.searchParams;

  if (access.pw_hash) {
    const pw = q.get('pw') || '';
    if (!pw || !(await verifyPassword(pw, access.pw_hash))) return bad(401, 'password');
  }
  let session = null;
  if (access.login_required) {
    session = await resolveSessionUser(env, req, ctx);
    if (!session) return bad(403, 'login required');
  } else {
    session = await resolveSessionUser(env, req, ctx).catch(() => null);
  }

  const cf = req.cf || {};
  const nick = (q.get('nick') || '访客').slice(0, 24);
  const color = /^#[0-9a-fA-F]{6}$/.test(q.get('color') || '') ? q.get('color') : '#6b7cff';
  const member = {
    nick,
    color,
    device: deviceOf(req.headers.get('user-agent')),
    geo: [cf.country, cf.city].filter(Boolean).join(' · ') || '未知',
    ip: req.headers.get('cf-connecting-ip') || '',
    tz: (q.get('tz') || '').slice(0, 40),
    isOwner: !!(session && session.user && session.user.id === row.created_by),
  };
  // owner token issued by the console (works cross-domain)
  const ot = q.get('o');
  if (!member.isOwner && ot) {
    await ensureSignSecret(env);
    const payload = await verifyValue(ot);
    if (payload && payload.purpose === 'room-owner' && payload.r === row.id) member.isOwner = true;
  }

  const config = {
    type: row.type,
    max_members: row.max_members,
    retain: policy.retain || 0,
    disappear: policy.disappear || 0,
    hold: !!policy.hold,
    display: policy.display || { mode: 'motion' },
    visible: policy.visible || {},
    features: policy.features || {},
  };

  const stub = env.ROOM.get(env.ROOM.idFromName(`room:${row.id}`));
  await stub.fetch('https://room/config', { method: 'POST', body: JSON.stringify(config) });
  const wsUrl = `https://room/ws?m=${encodeURIComponent(JSON.stringify(member))}`;
  return stub.fetch(new Request(wsUrl, req));
}
