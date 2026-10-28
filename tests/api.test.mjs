// End-to-end API tests against a local `wrangler dev` (default http://localhost:8787).
//
//   npx wrangler d1 migrations apply shortlink --local
//   npx wrangler dev --port 8787            # in another terminal
//   node tests/api.test.mjs                  # wipes the LOCAL database first
//
// Uses node:http so the Host header can be set (short-link domains are routed by Host).

import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const BASE = new URL(process.env.BASE || 'http://localhost:8787');
const ADMIN_HOST = 'localhost';
let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
  }
}

class Client {
  constructor(host = ADMIN_HOST) {
    this.host = host;
    this.cookies = new Map();
  }
  req(method, path, { body, headers = {}, host } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const r = http.request(
        {
          hostname: BASE.hostname,
          port: BASE.port,
          method,
          path,
          headers: {
            host: host || this.host,
            ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
            ...(cookie ? { cookie } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            for (const sc of [].concat(res.headers['set-cookie'] || [])) {
              const [pair] = sc.split(';');
              const i = pair.indexOf('=');
              const k = pair.slice(0, i).trim();
              const v = pair.slice(i + 1).trim();
              if (/max-age=0/i.test(sc) || !v) this.cookies.delete(k);
              else this.cookies.set(k, v);
            }
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {}
            resolve({ status: res.statusCode, headers: res.headers, text, json, data: json?.data, error: json?.error });
          });
        }
      );
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, body, o = {}) { return this.req('POST', p, { ...o, body: body ?? {} }); }
  patch(p, body, o = {}) { return this.req('PATCH', p, { ...o, body }); }
  del(p, o) { return this.req('DELETE', p, o); }
}

// ---------- browser-equivalent note crypto (mirrors public/note.js) ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
async function encryptNote(payload) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  const k = b64u(keyBytes);
  const kcv = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes)).subarray(0, 12));
  return { cipher: b64u(out), key: k, kcv };
}
async function decryptNote(cipherB64, keyB64) {
  const bytes = Buffer.from(cipherB64, 'base64url');
  const key = await crypto.subtle.importKey('raw', Buffer.from(keyB64, 'base64url'), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

function resetDb() {
  const sql = [
    'DELETE FROM logs', 'DELETE FROM link_daily', 'DELETE FROM notes', 'DELETE FROM links', 'DELETE FROM domains',
    'DELETE FROM api_keys', 'DELETE FROM passkeys', 'DELETE FROM sessions', 'DELETE FROM access_tokens',
    'DELETE FROM audit_logs', 'DELETE FROM usage_counters', 'DELETE FROM users',
    "DELETE FROM groups WHERE builtin IS NULL", "DELETE FROM settings WHERE key IN ('rollup_until', 'site_name')",
  ].join('; ');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'shortlink', '--local', '--command', sql], { stdio: 'ignore' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================

async function main() {
  if (!process.env.NO_RESET) resetDb();
  await sleep(300);
  const admin = new Client();
  let r;

  // ---------- setup & auth ----------
  r = await admin.get('/api/bootstrap');
  check('bootstrap needs setup', r.data?.needsSetup === true, r.text);
  r = await admin.post('/api/setup', { username: 'owner', password: 'password123', site_name: '测试站' });
  check('setup', r.status === 200 && r.data?.user?.role === 'admin', r.text);
  r = await admin.get('/api/me');
  check('owner flag', r.data?.user?.is_owner === true && r.data.user.admin_perms.users === true, r.text);
  r = await admin.post('/api/setup', { username: 'xy', password: 'password123' });
  check('setup only once', r.status === 403, r.text);
  const anon = new Client();
  r = await anon.post('/api/auth/login', { username: 'owner', password: 'wrong' });
  check('bad login', r.status === 401, r.text);

  // ---------- domains ----------
  r = await admin.post('/api/domains', { hostname: 's.test', remark: '主域名' });
  check('add domain', r.status === 201, r.text);
  const S = r.data.item.id;
  r = await admin.post('/api/domains', { hostname: 'go.test' });
  const GO = r.data.item.id;
  r = await admin.post('/api/domains', { hostname: 's.test' });
  check('dup domain', r.status === 409, r.text);

  // ---------- links ----------
  r = await admin.post('/api/links', { domain_id: S, target: 'https://example.com/a', code: 'hello', note: '测试' });
  check('create link', r.status === 201 && r.data.item.code === 'hello', r.text);
  const hello = r.data.item;
  r = await admin.post('/api/links', { domain_id: S, target: 'https://example.com/b', code: 'hello' });
  check('dup code', r.status === 409, r.text);
  r = await admin.post('/api/links', { domain_id: S, target: 'javascript:alert(1)' });
  check('reject js target', r.status === 400, r.text);
  r = await admin.post('/api/links', { domain_id: S, target: 'https://example.com/r', random_length: 7 });
  check('random code', r.status === 201 && r.data.item.code.length === 7, r.text);
  r = await admin.patch(`/api/links/${hello.id}`, { target: 'https://example.com/updated', mode: 'confirm' });
  check('update link', r.data?.item?.target === 'https://example.com/updated' && r.data.item.mode === 'confirm', r.text);
  r = await admin.patch(`/api/links/${hello.id}`, { mode: 'direct' });

  // redirect on the short domain
  const visitor = new Client('s.test');
  r = await visitor.get('/hello', { headers: { 'user-agent': 'Mozilla/5.0 test' } });
  check('redirect 302', r.status === 302 && r.headers.location === 'https://example.com/updated', `${r.status} ${r.headers.location}`);
  r = await visitor.get('/nope');
  check('unknown code 404', r.status === 404);
  r = await visitor.get('/_sl/note.js');
  check('note.js served on short domain', r.status === 200 && r.text.includes('mountNote'), r.status);
  await sleep(300);
  r = await admin.get(`/api/links/${hello.id}/logs`);
  check('link logs', r.data?.total >= 1, r.text);
  r = await admin.get('/api/links');
  check('links list excludes notes and counts 7d', r.data?.items?.length === 2 && r.data.items.some((l) => l.clicks_7d >= 1), r.text);
  r = await admin.get('/api/stats');
  check('stats', r.data?.links_total === 2 && r.data.clicks_today >= 1, r.text);

  // ---------- groups & restricted user ----------
  r = await admin.get('/api/groups');
  check('builtin groups', r.data?.items?.length >= 3, r.text);
  const restricted = r.data.items.find((g) => g.builtin === 'restricted');
  const member = r.data.items.find((g) => g.builtin === 'member');
  check('restricted caps', restricted?.caps?.links?.custom_code === false && restricted.caps.notes.e2e === false, JSON.stringify(restricted?.caps));

  r = await admin.post('/api/users', { username: 'guest', password: 'guestpass1', group_id: restricted.id, domain_ids: [S], must_change_password: true });
  check('create restricted user', r.status === 201 && r.data.item.group?.builtin === 'restricted', r.text);
  const guestId = r.data.item.id;
  const guest = new Client();
  r = await guest.post('/api/auth/login', { username: 'guest', password: 'guestpass1' });
  check('guest login', r.status === 200 && r.data.user.must_change_password === true, r.text);
  r = await guest.get('/api/links');
  check('password gate blocks api', r.status === 403 && r.error?.code === 'password_change_required', r.text);
  r = await guest.post('/api/me/password', { current: 'guestpass1', next: 'guestpass2' });
  check('change password', r.status === 200, r.text);
  r = await guest.get('/api/links');
  check('gate lifted', r.status === 200, r.text);

  r = await guest.post('/api/links', { domain_id: S, target: 'https://example.com/g', code: 'mine' });
  check('restricted: custom code forbidden', r.status === 403 && r.error?.code === 'custom_code_forbidden', r.text);
  r = await guest.post('/api/links', { domain_id: GO, target: 'https://example.com/g' });
  check('restricted: domain scope', r.status === 403, r.text);
  r = await guest.post('/api/links', { domain_id: S, target: 'https://example.com/g', mode: 'direct' });
  check('restricted: mode forbidden', r.status === 403 && r.error?.code === 'mode_forbidden', r.text);
  r = await guest.post('/api/links', { domain_id: S, target: 'https://example.com/g' });
  check('restricted: forced confirm + long random code', r.status === 201 && r.data.item.mode === 'confirm' && r.data.item.code.length >= 7, r.text);
  const gl = r.data.item;
  r = await guest.patch(`/api/links/${gl.id}`, { target: 'https://evil.example/phish' });
  check('restricted: cannot edit target', r.status === 403 && r.error?.code === 'edit_target_forbidden', r.text);
  r = await guest.patch(`/api/links/${gl.id}`, { note: '改备注可以' });
  check('restricted: can edit note', r.status === 200, r.text);
  r = await guest.get(`/api/links/${hello.id}`);
  check('restricted: cannot see others', r.status === 403, r.text);
  r = await guest.get('/api/users');
  check('restricted: no admin api', r.status === 403, r.text);
  await new Client('s.test').get(`/${gl.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  await sleep(300);
  r = await guest.get(`/api/links/${gl.id}/logs`);
  check('restricted: ip masked', r.data?.items?.[0] && (r.data.items[0].ip === null || r.data.items[0].ip.includes('*')) && r.data.ip_policy === 'masked', r.text);
  r = await guest.get(`/api/links/${gl.id}/logs.csv`);
  check('restricted: no export', r.status === 403, r.status);
  r = await guest.post('/api/keys', { name: 'k', scopes: ['links:read'] });
  check('restricted: no api keys', r.status === 403, r.text);

  // per-user override: allow custom codes for this one person
  r = await admin.patch(`/api/users/${guestId}`, { caps_override: { links: { custom_code: true, min_code_len: 3 } } });
  check('override saved', r.data?.item?.caps?.links?.custom_code === true && r.data.item.caps_override.links.custom_code === true, r.text);
  r = await guest.get('/api/me');
  check('override invalidates session', r.status === 401, r.status);
  await guest.post('/api/auth/login', { username: 'guest', password: 'guestpass2' });
  r = await guest.post('/api/links', { domain_id: S, target: 'https://example.com/o', code: 'abc' });
  check('override applies', r.status === 201, r.text);

  // daily quota (restricted: 10 links/day) & rate limit (5/min)
  let limited = null;
  for (let i = 0; i < 8; i++) {
    r = await guest.post('/api/links', { domain_id: S, target: `https://example.com/q${i}` });
    if (r.status === 429) {
      limited = r.error?.code;
      break;
    }
  }
  check('rate limit kicks in', limited === 'rate_limited', limited);

  // ---------- scoped admins ----------
  r = await admin.post('/api/users', { username: 'helper', password: 'helperpass', role: 'admin', admin_perms: { users: true } });
  check('owner creates scoped admin', r.status === 201 && r.data.item.admin_perms.users === true && r.data.item.admin_perms.settings === false, r.text);
  const helper = new Client();
  await helper.post('/api/auth/login', { username: 'helper', password: 'helperpass' });
  r = await helper.get('/api/settings');
  check('scoped admin: no settings', r.status === 403, r.text);
  r = await helper.get('/api/users');
  check('scoped admin: users ok', r.status === 200, r.text);
  r = await helper.post('/api/users', { username: 'admin2', password: 'password123', role: 'admin' });
  check('scoped admin cannot create admins', r.status === 403, r.text);
  r = await helper.patch(`/api/users/1`, { display_name: 'x' });
  const ownerRow = (await admin.get('/api/users')).data.items.find((u) => u.is_owner);
  r = await helper.patch(`/api/users/${ownerRow.id}`, { display_name: 'hacked' });
  check('scoped admin cannot touch owner', r.status === 403, r.text);
  r = await helper.get('/api/links');
  check('scoped admin without content sees only own', r.status === 200 && r.data.items.length === 0, r.text);

  // ---------- invite links ----------
  r = await admin.post('/api/access-tokens', { kind: 'invite', label: '朋友', group_id: member.id, domain_ids: [S], account_days: 30, max_uses: 1 });
  check('create invite', r.status === 201 && r.data.url.includes('/invite/inv_'), r.text);
  const invToken = r.data.token;
  r = await anon.get(`/api/invite/${invToken}`);
  check('peek invite', r.data?.group === '普通成员', r.text);
  const invitee = new Client();
  r = await invitee.post(`/api/invite/${invToken}`, { username: 'friend', password: 'friendpass' });
  check('accept invite', r.status === 201, r.text);
  r = await invitee.get('/api/me');
  check('invitee logged in with group & expiry', r.data?.user?.group?.builtin === 'member' && r.data.user.expires_at > Date.now(), r.text);
  r = await new Client().post(`/api/invite/${invToken}`, { username: 'friend2', password: 'friendpass' });
  check('invite single use', r.status === 410, r.text);

  // ---------- login links ----------
  r = await admin.post('/api/access-tokens', { kind: 'login', user_id: guestId, label: '给 guest', max_uses: 2, expires_in_hours: 24 });
  check('create login link', r.status === 201 && r.data.url.includes('/login/lgn_'), r.text);
  const lgn = r.data.token;
  const lgnId = r.data.id;
  r = await admin.post('/api/access-tokens', { kind: 'login', user_id: ownerRow.id });
  check('no login links for admins', r.status === 400, r.text);
  r = await anon.get(`/api/login-link/${lgn}`);
  check('peek login link', r.data?.username === 'guest', r.text);
  const viaLink = new Client();
  r = await viaLink.post(`/api/login-link/${lgn}`, {});
  check('login via link', r.status === 200 && r.data.user.username === 'guest', r.text);
  r = await viaLink.get('/api/me');
  check('link session works', r.data?.user?.username === 'guest', r.text);
  await admin.del(`/api/access-tokens/${lgnId}`);
  r = await new Client().post(`/api/login-link/${lgn}`, {});
  check('revoked login link', r.status === 410, r.text);

  // ---------- freeze ----------
  r = await admin.post(`/api/users/${guestId}/freeze`, { frozen: true });
  check('freeze', r.status === 200 && r.data.disabled_items >= 1, r.text);
  r = await viaLink.get('/api/me');
  check('frozen sessions gone', r.status === 401, r.status);
  r = await new Client('s.test').get(`/${gl.code}`);
  check('frozen content disabled', r.status === 410, r.status);
  r = await guest.post('/api/auth/login', { username: 'guest', password: 'guestpass2' });
  check('frozen cannot login', r.status === 403 && r.error?.code === 'user_frozen', r.text);
  r = await admin.post(`/api/users/${guestId}/freeze`, { frozen: false });
  check('unfreeze restores', r.data?.restored >= 1, r.text);
  r = await new Client('s.test').get(`/${gl.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  check('restored content works', r.status === 200, r.status);

  // ---------- notes: end-to-end ----------
  const secret = { format: 'markdown', text: '**门禁** 4721#\n\n- 二楼\n- 左转' };
  const e = await encryptNote(secret);
  r = await admin.post('/api/notes', {
    domain_id: S, enc: 'e2e', cipher: e.cipher, kcv: e.kcv, max_opens: 2, password: 'pw-123',
    label: '门禁', display: { mode: 'type', chunk: 3 }, theme: { name: 'letter' }, meta: { title: '给你', from: 'owner', hint: '一封信' },
  });
  check('create e2e note', r.status === 201 && r.data.item.kind === 'note' && r.data.item.has_password, r.text);
  const note = r.data.item;
  r = await admin.get('/api/links');
  check('note not in links list', !r.data.items.some((l) => l.id === note.id), r.text);
  r = await new Client('s.test').get(`/${note.code}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  check('note cover page', r.status === 200 && r.text.includes('note-data') && r.text.includes('一封信') && !r.text.includes('4721'), r.status);
  check('note page headers', r.headers['cache-control']?.includes('no-store') && r.headers['referrer-policy'] === 'no-referrer');
  const nv = new Client('s.test');
  r = await nv.post(`/api/n/${note.code}/open`, { kcv: e.kcv });
  check('password required', r.status === 401 && r.error?.code === 'password_required', r.text);
  r = await nv.post(`/api/n/${note.code}/open`, { kcv: 'AAAAAAAAAAAAAAAA', password: 'pw-123' });
  check('wrong key rejected without consuming', r.status === 400 && r.error?.code === 'bad_key', r.text);
  r = await nv.post(`/api/n/${note.code}/open`, { kcv: e.kcv, password: 'nope' });
  check('wrong password counts down', r.status === 401 && r.error?.attempts_left === 4, r.text);
  r = await nv.post(`/api/n/${note.code}/open`, { kcv: e.kcv, password: 'pw-123' });
  check('open #1', r.status === 200 && r.data.remaining === 1 && !r.data.burned && r.data.cipher, r.text);
  const plain = await decryptNote(r.data.cipher, e.key);
  check('decrypts in client', plain.text === secret.text, JSON.stringify(plain));
  r = await nv.post(`/api/n/${note.code}/open`, { kcv: e.kcv, password: 'pw-123' });
  check('open #2 burns', r.status === 200 && r.data.burned === true && r.data.remaining === 0, r.text);
  r = await nv.post(`/api/n/${note.code}/open`, { kcv: e.kcv, password: 'pw-123' });
  check('open #3 refused', r.status === 410 && r.error?.code === 'burned', r.text);
  r = await admin.get(`/api/notes/${note.id}`);
  check('note burned in console', r.data?.item?.status === 'burned' && r.data.item.burn_reason === 'exhausted', r.text);
  r = await new Client('s.test').get(`/${note.code}`);
  check('burned cover is 410', r.status === 410 && r.text.includes('"status":"burned"'), r.status);
  r = await admin.get(`/api/notes/${note.id}/content`);
  check('e2e content not readable by server', r.status === 400, r.text);

  // concurrent opens of a single-use note: exactly one succeeds
  const e2 = await encryptNote({ format: 'text', text: 'race' });
  r = await admin.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: e2.cipher, kcv: e2.kcv, max_opens: 1 });
  const race = r.data.item;
  const results = await Promise.all(Array.from({ length: 6 }, () => new Client('s.test').post(`/api/n/${race.code}/open`, { kcv: e2.kcv })));
  check('single-use under concurrency', results.filter((x) => x.status === 200).length === 1, results.map((x) => x.status).join(','));

  // password lockout burns
  const e3 = await encryptNote({ format: 'text', text: 'lock' });
  r = await admin.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: e3.cipher, kcv: e3.kcv, max_opens: 1, password: 'right', pw_max_fail: 2 });
  const locked = r.data.item;
  await nv.post(`/api/n/${locked.code}/open`, { kcv: e3.kcv, password: 'a' });
  r = await nv.post(`/api/n/${locked.code}/open`, { kcv: e3.kcv, password: 'b' });
  check('password lockout burns', r.status === 410 && r.error?.code === 'burned', r.text);

  // ---------- notes: restricted user (server-side encryption) ----------
  r = await guest.post('/api/auth/login', { username: 'guest', password: 'guestpass2' });
  r = await guest.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: e.cipher, kcv: e.kcv, max_opens: 1 });
  check('restricted: e2e forbidden', r.status === 403 && r.error?.code === 'e2e_forbidden', r.text);
  r = await guest.post('/api/notes', { domain_id: S, enc: 'server', payload: { format: 'text', text: '服务端加密内容' }, max_opens: 50 });
  check('restricted: open cap', r.status === 400 && r.error?.code === 'too_many_opens', r.text);
  await sleep(61_000); // let the per-minute rate window reset
  r = await guest.post('/api/notes', { domain_id: S, enc: 'server', payload: { format: 'text', text: '服务端加密内容' }, max_opens: 1, expires_at: Date.now() + 3650 * 86400000 });
  check('restricted: server note created, expiry capped', r.status === 201 && r.data.item.enc === 'server' && r.data.item.expires_at <= Date.now() + 168 * 3600000 + 5000, r.text);
  const sn = r.data.item;
  r = await admin.get(`/api/notes/${sn.id}/content`);
  check('admin reads server note', r.data?.payload?.text === '服务端加密内容', r.text);
  r = await new Client('s.test').post(`/api/n/${sn.code}/open`, {});
  check('server note opens with plaintext', r.status === 200 && r.data.payload.text === '服务端加密内容' && r.data.burned, r.text);
  r = await admin.get('/api/audit');
  check('audit has content view', r.data?.items?.some((a) => a.action === 'note.view_content'), r.text);
  check('audit has freeze', r.data?.items?.some((a) => a.action === 'user.freeze'));

  // ---------- note access limits (scheduled unlock, region, IP, device lock) ----------
  // scheduled unlock: open before unlock_at is refused without consuming
  const eU = await encryptNote({ text: 'later' });
  r = await admin.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: eU.cipher, kcv: eU.kcv, max_opens: 1, unlock_at: Date.now() + 3600_000 });
  const scheduled = r.data.item;
  check('note stores unlock_at', scheduled.unlock_at > Date.now(), r.text);
  r = await new Client('s.test').post(`/api/n/${scheduled.code}/open`, { kcv: eU.kcv });
  check('locked before unlock time', r.status === 423 && r.error?.code === 'locked' && r.error?.unlock_at > Date.now(), r.text);
  r = await admin.get(`/api/notes/${scheduled.id}`);
  check('scheduled note not consumed', r.data.item.opens === 0 && r.data.item.status !== 'burned', r.text);

  // region deny
  const eG = await encryptNote({ text: 'geo' });
  r = await admin.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: eG.cipher, kcv: eG.kcv, max_opens: 1, access: { geo_mode: 'allow', geo_list: ['JP'] } });
  const geoNote = r.data.item;
  check('access saved', geoNote.access?.geo_mode === 'allow' && geoNote.access.geo_list.includes('JP'), JSON.stringify(geoNote.access));
  // local dev cf.country is usually absent/US -> not JP -> denied
  r = await new Client('s.test').post(`/api/n/${geoNote.code}/open`, { kcv: eG.kcv });
  check('region blocks open', r.status === 403 && r.error?.code === 'denied_geo', r.text);

  // IP allowlist: a non-matching IP is blocked (dev has no real client IP)
  const eI = await encryptNote({ text: 'ip' });
  r = await admin.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: eI.cipher, kcv: eI.kcv, max_opens: 1, access: { ip_list: ['203.0.113.0/24'] } });
  const ipNote = r.data.item;
  r = await new Client('s.test').post(`/api/n/${ipNote.code}/open`, { kcv: eI.kcv });
  check('ip allowlist blocks', r.status === 403 && r.error?.code === 'denied_ip', r.text);

  // bad access input rejected cleanly
  const eB = await encryptNote({ text: 'bad' });
  r = await admin.post('/api/notes', { domain_id: S, enc: 'e2e', cipher: eB.cipher, kcv: eB.kcv, access: { ip_list: ['not-an-ip', '10.0.0.0/8'] } });
  check('invalid CIDR dropped', r.status === 201 && r.data.item.access.ip_list.length === 1 && r.data.item.access.ip_list[0] === '10.0.0.0/8', JSON.stringify(r.data?.item?.access));

  // ---------- maintenance & rollups ----------
  r = await admin.post('/api/admin/cleanup', {});
  check('maintenance runs', r.status === 200 && r.data.rolled_days >= 1, r.text);
  r = await admin.get('/api/links');
  check('7d counts survive rollup', r.data.items.some((l) => l.clicks_7d >= 1), r.text);
  r = await admin.get('/api/stats');
  check('stats after rollup', r.data?.clicks_today >= 1 && r.data.notes_total >= 1, r.text);

  // ---------- API keys & v1 ----------
  r = await admin.post('/api/keys', { name: 'ci', scopes: ['links:read', 'links:write', 'domains:read'] });
  check('create key', r.status === 201 && r.data.key.startsWith('sk_'), r.text);
  const key = r.data.key;
  const api = new Client();
  r = await api.post('/api/v1/links', { url: 'https://example.com/v1', domain: 's.test', code: 'viaapi' }, { headers: { authorization: `Bearer ${key}` } });
  check('v1 create', r.status === 201 && r.data.short_url === 'https://s.test/viaapi', r.text);
  r = await api.get('/api/v1/links', { headers: { authorization: `Bearer ${key}` } });
  check('v1 list', r.data?.total >= 1 && r.data.items.every((l) => l.target !== ''), r.text);
  r = await api.get('/api/users', { headers: { authorization: `Bearer ${key}` } });
  check('key cannot use console api', r.status === 401, r.text);

  // ---------- settings ----------
  r = await admin.patch('/api/settings', { site_name: '新名字', retention_days: 30 });
  check('settings update', r.data?.settings?.site_name === '新名字', r.text);
  r = await anon.get('/api/bootstrap');
  check('settings cache refreshed', r.data?.site_name === '新名字', r.text);

  console.log(`API PASS=${pass} FAIL=${fail}`);
  for (const f of failures) console.log('  FAIL', f);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
