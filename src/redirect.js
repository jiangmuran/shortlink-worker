// Handles requests arriving on short-link domains: /{code} → redirect,
// interstitial or confirmation page, with access logging.

import { getSettings } from './auth.js';
import { renderPageRedirect, renderConfirmPage, renderStatusPage, renderLanding } from './pages.js';
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
