// Minimal path-pattern router. Patterns support ":param" segments.

export function createRouter() {
  const routes = [];

  function compile(pattern) {
    const segs = pattern.split('/').filter(Boolean);
    return { segs };
  }

  function matchPath(route, path) {
    const segs = path.split('/').filter(Boolean);
    const pattern = route.compiled.segs;
    if (segs.length !== pattern.length) return null;
    const params = {};
    for (let i = 0; i < segs.length; i++) {
      const rs = pattern[i];
      if (rs.startsWith(':')) {
        params[rs.slice(1)] = decodeURIComponent(segs[i]);
      } else if (rs !== segs[i]) {
        return null;
      }
    }
    return params;
  }

  function register(method, pattern, handler, opts = {}) {
    routes.push({ method: method.toUpperCase(), pattern, handler, opts, compiled: compile(pattern) });
  }

  return {
    get: (p, h, o) => register('GET', p, h, o),
    post: (p, h, o) => register('POST', p, h, o),
    put: (p, h, o) => register('PUT', p, h, o),
    patch: (p, h, o) => register('PATCH', p, h, o),
    delete: (p, h, o) => register('DELETE', p, h, o),
    match(method, path) {
      const m = method.toUpperCase();
      for (const r of routes) {
        if (r.method !== m && !(r.method === 'GET' && m === 'HEAD')) continue;
        const params = matchPath(r, path);
        if (params) return { route: r, params };
      }
      return null;
    },
  };
}
