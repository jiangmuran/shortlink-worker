// Hostname → domain row, with a tiny per-isolate TTL cache (hot redirect path).

const domainCache = new Map();
const DOMAIN_CACHE_TTL = 10_000;

export async function lookupDomain(env, hostname) {
  const hit = domainCache.get(hostname);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = await env.DB.prepare('SELECT * FROM domains WHERE hostname = ?').bind(hostname).first();
  if (domainCache.size > 500) domainCache.clear();
  domainCache.set(hostname, { value: row || null, expires: Date.now() + DOMAIN_CACHE_TTL });
  return row || null;
}

export function invalidateDomains() {
  domainCache.clear();
}

export function hostOf(req) {
  const h = req.headers.get('host') || new URL(req.url).hostname;
  return h.split(':')[0].toLowerCase();
}
