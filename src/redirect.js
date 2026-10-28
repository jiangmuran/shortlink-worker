// Handles requests arriving on short-link domains: /{code} → redirect,
// interstitial or confirmation page, with access logging.

import { getSettings } from './auth.js';
import { renderPageRedirect, renderConfirmPage, renderStatusPage, renderLanding, renderNotePage, renderRoomPage } from './pages.js';
import { noteStatus } from './api-notes.js';
import { safeParseJson } from './util.js';

const ROBOTS = 'User-agent: *\nAllow: /\n';

export async function handleRedirect(req, env, ctx, domain) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (path === '/favicon.ico' || path === '/apple-touch-icon.png' || path === '/apple-touch-icon-precomposed.png') {
    return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=86400' } });
  }
  if (path.startsWith('/_sl/') && /^\/_sl\/[a-z0-9.-]+\.(js|css)$/.test(path)) {
    const asset = await env.ASSETS.fetch(new Request(new URL(path.slice(4), url.origin)));
    const res = new Response(asset.body, asset);
    res.headers.set('cache-control', 'public, max-age=300');
    return res;
  }
  if (path === '/robots.txt') {
    return new Response(ROBOTS, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const settings = await getSettings(env);
  const code = decodeURIComponent(path).replace(/^\/+|\/+$/g, '');

  if (!code || code.includes('/')) {
    // domain root (or nested path) → minimal landing, no console link
    return html(
      renderLanding({
        siteName: settings.site_name,
        hostname: domain.hostname,
        remark: domain.remark,
      })
    );
  }

  const link = await env.DB
    .prepare('SELECT * FROM links WHERE domain_id = ? AND code = ?')
    .bind(domain.id, code)
    .first();

  const log = (status) => {
    if (!link) return;
    ctx.waitUntil(writeLog(env, link.id, req, status));
  };

  if (!link) {
    return html(
      renderStatusPage({
        heading: '链接不存在',
        message: `没有找到 /${code} 对应的短链接，它可能已被删除或从未创建。`,
        siteName: settings.site_name,
        backUrl: '/',
      }),
      404
    );
  }

  if (link.kind === 'note') {
    return notePage(req, env, ctx, link, settings, domain);
  }
  if (link.kind === 'room') {
    const room = await env.DB.prepare('SELECT type, policy, access, destroyed_at FROM rooms WHERE link_id = ?').bind(link.id).first();
    const policy = safeParseJson(room?.policy, {});
    const data = {
      code: link.code,
      host: domain.hostname,
      site: settings.site_name,
      status: !room || room.destroyed_at ? 'destroyed' : link.enabled ? 'open' : 'closed',
      type: room?.type || 'group',
      theme: safeParseJson(room ? room.policy : '{}', {}).theme || { name: 'min' },
      needs_password: !!safeParseJson(room?.access, {}).pw_hash,
      login_required: !!safeParseJson(room?.access, {}).login_required,
      policy: { display: policy.display, disappear: policy.disappear, hold: policy.hold, hide_on_blur: policy.hide_on_blur, visible: policy.visible, features: policy.features, type: room?.type },
    };
    return new Response(renderRoomPage(data), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  if (!link.enabled) {
    log('disabled');
    return html(
      renderStatusPage({
        heading: '链接已停用',
        message: `/${link.code} 已被管理员停用。`,
        siteName: settings.site_name,
        backUrl: '/',
      }),
      410
    );
  }

  if (link.expires_at && link.expires_at < Date.now()) {
    log('expired');
    return html(
      renderStatusPage({
        heading: '链接已过期',
        message: `/${link.code} 已于 ${new Date(link.expires_at).toLocaleString('zh-CN')} 过期。`,
        siteName: settings.site_name,
        backUrl: '/',
      }),
      410
    );
  }

  log('hit');
  ctx.waitUntil(env.DB.prepare('UPDATE links SET click_count = click_count + 1 WHERE id = ?').bind(link.id).run());

  const style = safeParseJson(link.style, {});
  if (link.mode === 'page') {
    return html(
      renderPageRedirect({
        target: link.target,
        style,
        siteName: settings.site_name,
        backUrl: '/',
      })
    );
  }
  if (link.mode === 'confirm') {
    return html(
      renderConfirmPage({
        target: link.target,
        style,
        siteName: settings.site_name,
        backUrl: '/',
      })
    );
  }
  return new Response(null, {
    status: 302,
    headers: { location: link.target, 'cache-control': 'no-store, max-age=0' },
  });
}

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|line\/|vkshare|pinterest|quora|redditbot|bingpreview|googleother|curl|wget|python|okhttp|go-http|java\/|headless/i;

async function notePage(req, env, ctx, link, settings, domain) {
  const note = await env.DB.prepare('SELECT * FROM notes WHERE link_id = ?').bind(link.id).first();
  if (!note) {
    return html(renderStatusPage({ heading: '链接不存在', message: '没有找到这封密信。', siteName: settings.site_name, backUrl: '/' }), 404);
  }
  const status = noteStatus({ ...note, enabled: link.enabled, expires_at: link.expires_at });
  const ua = req.headers.get('user-agent') || '';
  ctx.waitUntil(writeLog(env, link.id, req, 'view'));
  const data = {
    code: link.code,
    host: domain.hostname,
    site: settings.site_name,
    status,
    burn_reason: note.burn_reason || null,
    enc: note.enc,
    meta: safeParseJson(note.meta, {}),
    theme: safeParseJson(note.theme, {}),
    display: safeParseJson(note.display, {}),
    max_opens: note.max_opens,
    opens: note.opens,
    open_ttl: note.open_ttl || null,
    first_open_at: note.first_open_at || null,
    expires_at: link.expires_at || null,
    needs_password: !!note.pw_hash,
    unlock_at: note.unlock_at || null,
    attempts_left: note.pw_hash && note.pw_max_fail > 0 ? Math.max(0, note.pw_max_fail - note.pw_fail) : null,
    is_bot: BOT_UA.test(ua),
  };
  return new Response(renderNotePage(data), {
    status: status === 'burned' || status === 'expired' ? 410 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function writeLog(env, linkId, req, status) {
  const cf = req.cf || {};
  try {
    await env.DB
      .prepare('INSERT INTO logs(link_id, ts, ip, country, city, ua, referer, status) VALUES(?,?,?,?,?,?,?,?)')
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
      .run();
  } catch (e) {
    console.error('log write failed', e);
  }
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
