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

// ---------- note composer → visitor ----------
await page.click('a[href="/notes"]');
await page.click('#newNoteBtn');
await page.waitForSelector('#previewRoot .nt-card');
await page.fill('#nText', '**门禁** 4721#\n\n进门左转第二间。');
await page.click('[data-fmt="markdown"]');
await page.fill('[name="title"]', '给小林的信');
await page.click('[data-theme-pick="letter"]');
await page.selectOption('[name="max_opens"]', '2');
await page.waitForTimeout(400);
ok('preview shows cover', (await page.textContent('#previewRoot')).includes('给小林的信'));
await page.click('#previewRoot .nt-btn');
await page.waitForTimeout(300);
ok('preview plays content locally', (await page.textContent('#previewRoot .nt-content')).includes('4721'));
await shot(page, 'composer');
await page.click('#noteSave');
await page.waitForSelector('text=密信已生成');
const noteUrl = (await page.textContent('.note-url')).trim();
ok('e2e url carries key', /^https:\/\/s\.localhost\/[A-Za-z0-9]+#k=[A-Za-z0-9_-]{40,}$/.test(noteUrl), noteUrl);
await page.click('.modal-overlay .modal-head [data-close]');
await page.waitForSelector('.tbl');
ok('note listed as pending', (await page.textContent('#notesList')).includes('待查看'));

const visitUrl = noteUrl.replace('https://s.localhost', SHORT);
const { ctx: vctx, page: v } = await newPage('visitor');
await v.goto(visitUrl);
await v.waitForSelector('.nt-card .nt-btn');
ok('visitor sees cover only', (await v.textContent('body')).includes('给小林的信') && !(await v.textContent('body')).includes('4721'));
ok('theme applied', await v.evaluate(() => document.body.classList.contains('nt-letter')));
await shot(v, 'visitor-cover', '.nt-card');
await v.click('.nt-btn');
await v.waitForSelector('.nt-content strong');
ok('visitor decrypts markdown', (await v.textContent('.nt-content')).includes('门禁 4721#'));
ok('remaining shown', (await v.textContent('.nt-foot')).includes('还能查看 1 次'));
await shot(v, 'visitor-read', '.nt-card');
await v.click('text=看完了，清除内容');
ok('content cleared from screen', (await v.locator('.nt-content').count()) === 0);

// missing key: must not consume an open
const { page: v2 } = await newPage('visitor-nokey');
await v2.goto(visitUrl.split('#')[0]);
await v2.waitForSelector('.nt-gone');
ok('missing key handled', (await v2.textContent('.nt-gone')).includes('链接不完整'));

// second (last) open burns it
const { page: v3 } = await newPage('visitor-2');
await v3.goto(visitUrl);
await v3.waitForSelector('.nt-warn');
ok('last-chance warning', (await v3.textContent('.nt-warn')).includes('唯一一次'));
await v3.click('.nt-btn');
await v3.waitForSelector('.nt-content');
ok('second open burns', (await v3.textContent('.nt-foot')).includes('已焚毁'));
const { page: v4 } = await newPage('visitor-3');
await v4.goto(visitUrl);
await v4.waitForSelector('.nt-gone');
ok('burned page', (await v4.textContent('.nt-gone')).includes('已焚毁'));
await shot(v4, 'visitor-burned', '.nt-card');

// sliding window mode, plain text
await page.click('#newNoteBtn');
await page.waitForSelector('#previewRoot .nt-card');
await page.fill('#nText', '一二三四五六七八九十');
await page.click('[data-nmode="window"]');
await page.selectOption('[name="window"]', '4');
await page.selectOption('[name="speed"]', '120');
await page.click('[data-theme-pick="term"]');
await page.click('#noteSave');
await page.waitForSelector('text=密信已生成');
const winUrl = (await page.textContent('.note-url')).trim().replace('https://s.localhost', SHORT);
await page.click('.modal-overlay .modal-head [data-close]');
const { page: w } = await newPage('visitor-window');
await w.goto(winUrl);
await w.click('.nt-btn');
await w.waitForSelector('.nt-window');
await w.waitForTimeout(700);
const shown = (await w.textContent('.nt-window')).length;
ok('sliding window shows at most 4 chars', shown > 0 && shown <= 4, shown);
await shot(w, 'visitor-window', '.nt-card');
await w.waitForSelector('.nt-gone', { timeout: 6000 });
ok('window mode ends burned', true);

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
