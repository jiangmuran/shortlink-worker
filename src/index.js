// ShortLink — a self-hosted short link service for Cloudflare Workers.
// One worker serves everything: the management SPA (static assets), the JSON
// API, the public /api/v1 REST API, redirect/interstitial pages on bound
// short-link domains, and the scheduled cleanup job.

import { createRouter } from './router.js';
import { registerAuthRoutes } from './api-auth.js';
import { registerMainRoutes } from './api-main.js';
import { registerAdminRoutes } from './api-admin.js';
import { registerV1Routes } from './api-v1.js';
import { resolveSessionUser, resolveApiKey, isAdmin, adminPerm, effectiveScopes } from './auth.js';
import { registerNoteRoutes } from './api-notes.js';
import { lookupDomain, hostOf } from './domains.js';
import { handleRedirect } from './redirect.js';
import { runMaintenance } from './cleanup.js';
import { ok, fail, HttpError } from './util.js';

const api = createRouter();
registerAuthRoutes(api);
registerMainRoutes(api);
registerAdminRoutes(api);
registerV1Routes(api);
registerNoteRoutes(api);

api.get('/api/health', () => ok({ status: 'ok', time: Date.now() }), { auth: 'none' });

// ---------- entry ----------

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);

      // force HTTPS on all public hostnames (localhost + DEV_MODE stay http)
      const host = url.hostname;
      if (
        url.protocol === 'http:' &&
        !env.DEV_MODE &&
        !host.endsWith('.localhost') &&
        host !== 'localhost' &&
        host !== '127.0.0.1'
      ) {
        return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, 308);
      }

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return await handleApi(req, env, ctx, url);
      }

      const domain = await lookupDomain(env, host);
      if (domain && !domain.is_admin) {
        return handleRedirect(req, env, ctx, domain);
      }
      // admin domains (and any not-yet-registered host) serve the console
      return serveConsole(req, env, url);
    } catch (err) {
      console.error(err);
      return fail(err);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runMaintenance(env).then(
        (r) => console.log('cleanup', JSON.stringify(r)),
        (e) => console.error('cleanup failed', e)
      )
    );
  },
};

// ---------- console (SPA + static assets) ----------

async function serveConsole(req, env, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  let res = await env.ASSETS.fetch(req);
  if (res.status >= 400) {
    // client-side routing fallback
    res = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), { method: 'GET' }));
  }
  return res;
}

// ---------- API dispatcher ----------

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

function withCors(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v);
  return out;
}

const PASSWORD_GATE_ALLOW = new Set(['GET /api/me', 'POST /api/me/password', 'POST /api/auth/logout', 'GET /api/bootstrap']);

async function handleApi(req, env, ctx, url) {
  const path = url.pathname;
  const isV1 = path.startsWith('/api/v1');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const matched = api.match(req.method, path);
  if (!matched) {
    return finish(new HttpError(404, 'not_found', '接口不存在'), isV1);
  }
  const { route, params } = matched;

  try {
    const c = { req, env, ctx, params, query: url.searchParams, user: null, key: null, sessionId: null };

    if (route.opts.auth !== 'none') {
      const session = await resolveSessionUser(env, req, ctx);
      if (session) {
        if (route.opts.auth === 'admin' && !isAdmin(session.user)) {
          throw new HttpError(403, 'forbidden', '需要管理员权限');
        }
        if (route.opts.perm && !adminPerm(session.user, route.opts.perm)) {
          throw new HttpError(403, 'forbidden', '你的管理员账户没有这项权限');
        }
        c.user = session.user;
        c.sessionId = session.sessionId;
        if (session.user.must_change_password && !PASSWORD_GATE_ALLOW.has(`${req.method} ${path}`)) {
          throw new HttpError(403, 'password_change_required', '请先修改初始密码');
        }
        // cross-site protection for cookie-authenticated mutations
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const origin = req.headers.get('origin');
          if (origin) {
            let originHost = null;
            try {
              originHost = new URL(origin).hostname.toLowerCase();
            } catch {}
            const host = hostOf(req);
            if (originHost && originHost !== host) {
              const bound = await lookupDomain(env, originHost);
              if (!bound || !bound.is_admin) {
                throw new HttpError(403, 'bad_origin', '跨站请求被拒绝');
              }
            }
          }
        }
      } else {
        const keyAuth = await resolveApiKey(env, req, ctx);
        if (keyAuth) {
          if (route.opts.auth !== 'key') {
            throw new HttpError(401, 'unauthorized', '此接口不支持 API 密钥，请使用 /api/v1');
          }
          const scopes = effectiveScopes(keyAuth.user, keyAuth.key);
          keyAuth.key._scopes = scopes;
          if (route.opts.scope && !scopes.includes(route.opts.scope)) {
            throw new HttpError(403, 'insufficient_scope', `该密钥缺少 ${route.opts.scope} 权限`);
          }
          c.user = keyAuth.user;
          c.key = keyAuth.key;
        } else {
          throw new HttpError(401, 'unauthorized', '请先登录');
        }
      }
    }

    const res = await route.handler(c);
    return isV1 ? withCors(res) : res;
  } catch (err) {
    return finish(err, isV1);
  }
}

function finish(err, isV1) {
  const res = fail(err);
  return isV1 ? withCors(res) : res;
}
