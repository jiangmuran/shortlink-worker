// IPv4/IPv6 membership test against a list of plain IPs or CIDR ranges.

function v4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    const x = Number(o);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = (n * 256 + x) >>> 0;
  }
  return n >>> 0;
}

function v6ToBig(ip) {
  // expand :: and return a BigInt, or null
  if (ip.includes('.')) {
    // IPv4-mapped — handle the mapped tail
    const m = ip.match(/(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (m) {
      const v4 = v4ToInt(m[2]);
      if (v4 == null) return null;
      ip = m[1] + ((v4 >>> 16) & 0xffff).toString(16) + ':' + (v4 & 0xffff).toString(16);
    }
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

function matchOne(ip, rule) {
  rule = rule.trim();
  if (!rule) return false;
  const slash = rule.indexOf('/');
  const base = slash >= 0 ? rule.slice(0, slash) : rule;
  const bits = slash >= 0 ? Number(rule.slice(slash + 1)) : null;
  if (ip.includes(':') || base.includes(':')) {
    const a = v6ToBig(ip);
    const b = v6ToBig(base);
    if (a == null || b == null) return false;
    const p = bits == null ? 128 : bits;
    if (p < 0 || p > 128) return false;
    const mask = p === 0 ? 0n : ((1n << BigInt(p)) - 1n) << BigInt(128 - p);
    return (a & mask) === (b & mask);
  }
  const a = v4ToInt(ip);
  const b = v4ToInt(base);
  if (a == null || b == null) return false;
  const p = bits == null ? 32 : bits;
  if (p < 0 || p > 32) return false;
  const mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

export function ipInList(ip, list) {
  if (!ip || !Array.isArray(list) || !list.length) return false;
  return list.some((r) => matchOne(ip, r));
}

export function validCidr(rule) {
  const slash = rule.indexOf('/');
  const base = slash >= 0 ? rule.slice(0, slash) : rule;
  return v4ToInt(base) != null || v6ToBig(base) != null;
}
