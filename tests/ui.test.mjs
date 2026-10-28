// Browser tests (Playwright) against a local `wrangler dev`.
//
//   PLAYWRIGHT=/path/to/playwright-core/index.mjs BASE=http://localhost:8799 node tests/ui.test.mjs
//
// Wipes the LOCAL database first. The note visitor runs on http://s.localhost:<port>,
// which browsers treat as a secure context, so WebCrypto works like in production.

import { execFileSync } from 'node:child_process';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
const BASE = process.env.BASE || 'http://localhost:8787';
const PORT = new URL(BASE).port || '80';
const SHORT = `http://s.localhost:${PORT}`;
const SHOTS = process.env.SHOTS || null;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${extra ? ` — ${String(extra).slice(0, 200)}` : ''}`);
  }
};

if (!process.env.NO_RESET) {
  const sql = [
    'DELETE FROM logs', 'DELETE FROM link_daily', 'DELETE FROM notes', 'DELETE FROM links', 'DELETE FROM domains',
    'DELETE FROM api_keys', 'DELETE FROM passkeys', 'DELETE FROM sessions', 'DELETE FROM access_tokens',
    'DELETE FROM audit_logs', 'DELETE FROM usage_counters', 'DELETE FROM users',
    'DELETE FROM groups WHERE builtin IS NULL', "DELETE FROM settings WHERE key IN ('rollup_until', 'site_name')",
  ].join('; ');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'shortlink', '--local', '--command', sql], { stdio: 'ignore' });
}

const browser = await chromium.launch();
const errors = [];
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
}
async function newPage(label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOTS ? 2 : 1, locale: 'zh-CN', ...opts });
  const page = await ctx.newPage();
  watch(page, label);
  return { ctx, page };
}
const shot = async (page, name, sel) => {
  if (!SHOTS) return;
  if (!sel) return page.screenshot({ path: `${SHOTS}/${name}.png` });
  const box = await page.locator(sel).boundingBox();
  const pad = 48;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
};

// ---------- setup ----------
const { ctx: adminCtx, page } = await newPage('admin');
await page.goto(BASE);
await page.waitForSelector('input[name="site_name"]', { timeout: 10000 });
await page.fill('input[name="site_name"]', 'ShortLink');
await page.fill('input[name="username"]', 'owner');
await page.fill('input[name="password"]', 'password123');
await page.fill('input[name="password2"]', 'password123');
await page.click('#authSubmit');
await page.waitForSelector('.stat-tile');
ok('setup → dashboard', (await page.locator('.stat-tile').count()) === 4);
ok('owner label', (await page.textContent('.user-chip .who span')) === '所有者');
ok('admin nav entries', (await page.locator('a[href="/groups"]').count()) === 1 && (await page.locator('a[href="/audit"]').count()) === 1);

// ---------- domain ----------
await page.click('a[href="/domains"]');
await page.click('#addDomainBtn');
await page.fill('[name="hostname"]', 's.localhost');
await page.click('#domSave');
await page.waitForSelector('text=s.localhost');
ok('domain added', true);

// ---------- link ----------
await page.click('a[href="/links"]');
await page.click('#newLinkBtn');
await page.fill('[name="target"]', 'https://example.com/ui');
await page.fill('[name="code"]', 'uilink');
await page.click('#linkSave');
await page.waitForSelector('text=创建成功');
ok('short url shown', (await page.textContent('.modal .code-pill')).includes('s.localhost/uilink'));
await page.click('.modal-overlay .modal-head [data-close]');

// ---------- composer templates: save then apply ----------
await page.click('a[href="/notes"]');
await page.click('#newNoteBtn');
await page.waitForSelector('#previewRoot .nt-card');
await page.click('[data-nmode="type"]');
await page.click('[data-theme-pick="letter"]');
await page.selectOption('[name="max_opens"]', '2');
page.once('dialog', (d) => d.accept('门禁模板'));
await page.click('#tplSave');
await page.waitForSelector('text=模板已保存');
await page.click('.modal-overlay .modal-head [data-close]');
await page.click('#newNoteBtn');
await page.waitForSelector('#previewRoot .nt-card');
await page.selectOption('#tplSelect', { label: '门禁模板' });
await page.click('#tplApply');
await page.waitForTimeout(200);
ok('template applies mode', (await page.getAttribute('[data-nmode="type"]', 'class')).includes('on'));
ok('template applies theme', (await page.getAttribute('[data-theme-pick="letter"]', 'class')).includes('on'));
ok('template applies limit', (await page.inputValue('[name="max_opens"]')) === '2');
await page.click('.modal-overlay .modal-head [data-close]');

// ---------- note composer → visitor ----------
await page.click('#newNoteBtn');
await page.waitForSelector('#previewRoot .nt-card');
await page.fill('#nText', '门禁 4721#，进门左转第二间。');
await page.fill('[name="title"]', '给小林的信');
await page.click('[data-nmode="type"]');
await page.click('[data-theme-pick="letter"]');
await page.selectOption('[name="max_opens"]', '2');
await page.waitForTimeout(400);
ok('preview shows cover', (await page.textContent('#previewRoot')).includes('给小林的信'));
// a canvas with drawn content (not a blank fill): sample pixels and check variance
const canvasHasContent = (page, sel) =>
  page.evaluate((s) => {
    const c = document.querySelector(s);
    if (!c) return false;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < min) min = d[i];
      if (d[i] > max) max = d[i];
    }
    return max - min > 30;
  }, sel);

await page.click('#previewRoot .nt-btn');
await page.waitForSelector('#previewRoot .nt-view canvas');
await page.waitForTimeout(400);
ok('preview renders on canvas', await canvasHasContent(page, '#previewRoot .nt-view canvas'));
ok('preview text not in DOM', !(await page.textContent('#previewRoot')).includes('4721'));
await shot(page, 'composer');
await page.click('#noteSave');
await page.waitForSelector('text=密信已生成');
const noteUrl = (await page.textContent('.note-url')).trim();
ok('e2e url carries key', /^https:\/\/s\.localhost\/[A-Za-z0-9]+#k=[A-Za-z0-9_-]{40,}$/.test(noteUrl), noteUrl);
await page.click('.modal-overlay .modal-head [data-close]');
await page.waitForSelector('.tbl');
ok('note listed as pending', (await page.textContent('#notesList')).includes('待查看'));

const visitUrl = noteUrl.replace('https://s.localhost', SHORT);
const { ctx: cv, page: v } = await newPage('visitor');
await v.goto(visitUrl);
await v.waitForSelector('.nt-card .nt-btn');
ok('visitor sees cover only', (await v.textContent('body')).includes('给小林的信') && !(await v.textContent('body')).includes('4721'));
ok('theme applied', await v.evaluate(() => document.body.classList.contains('nt-letter')));
await shot(v, 'visitor-cover', '.nt-card');
await v.click('.nt-btn');
await v.waitForSelector('.nt-view canvas');
await v.waitForTimeout(400);
ok('visitor content on canvas', await canvasHasContent(v, '.nt-view canvas'));
ok('plaintext never in DOM', !(await v.content()).includes('4721'));
ok('content not selectable', await v.evaluate(() => getComputedStyle(document.querySelector('.nt-view')).userSelect === 'none'));
await shot(v, 'visitor-read', '.nt-card');
await v.click('text=看完了');
await v.waitForSelector('.nt-end');
ok('content cleared from screen', (await v.locator('.nt-view').count()) === 0);
await cv.close();

// missing key: must not consume an open
const { ctx: cv2, page: v2 } = await newPage('visitor-nokey');
await v2.goto(visitUrl.split('#')[0]);
await v2.waitForSelector('.nt-end');
ok('missing key handled', (await v2.textContent('.nt-end')).includes('链接不完整'));
await cv2.close();

// second (last) open uses it up
const { ctx: cv3, page: v3 } = await newPage('visitor-2');
await v3.goto(visitUrl);
await v3.waitForSelector('.nt-btn');
ok('last-chance button', (await v3.textContent('.nt-btn')).includes('仅此一次'));
await v3.click('.nt-btn');
await v3.waitForSelector('.nt-view canvas');
await v3.waitForTimeout(500);
ok('second open shows content', await canvasHasContent(v3, '.nt-view canvas'));
await cv3.close();
const { ctx: cv4, page: v4 } = await newPage('visitor-3');
await v4.goto(visitUrl);
await v4.waitForSelector('.nt-end');
ok('used-up page is quiet (no 焚毁)', (await v4.textContent('.nt-end')).includes('看过了') && !(await v4.textContent('body')).includes('焚毁'));
await shot(v4, 'visitor-burned', '.nt-card');
await cv4.close();

// motion (anti-screenshot) mode: a single frame must be mostly noise, not readable text
await page.click('#newNoteBtn');
await page.waitForSelector('#previewRoot .nt-card');
await page.fill('#nText', '一二三四五六七八九十');
await page.click('[data-nmode="motion"]');
await page.click('[data-theme-pick="term"]');
await page.click('#noteSave');
await page.waitForSelector('text=密信已生成');
const motionUrl = (await page.textContent('.note-url')).trim().replace('https://s.localhost', SHORT);
await page.click('.modal-overlay .modal-head [data-close]');
const { ctx: cmo, page: mo } = await newPage('visitor-motion');
await mo.goto(motionUrl);
await mo.click('.nt-btn');
await mo.waitForSelector('.nt-view canvas');
await mo.waitForTimeout(400);
// motion still frame: roughly half the pixels black, half white (noise), high edge density
const noisy = await mo.evaluate(() => {
  const c = document.querySelector('.nt-view canvas');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let black = 0, total = 0, flips = 0, prev = -1;
  for (let i = 0; i < d.length; i += 4) {
    total++;
    const b = d[i] < 128 ? 1 : 0;
    if (b) black++;
    if (prev !== -1 && b !== prev) flips++;
    prev = b;
  }
  return { ratio: black / total, flipRate: flips / total };
});
ok('motion still frame is noise', noisy.ratio > 0.25 && noisy.ratio < 0.75 && noisy.flipRate > 0.2, JSON.stringify(noisy));
await shot(mo, 'visitor-motion', '.nt-card');
await cmo.close();

// ---------- users: restricted account + login link ----------
await page.click('a[href="/users"]');
await page.click('#addUserBtn');
await page.waitForSelector('[name="username"]');
await page.fill('[name="username"]', 'temp');
const restrictedId = await page.$eval('[name="group_id"]', (s) => [...s.options].find((o) => o.textContent === '受限成员').value);
await page.selectOption('[name="group_id"]', restrictedId);
await page.waitForTimeout(200);
ok('restricted preset sets 30-day expiry', (await page.inputValue('[name="expiry"]')) === '30');
await page.click('#capDetails summary');
await shot(page, 'user-editor');
await page.click('#userSave');
await page.waitForSelector('text=还没有登录方式');
await page.click('.modal-overlay:last-child [data-ok]');
await page.waitForSelector('#llSave');
await page.click('#llSave');
await page.waitForSelector('text=登录链接已创建');
const loginUrl = (await page.textContent('.key-reveal')).trim();
ok('login link url', /\/login\/lgn_/.test(loginUrl), loginUrl);
await page.click('.modal-overlay .modal-head [data-close]');

const { page: t } = await newPage('temp-user');
await t.goto(loginUrl.replace(/^https?:\/\/[^/]+/, BASE));
await t.waitForSelector('#tkGo');
await t.click('#tkGo');
await t.waitForSelector('.sidebar');
ok('login link signs in', (await t.textContent('.user-chip .who b')) === 'temp');
ok('restricted role label', (await t.textContent('.user-chip .who span')) === '受限成员');
ok('no admin nav for restricted', (await t.locator('a[href="/users"]').count()) === 0);
await t.click('a[href="/links"]');
await t.click('#newLinkBtn');
ok('random-only suffix enforced in UI', await t.isDisabled('[name="code"]'));
ok('only confirm mode offered', (await t.locator('[data-mode]').count()) === 1);
await t.keyboard.press('Escape');
await t.click('.modal-overlay [data-close]').catch(() => {});
await t.click('a[href="/notes"]');
await t.click('#newNoteBtn');
await t.waitForSelector('#previewRoot .nt-card');
ok('restricted notes use server encryption', (await t.locator('#encSeg').count()) === 0 && (await t.textContent('.composer-form')).includes('服务端加密'));
ok('open count capped', !(await t.$$eval('[name="max_opens"] option', (os) => os.map((o) => o.value))).includes('0'));

// freeze kicks the session
await page.reload();
await page.waitForSelector('[data-umenu]');
const row = page.locator('tr', { hasText: 'temp' });
await row.locator('[data-umenu]').click();
await page.click('.menu button:has-text("冻结账户")');
await page.click('.modal-overlay [data-ok]');
await page.waitForSelector('text=已冻结');
await t.goto(BASE + '/links');
await t.waitForSelector('#authSubmit', { timeout: 8000 });
ok('frozen user signed out', true);

// ---------- invite signup ----------
await page.click('a[href="/access"]');
await page.click('#newInvite');
await page.waitForSelector('#invSave');
await page.click('#invSave');
await page.waitForSelector('text=邀请链接已创建');
const inviteUrl = (await page.textContent('.key-reveal')).trim();
await page.click('.modal-overlay .modal-head [data-close]');
const { page: inv } = await newPage('invitee');
await inv.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
await inv.waitForSelector('#invForm');
await inv.fill('[name="username"]', 'newbie');
await inv.fill('[name="password"]', 'newbiepass');
await inv.click('#invForm button');
await inv.waitForSelector('.sidebar');
ok('invite signup lands in console', (await inv.textContent('.user-chip .who b')) === 'newbie');

// ---------- audit ----------
await page.click('a[href="/audit"]');
await page.waitForSelector('#auditBox .tbl');
const auditText = await page.textContent('#auditBox');
ok('audit shows freeze & invite', auditText.includes('冻结账户') && auditText.includes('通过邀请注册'));
await shot(page, 'audit');

// ---------- chat room: create, two clients, E2E message on canvas ----------
await page.goto(`${BASE}/rooms`);
await page.waitForSelector('#newRoomBtn');
await page.click('#newRoomBtn');
await page.waitForSelector('#rPreview .rm-body canvas');
await page.fill('[name="label"]', '周末计划');
await page.click('[data-rmode="motion"]');
await page.selectOption('[name="disappear"]', '0');
await page.click('#roomSave');
await page.waitForSelector('text=聊天室已创建');
const roomUrl = (await page.textContent('.note-url')).trim();
ok('room url carries key', /^https:\/\/s\.localhost\/[A-Za-z0-9]+#k=[A-Za-z0-9_-]{40,}$/.test(roomUrl), roomUrl);
await page.click('.modal-overlay .modal-head [data-close]');
const roomVisit = roomUrl.replace('https://s.localhost', SHORT);

async function joinRoom(label, nick) {
  const { ctx, page: rp } = await newPage(label);
  await rp.goto(roomVisit);
  await rp.waitForSelector('#joinForm');
  await rp.fill('[name="nick"]', nick);
  await rp.click('#joinForm button[type="submit"]');
  await rp.waitForSelector('.rm-shell', { timeout: 8000 });
  return { ctx, rp };
}
const { ctx: ca, rp: alice } = await joinRoom('alice', '小林');
const { ctx: cb, rp: bob } = await joinRoom('bob', '阿杰');
await alice.waitForFunction(() => document.querySelectorAll('.rm-member').length >= 2, { timeout: 8000 });
ok('member list shows both', (await alice.locator('.rm-member').count()) >= 2);
ok('member device visible', (await alice.textContent('.rm-panel-list')).includes('设备'));
ok('member ip hidden by default', !(await alice.textContent('.rm-panel-list')).includes('IP'));
// bob sends; alice receives on canvas, plaintext not in DOM
await bob.fill('#rmInput', '约在二楼靠窗');
await bob.click('#rmSend');
await alice.waitForSelector('.rm-msg .rm-body canvas', { timeout: 8000 });
await alice.waitForTimeout(500);
ok('message rendered on canvas', await canvasHasContent(alice, '.rm-msg .rm-body canvas'));
ok('chat plaintext not in DOM', !(await alice.content()).includes('约在二楼靠窗'));
await shot(alice, 'chat-room');
await ca.close();
await cb.close();

// ---------- owner moderation: enter as owner, kick, lock ----------
// owner enters via the console (issues a signed owner token in the URL)
const roomCode = roomUrl.match(/s\.localhost\/([A-Za-z0-9]+)/)[1];
const ownerUrl = await page.evaluate(async (code) => {
  const rooms = (await (await fetch('/api/rooms')).json()).data.items;
  const r = rooms.find((x) => x.code === code);
  const t = (await (await fetch(`/api/rooms/${r.id}/enter`, { method: 'POST' })).json()).data.token;
  return t;
}, roomCode);
async function joinRoomRaw(label, url, nick) {
  const { ctx, page: rp } = await newPage(label);
  await rp.goto(url);
  await rp.waitForSelector('#joinForm');
  await rp.fill('[name=nick]', nick);
  await rp.click('#joinForm button[type="submit"]');
  await rp.waitForSelector('.rm-shell', { timeout: 8000 });
  return { ctx, rp };
}
const ownerEnterUrl = (() => { const h = roomVisit.indexOf('#'); return `${roomVisit.slice(0, h)}?o=${encodeURIComponent(ownerUrl)}${roomVisit.slice(h)}`; })();
const { ctx: co, rp: owner } = await joinRoomRaw('room-owner', ownerEnterUrl, '房主');
await owner.waitForSelector('.rm-shell');
const openPanel = async (pg) => { if (await pg.locator('#rmPeople').isVisible()) { await pg.click('#rmPeople'); } };
await openPanel(owner);
await owner.waitForSelector('#rmLock', { state: 'visible', timeout: 6000 });
ok('owner sees lock control', true);
const { ctx: cg, rp: guest2 } = await joinRoomRaw('room-guest', roomVisit, '路人');
await owner.waitForFunction(() => [...document.querySelectorAll('.rm-member')].length >= 2, { timeout: 8000 });
await owner.waitForSelector('[data-kick]', { state: 'visible', timeout: 6000 });
ok('owner can kick a member', (await owner.locator('[data-kick]').count()) >= 1);
await owner.click('[data-kick]');
await guest2.waitForSelector('.rm-end', { timeout: 8000 });
ok('kicked member is removed', (await guest2.textContent('.rm-end')).includes('离开'));
// lock the room; a new visitor cannot join
await owner.click('#rmLock');
await owner.waitForTimeout(400);
const { page: guest3 } = await newPage('room-locked');
await guest3.goto(roomVisit);
await guest3.waitForSelector('#joinForm');
await guest3.fill('[name=nick]', '迟到');
await guest3.click('#joinForm button[type="submit"]');
await guest3.waitForFunction(() => document.querySelector('.rm-err') && !document.querySelector('.rm-err').hidden, { timeout: 8000 }).catch(() => {});
ok('locked room rejects new joiner', (await guest3.textContent('body')).includes('锁定'));
await co.close();
await cg.close();

// ---------- mobile smoke ----------
const { page: mob } = await newPage('mobile', { viewport: { width: 390, height: 844 } });
await mob.goto(visitUrl);
await mob.waitForSelector('.nt-card');
const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok('note page fits phone width', !overflow);

ok('no page errors', errors.length === 0, errors.join(' | '));
console.log(`UI PASS=${pass} FAIL=${fail}`);
for (const f of failures) console.log('  FAIL', f);
await browser.close();
process.exit(fail ? 1 : 0);
