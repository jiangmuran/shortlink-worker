// Capability model. Every non-admin user belongs to a group whose `caps` JSON
// says what they may do; `users.caps_override` tweaks individual users on top.
// Admins (role = 'admin') get FULL_CAPS; what they may *administer* is a
// separate set of admin permissions (see auth.js#adminPerm).
//
// Numeric limits use 0 for "unlimited".

export const ALL_SCOPES = ['links:read', 'links:write', 'logs:read', 'domains:read', 'notes:read', 'notes:write'];
export const LINK_MODES = ['direct', 'page', 'confirm'];
export const ADMIN_PERMS = ['users', 'domains', 'settings', 'content'];

// field → [type, ...args]
const SCHEMA = {
  links: {
    create: ['bool'],
    max: ['int', 0, 1_000_000],
    daily: ['int', 0, 100_000],
    custom_code: ['bool'],
    min_code_len: ['int', 1, 10],
    modes: ['list', LINK_MODES],
    edit_target: ['bool'],
  },
  notes: {
    create: ['bool'],
    max_active: ['int', 0, 1_000_000],
    daily: ['int', 0, 100_000],
    e2e: ['bool'],
    max_opens: ['int', 0, 10_000],
    max_ttl_hours: ['int', 0, 87_600],
    max_kb: ['int', 1, 64],
  },
  logs: {
    view: ['bool'],
    ip: ['enum', ['full', 'masked', 'none']],
    export: ['bool'],
  },
  api: {
    use: ['bool'],
    scopes: ['list', ALL_SCOPES],
  },
  rate: {
    per_minute: ['int', 0, 10_000],
  },
};

export const FULL_CAPS = {
  links: { create: true, max: 0, daily: 0, custom_code: true, min_code_len: 1, modes: [...LINK_MODES], edit_target: true },
  notes: { create: true, max_active: 0, daily: 0, e2e: true, max_opens: 0, max_ttl_hours: 0, max_kb: 64 },
  logs: { view: true, ip: 'full', export: true },
  api: { use: true, scopes: [...ALL_SCOPES] },
  rate: { per_minute: 0 },
};

// Used when a regular user has no group (should not happen after migration 0002).
export const FALLBACK_CAPS = {
  links: { create: true, max: 100, daily: 0, custom_code: true, min_code_len: 5, modes: [...LINK_MODES], edit_target: true },
  notes: { create: true, max_active: 50, daily: 0, e2e: true, max_opens: 0, max_ttl_hours: 0, max_kb: 64 },
  logs: { view: true, ip: 'full', export: true },
  api: { use: true, scopes: ['links:read', 'links:write', 'domains:read'] },
  rate: { per_minute: 30 },
};

function coerce(spec, v) {
  const [type, a, b] = spec;
  switch (type) {
    case 'bool':
      return typeof v === 'boolean' ? v : v === 1 || v === 0 ? !!v : undefined;
    case 'int': {
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(b, Math.max(a, Math.round(n)));
    }
    case 'enum':
      return a.includes(v) ? v : undefined;
    case 'list':
      return Array.isArray(v) ? [...new Set(v.filter((x) => a.includes(x)))] : undefined;
  }
  return undefined;
}

// Validate a caps object. `partial` keeps only provided keys (for overrides);
// otherwise missing keys are filled from `base`.
export function normalizeCaps(raw, { partial = false, base = FALLBACK_CAPS } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [section, fields] of Object.entries(SCHEMA)) {
    const s = src[section] && typeof src[section] === 'object' ? src[section] : {};
    const sec = {};
    for (const [field, spec] of Object.entries(fields)) {
      const v = coerce(spec, s[field]);
      if (v !== undefined) sec[field] = v;
      else if (!partial) sec[field] = clone(base[section][field]);
    }
    if (!partial || Object.keys(sec).length) out[section] = sec;
  }
  return out;
}

export function mergeCaps(base, override) {
  const out = {};
  for (const section of Object.keys(SCHEMA)) {
    out[section] = { ...clone(base[section] || {}), ...clone((override || {})[section] || {}) };
  }
  return out;
}

// Keep only the override entries that actually differ from the group's caps.
export function diffCaps(groupCaps, wanted) {
  const out = {};
  for (const [section, fields] of Object.entries(wanted || {})) {
    for (const [field, v] of Object.entries(fields || {})) {
      if (JSON.stringify(v) !== JSON.stringify(groupCaps?.[section]?.[field])) {
        (out[section] ||= {})[field] = v;
      }
    }
  }
  return out;
}

function clone(v) {
  return Array.isArray(v) ? [...v] : v && typeof v === 'object' ? { ...v } : v;
}

export function maskIp(ip) {
  if (!ip) return ip;
  if (ip.includes('.')) {
    const p = ip.split('.');
    return p.length === 4 ? `${p[0]}.${p[1]}.*.*` : '*';
  }
  const p = ip.split(':').filter(Boolean);
  return p.length ? `${p.slice(0, 2).join(':')}:*` : '*';
}

export function applyIpPolicy(ip, policy) {
  if (policy === 'none') return null;
  if (policy === 'masked') return maskIp(ip);
  return ip;
}
