/* ============================================================
   ShortLink console SPA — vanilla JS, no dependencies
   ============================================================ */

/* ---------------- tiny helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function fmtDate(ms, withTime = true) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

function fmtRelative(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 30 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
  return fmtDate(ms, false);
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('zh-CN');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}

const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/* ---------------- icons (SF-Symbols-flavored strokes) ---------------- */

const I = (() => {
  const wrap = (paths, vb = '0 0 24 24') =>
    `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return {
    link: wrap('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    house: wrap('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>'),
    globe: wrap('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'),
    chart: wrap('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    clock: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    person: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'),
    key: wrap('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>'),
    gear: wrap('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    doc: wrap('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
    plus: wrap('<path d="M12 5v14M5 12h14"/>'),
    copy: wrap('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    trash: wrap('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
    pencil: wrap('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'),
    eye: wrap('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
    external: wrap('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>'),
    check: wrap('<path d="M20 6 9 17l-5-5"/>'),
    x: wrap('<path d="M18 6 6 18M6 6l12 12"/>'),
    menu: wrap('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    dots: wrap('<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>'),
    search: wrap('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    logout: wrap('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
    passkey: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-3.5 3.5-6 8-6 1.4 0 2.7.25 3.8.7"/><circle cx="17.5" cy="17.5" r="2.5" fill="currentColor" stroke="none"/><path d="m20.5 20.5 2-2"/>'),
    bolt: wrap('<path d="M13 2 3 14h8l-1 8 11-13h-8z"/>'),
    shield: wrap('<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/>'),
    refresh: wrap('<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>'),
    sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: wrap('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    download: wrap('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
    alert: wrap('<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>'),
    info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>'),
    terminal: wrap('<path d="m5 7 5 5-5 5M13 17h6"/>'),
    arrowLeft: wrap('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
    chevRight: wrap('<path d="m9 6 6 6-6 6"/>'),
    inbox: wrap('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>'),
  };
})();

/* ---------------- API client ---------------- */

let bootstrap = null;
let me = null;

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || !data?.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth') && me) {
      // session expired — back to the login screen
      me = null;
      render();
    }
    const err = new Error(data?.error?.message || `请求失败（${res.status}）`);
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data.data;
}

/* ---------------- toast / modal / menu ---------------- */

function toast(msg, type = 'ok') {
  let zone = $('.toast-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'toast-zone';
    document.body.appendChild(zone);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = (type === 'ok' ? I.check : I.alert) + `<span>${esc(msg)}</span>`;
  zone.appendChild(el);
  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

let modalStack = [];

function openModal({ title, body, footer, wide, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="关闭">${I.x}</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  $('.modal-body', overlay).innerHTML = body;
  if (footer) $('.modal-foot', overlay).innerHTML = footer;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const close = () => {
    overlay.remove();
    modalStack = modalStack.filter((m) => m.overlay !== overlay);
    if (!modalStack.length) document.body.style.overflow = '';
    onClose?.();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  const handle = { overlay, close, root: overlay };
  modalStack.push(handle);
  return handle;
}

function confirmDialog({ title = '确认操作', message, okText = '确认', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: `<p class="modal-text">${message}</p>`,
      footer: `
        <button class="btn btn-secondary" data-close>取消</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(false),
    });
    $('[data-ok]', m.overlay).addEventListener('click', () => {
      resolve(true);
      m.close();
    });
  });
}

function openMenu(anchor, items) {
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = items
    .map((it, i) => {
      if (it === '-') return '<div class="menu-sep"></div>';
      return `<button data-i="${i}"${it.danger ? ' class="danger"' : ''}>${it.icon || ''}<span>${esc(it.label)}</span></button>`;
    })
    .join('');
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = Math.min(rect.right - mw, window.innerWidth - mw - 10);
  let y = rect.bottom + 6;
  if (y + mh > window.innerHeight - 10) y = Math.max(10, rect.top - mh - 6);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${y}px`;
  const close = () => {
    menu.remove();
    document.removeEventListener('click', onDoc, true);
  };
  const onDoc = (e) => {
    if (!menu.contains(e.target)) close();
  };
  setTimeout(() => document.addEventListener('click', onDoc, true));
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    const item = items[Number(btn.dataset.i)];
    close();
    item.action?.();
  });
  return close;
}

/* ---------------- base64url ---------------- */

const b64u2buf = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const buf2b64u = (b) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/* ---------------- router & shell ---------------- */

const routes = {};
function route(path) {
  location.pathname !== path ? history.pushState(null, '', path) : null;
  render();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a) return;
  e.preventDefault();
  route(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

const NAV = [
  { path: '/', label: '概览', icon: 'house', key: 'dashboard' },
  { path: '/links', label: '短链接', icon: 'link', key: 'links' },
  { path: '/domains', label: '域名', icon: 'globe', key: 'domains' },
  { path: '/logs', label: '访问记录', icon: 'clock', key: 'logs', admin: true },
  { section: '管理', admin: true },
  { path: '/users', label: '用户', icon: 'person', key: 'users', admin: true },
  { path: '/settings', label: '设置', icon: 'gear', key: 'settings', admin: true },
  { section: '开发者' },
  { path: '/keys', label: 'API 密钥', icon: 'key', key: 'keys' },
  { path: '/docs', label: 'API 文档', icon: 'doc', external: true },
];

function currentPath() {
  const p = location.pathname;
  return p === '' ? '/' : p;
}

async function render() {
  const app = $('#app');
  const path = currentPath();
  if (!me) {
    await renderAuth(app);
    return;
  }
  const page = routes[path] || routes['/'];
  if (!page) return;
  if (page.adminOnly && me.role !== 'admin') {
    route('/');
    return;
  }
  app.innerHTML = `
    <div class="app">
      <div class="sidebar-backdrop" id="sbBackdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="mark">${I.link}</div>
          <div class="name">${esc(bootstrap?.site_name || 'ShortLink')}</div>
        </div>
        <nav id="nav"></nav>
        <div class="sidebar-foot">
          <div class="user-chip">
            <a class="who-link${path === '/profile' ? ' on' : ''}" href="/profile" data-nav title="个人设置">
              <div class="avatar">${esc((me.display_name || me.username)[0].toUpperCase())}</div>
              <div class="who"><b>${esc(me.display_name || me.username)}</b><span>${me.role === 'admin' ? '管理员' : '成员'}</span></div>
            </a>
            <button class="icon-btn" id="logoutBtn" title="退出登录" aria-label="退出登录">${I.logout}</button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menuBtn" aria-label="菜单">${I.menu}</button>
          <h1 id="pageTitle"></h1>
          <div class="spacer"></div>
          <div id="topActions"></div>
          <div class="topbar-sep"></div>
          <button class="icon-btn" id="themeBtn" title="切换外观" aria-label="切换外观"></button>
        </header>
        <div class="content" id="content"></div>
      </div>
    </div>`;

  // nav
  const nav = $('#nav');
  const admin = me.role === 'admin';
  nav.innerHTML = NAV.map((item) => {
    if (item.admin && !admin) return '';
    if (item.section) return `<div class="nav-section">${item.section}</div>`;
    if (item.external) return `<a class="nav-item" href="${item.path}" target="_blank" rel="noopener">${I[item.icon]}<span>${item.label}</span>${I.external.replace('<svg', '<svg class="ext"')}</a>`;
    const on = path === item.path || (item.path !== '/' && path.startsWith(item.path));
    return `<a class="nav-item${on ? ' on' : ''}" href="${item.path}" data-nav>${I[item.icon]}<span>${item.label}</span></a>`;
  }).join('');
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    me = null;
    route('/');
  });

  // mobile drawer
  const sidebar = $('#sidebar');
  const backdrop = $('#sbBackdrop');
  $('#menuBtn').addEventListener('click', () => {
    sidebar.classList.add('open');
    backdrop.classList.add('show');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  });
  sidebar.addEventListener('click', (e) => {
    if (!e.target.closest('a')) return;
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  });

  $('#pageTitle').textContent = page.title;

  // theme toggle
  const themeBtn = $('#themeBtn');
  const applyThemeBtn = () => {
    themeBtn.innerHTML = document.documentElement.dataset.theme === 'dark' ? I.sun : I.moon;
  };
  applyThemeBtn();
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('sl-theme', dark ? 'light' : 'dark');
    applyThemeBtn();
  });

  const content = $('#content');
  if (page.narrow) content.classList.add('narrow');
  window.scrollTo(0, 0);
  page.render(content, $('#topActions'));
}

/* ---------------- auth screens ---------------- */

async function renderAuth(app) {
  const needsSetup = bootstrap?.needsSetup;
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-head">
          <div class="mark lg">${I.link}</div>
          <div class="auth-title">${esc(bootstrap?.site_name || 'ShortLink')}</div>
          <div class="auth-sub">${needsSetup ? '创建管理员账户以完成初始化' : '登录到管理控制台'}</div>
        </div>
        <form id="authForm" novalidate>
          ${needsSetup ? `<div class="field"><label>站点名称</label><input class="input" name="site_name" placeholder="ShortLink" maxlength="40" autocomplete="off"></div>` : ''}
          <div class="field"><label>用户名</label><input class="input" name="username" autocomplete="username webauthn" required></div>
          <div class="field"><label>密码</label><input class="input" type="password" name="password" autocomplete="${needsSetup ? 'new-password' : 'current-password'}" required></div>
          ${needsSetup ? `<div class="field"><label>确认密码</label><input class="input" type="password" name="password2" autocomplete="new-password" required></div>` : ''}
          <div class="field-error" id="authError" hidden></div>
          <button class="btn btn-primary btn-lg btn-block" id="authSubmit" style="margin-top:20px">${needsSetup ? '完成初始化' : '登录'}</button>
        </form>
        ${needsSetup ? '' : `
        <div class="auth-divider">或</div>
        <button class="btn btn-secondary btn-lg btn-block" id="passkeyBtn">${I.passkey} 使用通行密钥登录</button>`}
      </div>
      <p class="auth-foot">运行于 Cloudflare Workers · 数据存储于 D1</p>
    </div>`;

  const form = $('#authForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#authError');
    errEl.hidden = true;
    const fd = new FormData(form);
    const username = fd.get('username').trim();
    const password = fd.get('password');
    if (needsSetup) {
      if (password !== fd.get('password2')) return showAuthError('两次输入的密码不一致');
      try {
        await api('/api/setup', {
          method: 'POST',
          body: { username, password, site_name: fd.get('site_name') || 'ShortLink' },
        });
        bootstrap = await api('/api/bootstrap');
        document.title = bootstrap.site_name;
      } catch (err) {
        return showAuthError(err.message);
      }
    } else {
      try {
        await api('/api/auth/login', { method: 'POST', body: { username, password } });
      } catch (err) {
        return showAuthError(err.message);
      }
    }
    await loadMe();
    route('/');
  });

  const pk = $('#passkeyBtn');
  if (pk) pk.addEventListener('click', loginWithPasskey);

  function showAuthError(msg) {
    const errEl = $('#authError');
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = false;
  }
}

async function loginWithPasskey() {
  try {
    toast('请按照系统提示验证…', 'ok');
    const options = await api('/api/auth/passkey/options', { method: 'POST', body: {} });
    const getOptions = {
      challenge: b64u2buf(options.challenge),
      rpId: options.rpId,
      userVerification: options.userVerification || 'preferred',
      timeout: options.timeout || 120000,
    };
    if (options.allowCredentials) {
      getOptions.allowCredentials = options.allowCredentials.map((c) => ({
        id: b64u2buf(c.id),
        transports: c.transports,
      }));
    }
    const cred = await navigator.credentials.get({ publicKey: getOptions });
    const r = cred.response;
    await api('/api/auth/passkey/verify', {
      method: 'POST',
      body: {
        credential: {
          id: cred.id,
          rawId: buf2b64u(cred.rawId),
          type: cred.type,
          response: {
            clientDataJSON: buf2b64u(r.clientDataJSON),
            authenticatorData: buf2b64u(r.authenticatorData),
            signature: buf2b64u(r.signature),
            userHandle: r.userHandle ? buf2b64u(r.userHandle) : null,
          },
        },
      },
    });
    await loadMe();
    route('/');
  } catch (err) {
    if (err.name === 'NotAllowedError') toast('已取消或未识别到通行密钥', 'err');
    else toast(err.message || '通行密钥验证失败', 'err');
  }
}

/* ---------------- shared UI bits ---------------- */

async function loadMe() {
  const data = await api('/api/me');
  me = data.user;
}

function emptyHtml(icon, title, text = '', extra = '', cls = '') {
  return `<div class="empty ${cls}"><div class="ico">${I[icon]}</div><b>${title}</b>${text}${extra}</div>`;
}

function skeletonHtml(rows = 3) {
  const widths = [42, 78, 60, 70, 50];
  return `<div class="skel-rows">${Array.from({ length: rows }, (_, i) => `<div class="skeleton" style="width:${widths[i % widths.length]}%"></div>`).join('')}</div>`;
}

function errorHtml(err) {
  return `<div class="alert warn">${I.alert}<div>${esc(err.message)}</div></div>`;
}

function shortUrlHtml(url, hostname, code) {
  return `<span class="short-url"><a href="${esc(url)}" target="_blank" rel="noopener"><span class="host">${esc(hostname)}/</span>${esc(code)}</a>${copyBtnHtml(url, 'xs')}</span>`;
}

function pagerHtml(page, per, total) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (pages <= 1) return total ? `<div class="pager"><span>共 ${fmtNum(total)} 条</span></div>` : '';
  const prev = Math.max(1, page - 1);
  const next = Math.min(pages, page + 1);
  return `
  <div class="pager">
    <span>共 ${fmtNum(total)} 条 · 第 ${page}/${pages} 页</span>
    <div class="pages">
      <button class="btn btn-secondary btn-sm" data-page="${prev}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <button class="btn btn-secondary btn-sm" data-page="${next}" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>
  </div>`;
}

function parseUA(ua) {
  if (!ua) return { browser: '未知', os: '未知' };
  let browser = '其他';
  if (/bot|crawler|spider|curl|wget|python-requests/i.test(ua)) browser = '机器人';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = '其他';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}

function modeBadge(mode) {
  if (mode === 'page') return `<span class="badge badge-blue">${I.bolt} 动画页</span>`;
  if (mode === 'confirm') return `<span class="badge badge-orange">${I.shield} 确认页</span>`;
  return `<span class="badge badge-gray">直接跳转</span>`;
}

function statusBadge(link) {
  const s = link.effective_status || (link.enabled ? 'active' : 'disabled');
  if (s === 'active') return '<span class="status ok">启用</span>';
  if (s === 'disabled') return '<span class="status">停用</span>';
  return '<span class="status bad">已过期</span>';
}

function copyBtnHtml(text, cls = '') {
  return `<button class="icon-btn ${cls}" data-copy="${esc(text)}" title="复制" aria-label="复制">${I.copy}</button>`;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const ok = await copyText(btn.dataset.copy);
  toast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'ok' : 'err');
});

/* ---------------- dashboard ---------------- */

routes['/'] = {
  title: '概览',
  key: 'dashboard',
  async render(content) {
    content.innerHTML = `
      <div class="stat-grid">
        <div class="stat-tile"><div class="label">${I.link} 短链接</div><div class="value" id="stLinks">–</div><div class="delta" id="stLinksSub">&nbsp;</div></div>
        <div class="stat-tile"><div class="label">${I.bolt} 今日点击</div><div class="value" id="stToday">–</div><div class="delta">自 00:00 起</div></div>
        <div class="stat-tile"><div class="label">${I.chart} 近 7 日点击</div><div class="value" id="stWeek">–</div><div class="delta" id="stWeekSub">&nbsp;</div></div>
        <div class="stat-tile"><div class="label">${I.globe} 短链域名</div><div class="value" id="stDomains">–</div><div class="delta">${me.role === 'admin' ? '全部已绑定域名' : '可使用的域名'}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>近 14 日点击</h3><div class="right" id="chartSum"></div></div>
        <div id="chartBox">${skeletonHtml(3)}</div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h3>热门短链</h3><div class="right">近 7 日</div></div>
          <div id="topLinks">${skeletonHtml(3)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>最近访问</h3></div>
          <div id="recentList">${skeletonHtml(3)}</div>
        </div>
      </div>`;

    let data;
    try {
      data = await api('/api/stats');
    } catch (err) {
      content.innerHTML = errorHtml(err);
      return;
    }
    $('#stLinks').textContent = fmtNum(data.links_total);
    $('#stToday').textContent = fmtNum(data.clicks_today);
    $('#stWeek').textContent = fmtNum(data.clicks_7d);
    $('#stWeekSub').textContent = `近 30 日 ${fmtNum(data.clicks_30d)} 次`;
    $('#stDomains').textContent = fmtNum(data.domains_total);
    $('#stLinksSub').textContent = data.scope === 'own' ? '我创建的短链' : `全部用户 · 共 ${fmtNum(data.users_total)} 位用户`;

    renderChart($('#chartBox'), data.series);
    const top = $('#topLinks');
    top.innerHTML = data.top_links.length
      ? `<div class="hlist">${data.top_links
          .map(
            (t, i) => `
        <div class="hlist-item">
          <div class="rank">${i + 1}</div>
          <div class="grow"><div class="t1 mono"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.hostname)}/${esc(t.code)}</a></div>
          <div class="t2">累计 ${fmtNum(t.click_count)} 次点击</div></div>
          <div class="metric">${fmtNum(t.clicks_7d)}<small>次点击</small></div>
        </div>`
          )
          .join('')}</div>`
      : emptyHtml('chart', '暂无数据', '近 7 日还没有点击记录', '', 'sm');

    const recent = $('#recentList');
    recent.innerHTML = data.recent.length
      ? `<div class="hlist">${data.recent
          .map((r) => {
            const ua = parseUA(r.ua);
            return `
        <div class="hlist-item">
          <div class="grow"><div class="t1 mono">${esc(r.hostname)}/${esc(r.code)}</div>
          <div class="t2">${ua.browser} · ${ua.os} · ${esc(r.country || '未知地区')}${r.ip ? ' · ' + esc(r.ip) : ''}</div></div>
          <div class="side">${fmtRelative(r.ts)}</div>
        </div>`;
          })
          .join('')}</div>`
      : emptyHtml('inbox', '暂无访问', '访问记录将在这里显示', '', 'sm');
  },
};

function renderChart(box, series) {
  $$('.chart-tip').forEach((t) => t.remove());
  if (!series?.length) {
    box.innerHTML = emptyHtml('chart', '暂无数据', '还没有点击记录');
    return;
  }
  const max = Math.max(...series.map((d) => d.count), 1);
  // round the scale up to a friendly number so gridline labels read cleanly
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.max(4, Math.ceil(max / step) * step);
  const sum = series.reduce((a, b) => a + b.count, 0);
  const sumEl = $('#chartSum');
  if (sumEl) sumEl.textContent = `共 ${fmtNum(sum)} 次`;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  document.body.appendChild(tip);

  box.innerHTML = `
    <div class="chart" role="img" aria-label="近 14 日每日点击柱状图">
      <div class="chart-plot">
        ${[0.5, 1].map((f) => `<div class="chart-gridline" style="bottom:${f * 100}%"><span>${fmtNum(Math.round(top * f))}</span></div>`).join('')}
        ${series
          .map((d) => {
            const h = Math.round((d.count / top) * 100);
            const label = `${d.date.slice(5).replace('-', '/')} · ${d.count} 次点击`;
            return `<div class="bar-col${d.count === 0 ? ' zero' : ''}" data-tip="${esc(label)}" aria-label="${esc(label)}" role="img">
            <div class="bar" style="height:${h}%"></div>
          </div>`;
          })
          .join('')}
      </div>
      <div class="chart-x">
        ${series.map((d) => `<span>${d.date.slice(8)}</span>`).join('')}
      </div>
    </div>`;

  $$('.bar-col', box).forEach((col) => {
    col.addEventListener('mousemove', (e) => {
      tip.hidden = false;
      tip.textContent = col.dataset.tip;
      tip.style.left = `${e.clientX}px`;
      tip.style.top = `${e.clientY}px`;
    });
    col.addEventListener('mouseleave', () => (tip.hidden = true));
  });
}

/* ---------------- links ---------------- */

const linksState = { q: '', domain: '', status: '', mine: false, page: 1 };

routes['/links'] = {
  title: '短链接',
  key: 'links',
  async render(content, topActions) {
    const canCreate = me.role === 'admin' || me.perms?.create_links;
    const admin = me.role === 'admin';
    topActions.innerHTML = canCreate
      ? `<button class="btn btn-primary" id="newLinkBtn">${I.plus} 新建短链</button>`
      : '';

    let domains = [];
    try {
      domains = (await api('/api/domains')).items.filter((d) => d.can_use);
    } catch {}

    content.innerHTML = `
      <div class="card" id="linksCard">
        <div class="toolbar">
          <div class="search-box">${I.search}<input class="input" id="lq" placeholder="搜索后缀、目标链接或备注" value="${esc(linksState.q)}"></div>
          <select class="select" id="lDomain">
            <option value="">全部域名</option>
            ${domains.map((d) => `<option value="${d.id}" ${String(linksState.domain) === String(d.id) ? 'selected' : ''}>${esc(d.hostname)}</option>`).join('')}
          </select>
          <select class="select" id="lStatus">
            <option value="">全部状态</option>
            <option value="active" ${linksState.status === 'active' ? 'selected' : ''}>启用中</option>
            <option value="disabled" ${linksState.status === 'disabled' ? 'selected' : ''}>已停用</option>
            <option value="expired" ${linksState.status === 'expired' ? 'selected' : ''}>已过期</option>
          </select>
          ${admin ? `<div class="spacer"></div><div class="seg"><button class="${!linksState.mine ? 'on' : ''}" data-mine="">全部</button><button class="${linksState.mine ? 'on' : ''}" data-mine="1">我创建的</button></div>` : ''}
        </div>
        <div id="linksList"></div>
      </div>`;

    $('#lq').addEventListener('input', debounce((e) => { linksState.q = e.target.value; linksState.page = 1; loadList(); }, 350));
    $('#lDomain').addEventListener('change', (e) => { linksState.domain = e.target.value; linksState.page = 1; loadList(); });
    $('#lStatus').addEventListener('change', (e) => { linksState.status = e.target.value; linksState.page = 1; loadList(); });
    $$('.seg button', content).forEach((b) =>
      b.addEventListener('click', () => {
        linksState.mine = b.dataset.mine === '1';
        linksState.page = 1;
        $$('.seg button', content).forEach((x) => x.classList.toggle('on', x === b));
        loadList();
      })
    );
    if (canCreate) $('#newLinkBtn').addEventListener('click', () => openLinkEditor(null, domains, () => loadList()));

    async function loadList() {
      const box = $('#linksList');
      box.innerHTML = skeletonHtml(4);
      const params = new URLSearchParams();
      if (linksState.q) params.set('q', linksState.q);
      if (linksState.domain) params.set('domain_id', linksState.domain);
      if (linksState.status) params.set('status', linksState.status);
      if (linksState.mine) params.set('mine', '1');
      params.set('page', linksState.page);
      let data;
      try {
        data = await api('/api/links?' + params.toString());
      } catch (err) {
        box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
        return;
      }
      if (!data.items.length) {
        const filtered = linksState.q || linksState.domain || linksState.status;
        box.innerHTML = emptyHtml(
          'link',
          filtered ? '没有匹配的短链' : '还没有短链',
          filtered ? '换个关键词或筛选条件试试' : canCreate ? '创建你的第一条短链吧' : '请联系管理员获取权限',
          canCreate && !filtered ? `<div><button class="btn btn-primary" id="emptyNew">${I.plus} 新建短链</button></div>` : ''
        );
        $('#emptyNew')?.addEventListener('click', () => openLinkEditor(null, domains, () => loadList()));
        return;
      }
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>短链</th><th>目标</th><th>跳转</th><th>状态</th><th class="num">点击</th><th>创建</th><th class="w-actions"></th></tr></thead>
        <tbody>
          ${data.items
            .map(
              (l) => `
          <tr>
            <td class="cell-main">
              ${shortUrlHtml(l.url, l.domain?.hostname || new URL(l.url).host, l.code)}
              ${l.note ? `<div class="cell-sub truncate" title="${esc(l.note)}">${esc(l.note)}</div>` : ''}
            </td>
            <td class="clean cell-block"><div class="truncate" title="${esc(l.target)}"><a class="target-link" href="${esc(l.target)}" target="_blank" rel="noopener">${esc(l.target)}</a></div></td>
            <td class="clean hide-md">${modeBadge(l.mode)}</td>
            <td class="clean">${statusBadge(l)}</td>
            <td data-th="点击" class="num">${fmtNum(l.click_count)}${l.clicks_7d ? `<div class="cell-sub hide-sm">7 日 ${fmtNum(l.clicks_7d)}</div>` : ''}</td>
            <td data-th="创建" class="nowrap dim">${fmtDate(l.created_at, false)}${admin ? `<div class="cell-sub hide-sm">${esc(l.owner?.username || '—')}</div>` : ''}</td>
            <td class="cell-actions"><div class="row-actions">
              <button class="icon-btn" data-edit='${esc(JSON.stringify(l.id))}' title="编辑" aria-label="编辑">${I.pencil}</button>
              <button class="icon-btn" data-menu="${l.id}" title="更多" aria-label="更多">${I.dots}</button>
            </div></td>
          </tr>`
            )
            .join('')}
        </tbody></table></div>
        ${pagerHtml(data.page, data.per_page, data.total)}`;

      const byId = new Map(data.items.map((l) => [String(l.id), l]));
      const canViewLog = admin || me.perms?.view_logs;
      $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => openLinkEditor(byId.get(b.dataset.edit), domains, loadList)));
      $$('[data-menu]', box).forEach((b) =>
        b.addEventListener('click', () => {
          const l = byId.get(b.dataset.menu);
          openMenu(b, [
            ...(canViewLog ? [{ label: '访问记录', icon: I.clock, action: () => openLinkLogs(l) }] : []),
            { label: '复制短链', icon: I.copy, action: async () => (await copyText(l.url)) && toast('已复制') },
            { label: '打开目标', icon: I.external, action: () => window.open(l.target, '_blank', 'noopener') },
            '-',
            {
              label: l.enabled ? '停用' : '启用',
              icon: l.enabled ? I.x : I.check,
              action: async () => {
                try {
                  await api(`/api/links/${l.id}`, { method: 'PATCH', body: { enabled: !l.enabled } });
                  toast(l.enabled ? '已停用' : '已启用');
                  loadList();
                } catch (err) { toast(err.message, 'err'); }
              },
            },
            { label: '删除', icon: I.trash, danger: true, action: async () => {
              const ok = await confirmDialog({ title: '删除短链', message: `确定删除 <b>${esc(l.code)}</b> 吗？其访问记录也会一并删除，此操作不可撤销。`, okText: '删除', danger: true });
              if (!ok) return;
              try {
                await api(`/api/links/${l.id}`, { method: 'DELETE' });
                toast('已删除');
                loadList();
              } catch (err) { toast(err.message, 'err'); }
            } },
          ]);
        })
      );
      $$('[data-page]', box).forEach((b) =>
        b.addEventListener('click', () => {
          linksState.page = Number(b.dataset.page);
          loadList();
        })
      );
    }
    loadList();
  },
};

const ANIMS = [
  { value: 'orbit', label: '轨道环绕' },
  { value: 'progress', label: '进度条' },
  { value: 'pulse', label: '脉冲扩散' },
  { value: 'fade', label: '淡入' },
];

const MODES = [
  { value: 'direct', label: '直接跳转', hint: '302 重定向，最快' },
  { value: 'page', label: '动画中转页', hint: '展示一段跳转动画后再前往目标' },
  { value: 'confirm', label: '确认页', hint: '访客确认目的地后手动继续' },
];

function modeSegHtml(mode) {
  return `<div class="seg block">${MODES.map((m) => `<button type="button" class="${mode === m.value ? 'on' : ''}" data-mode="${m.value}">${m.label}</button>`).join('')}</div>
    <div class="field-hint" data-mode-hint>${MODES.find((m) => m.value === mode)?.hint || ''}</div>`;
}

function styleEditorHtml(mode, style) {
  style = style || {};
  const color = style.color || '#0a84ff';
  const colorField = `<div class="field"><label>强调色</label><input type="color" class="color-input" name="st_color" value="${esc(color)}"></div>`;
  if (mode === 'page') {
    return `
      <div class="form-grid">
        <div class="field"><label>动画样式</label>
          <select class="select" name="st_animation">${ANIMS.map((a) => `<option value="${a.value}" ${style.animation === a.value ? 'selected' : ''}>${a.label}</option>`).join('')}</select>
        </div>
        ${colorField}
      </div>
      <div class="field"><label>停留时长 <span class="opt">· <span name="durLabel">${style.duration || 1200}</span> ms</span></label>
        <input type="range" min="500" max="5000" step="100" value="${style.duration || 1200}" name="st_duration">
      </div>
      <div class="field"><label>标题 <span class="opt">可选</span></label><input class="input" name="st_title" value="${esc(style.title || '')}" placeholder="即将跳转" maxlength="80"></div>
      <div class="field"><label>说明文字 <span class="opt">可选</span></label><input class="input" name="st_desc" value="${esc(style.desc || '')}" placeholder="正在为您跳转到目标地址" maxlength="140"></div>`;
  }
  if (mode === 'confirm') {
    return `
      <div class="form-grid">
        <div class="field"><label>按钮文字 <span class="opt">可选</span></label><input class="input" name="st_button" value="${esc(style.button || '')}" placeholder="继续访问" maxlength="30"></div>
        ${colorField}
      </div>
      <div class="field"><label>标题 <span class="opt">可选</span></label><input class="input" name="st_title" value="${esc(style.title || '')}" placeholder="即将离开本站" maxlength="80"></div>
      <div class="field"><label>说明文字 <span class="opt">可选</span></label><input class="input" name="st_desc" value="${esc(style.desc || '')}" placeholder="您将前往以下外部链接，请确认目的地后继续。" maxlength="140"></div>`;
  }
  return '';
}

function readStyle(root) {
  const g = (n) => root.querySelector(`[name="${n}"]`);
  return {
    animation: g('st_animation')?.value,
    duration: g('st_duration') ? Number(g('st_duration').value) : undefined,
    title: g('st_title')?.value || null,
    desc: g('st_desc')?.value || null,
    button: g('st_button')?.value || null,
    color: g('st_color')?.value || null,
  };
}

// wires a mode segmented control + style sub-panel; returns a getter for the current mode
function bindModePicker(root, initialMode, getStyle) {
  let mode = initialMode;
  $$('[data-mode]', root).forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $$('[data-mode]', root).forEach((x) => x.classList.toggle('on', x === b));
      $('[data-mode-hint]', root).textContent = MODES.find((m) => m.value === mode)?.hint || '';
      $('#styleBox', root).innerHTML = styleEditorHtml(mode, getStyle());
    })
  );
  root.addEventListener('input', (e) => {
    if (e.target.name === 'st_duration') $('[name="durLabel"]', root).textContent = e.target.value;
  });
  return () => mode;
}

function openLinkEditor(link, domains, onSaved) {
  const isNew = !link;
  const settings = bootstrap?.settings || {};
  const d = link
    ? { ...link }
    : {
        domain_id: domains[0]?.id,
        code: '',
        random_length: 6,
        target: '',
        note: '',
        mode: settings.default_mode || 'direct',
        style: settings.default_style || {},
        expires_at: null,
      };
  // apply domain default prefill for new links
  if (isNew && domains[0]?.defaults?.mode) d.mode = domains[0].defaults.mode;
  if (isNew && domains[0]?.defaults?.style) d.style = { ...domains[0].defaults.style };

  const m = openModal({
    title: isNew ? '新建短链' : `编辑 ${link.code}`,
    wide: true,
    body: `
      <form id="linkForm" novalidate>
        <div class="form-section">
          <div class="field"><label>目标链接</label>
            <input class="input" name="target" type="url" required placeholder="https://example.com/very/long/url" value="${esc(d.target)}">
          </div>
          <div class="field"><label>短链地址</label>
            <div class="joined">
              <select class="select" name="domain_id" aria-label="域名">
                ${domains.map((dm) => `<option value="${dm.id}" ${d.domain_id === dm.id || d.domain?.id === dm.id ? 'selected' : ''}>${esc(dm.hostname)}</option>`).join('')}
              </select>
              <span class="sep">/</span>
              <input class="input mono" name="code" value="${esc(d.code || '')}" placeholder="留空自动生成" maxlength="64" autocapitalize="off" spellcheck="false" aria-label="后缀">
              <button type="button" class="icon-btn" id="rollBtn" title="随机生成" aria-label="随机生成">${I.refresh}</button>
            </div>
            <div class="field-hint" id="codeHint">${isNew ? '留空将自动生成随机后缀；自定义支持字母、数字、下划线和连字符' : '支持字母、数字、下划线、连字符'}</div>
          </div>
          <div class="form-grid">
            <div class="field"><label>备注 <span class="opt">可选</span></label><input class="input" name="note" value="${esc(d.note || '')}" maxlength="200" placeholder="这条链接的用途"></div>
            <div class="field"><label>过期时间 <span class="opt">可选</span></label>
              <input class="input" name="expires_at" type="datetime-local" value="${d.expires_at ? new Date(d.expires_at - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">
            </div>
          </div>
          ${isNew ? `<div class="field"><label>随机后缀长度</label>
            <select class="select" name="random_length" style="max-width:160px">${[4, 5, 6, 7, 8, 10].map((n) => `<option value="${n}" ${n === (d.random_length || 6) ? 'selected' : ''}>${n} 位</option>`).join('')}</select>
          </div>` : ''}
        </div>
        <div class="form-section">
          <div class="form-section-title">跳转方式</div>
          ${modeSegHtml(d.mode)}
          <div class="subpanel" id="styleBox">${styleEditorHtml(d.mode, d.style)}</div>
        </div>
        <div class="field-error" id="linkErr" hidden></div>
      </form>`,
    footer: `
      <button class="btn btn-secondary" data-close>取消</button>
      <button class="btn btn-primary" id="linkSave">${isNew ? '创建' : '保存'}</button>`,
  });

  const root = m.root;
  const getMode = bindModePicker(root, d.mode, () => ({ ...d.style, ...readStyle(root) }));

  // random code generator + availability check
  const ALPHA = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const codeInput = $('[name="code"]', root);
  const lenOf = () => Number($('[name="random_length"]', root)?.value) || 6;
  const roll = () => Array.from(crypto.getRandomValues(new Uint8Array(lenOf())), (b) => ALPHA[b % ALPHA.length]).join('');
  const hint = $('#codeHint', root);
  const defaultHint = hint.textContent;
  const setHint = (text, color = '') => {
    hint.textContent = text;
    hint.style.color = color;
  };
  const checkCode = debounce(async () => {
    const code = codeInput.value.trim();
    if (!code) return setHint(defaultHint);
    if (!isNew && code === link.code) return setHint(defaultHint);
    const domainId = Number($('[name="domain_id"]', root).value);
    try {
      const r = await api(`/api/code-check?domain_id=${domainId}&code=${encodeURIComponent(code)}`);
      if (r.reason === 'taken') setHint('该后缀已被使用', 'var(--red)');
      else if (r.reason === 'invalid' || r.reason === 'reserved') setHint('后缀不可用', 'var(--red)');
      else setHint('后缀可用', 'var(--green)');
    } catch {}
  }, 400);
  $('#rollBtn', root).addEventListener('click', () => {
    codeInput.value = roll();
    checkCode();
  });
  codeInput.addEventListener('input', checkCode);
  $('[name="domain_id"]', root).addEventListener('change', checkCode);
  setTimeout(() => $('[name="target"]', root).focus(), 50);

  $('#linkSave', root).addEventListener('click', async () => {
    const errEl = $('#linkErr', root);
    errEl.hidden = true;
    const body = {
      target: $('[name="target"]', root).value.trim(),
      domain_id: Number($('[name="domain_id"]', root).value),
      note: $('[name="note"]', root).value.trim(),
      mode: getMode(),
      style: readStyle(root),
      expires_at: $('[name="expires_at"]', root).value || null,
      random_length: lenOf(),
    };
    const code = codeInput.value.trim();
    if (code) body.code = code;
    try {
      if (isNew) {
        const created = await api('/api/links', { method: 'POST', body });
        toast('短链已创建');
        m.close();
        showCreated(created.item);
      } else {
        await api(`/api/links/${link.id}`, { method: 'PATCH', body });
        toast('已保存');
        m.close();
        onSaved?.();
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  function showCreated(item) {
    const c = openModal({
      title: '创建成功',
      body: `
        <div class="success-box">
          <div class="tick">${I.check}</div>
          <div class="code-pill">${esc(item.url)}</div>
          <p>→ ${esc(item.target)}</p>
        </div>`,
      footer: `
        <button class="btn btn-secondary" data-close>关闭</button>
        <button class="btn btn-primary" id="copyNew">${I.copy} 复制链接</button>`,
    });
    $('#copyNew', c.root).addEventListener('click', async () => {
      (await copyText(item.url)) && toast('已复制到剪贴板');
    });
    onSaved?.();
  }
}

function logRowsHtml(items, withLink) {
  return items
    .map((g) => {
      const ua = parseUA(g.ua);
      const ref = g.referer ? safeHost(g.referer) : '直接访问';
      return `<tr>
        ${withLink ? `<td class="cell-main">${shortUrlHtml(`https://${g.hostname}/${g.code}`, g.hostname, g.code)}</td>` : ''}
        <td class="nowrap dim ${withLink ? '' : 'cell-main'}">${fmtDate(g.ts)}</td>
        <td data-th="IP" class="nowrap"><span class="mono-num">${esc(g.ip || '—')}</span></td>
        <td class="nowrap clean">${esc(g.country || '—')}${g.city ? ' · ' + esc(g.city) : ''}</td>
        <td class="nowrap clean">${ua.browser} / ${ua.os}</td>
        <td data-th="来源" class="dim hide-md"><div class="truncate" style="max-width:160px" title="${esc(g.referer || '')}">${esc(ref)}</div></td>
        ${withLink ? '' : `<td class="clean">${g.status === 'hit' ? '<span class="status ok">已跳转</span>' : `<span class="status warn">${g.status === 'expired' ? '已过期' : '已停用'}</span>`}</td>`}
      </tr>`;
    })
    .join('');
}

function safeHost(u) {
  try { return new URL(u).hostname; } catch { return u; }
}

function openLinkLogs(link) {
  const state = { page: 1 };
  const m = openModal({
    title: `访问记录 · ${link.code}`,
    wide: true,
    body: `<div id="logBox"></div>`,
    footer: `<a class="btn btn-secondary" href="/api/links/${link.id}/logs.csv" download style="margin-right:auto">${I.download} 导出 CSV</a><button class="btn btn-secondary" data-close>关闭</button>`,
  });
  $('.modal-body', m.root).classList.add('flush');
  async function load() {
    const box = $('#logBox', m.root);
    box.innerHTML = skeletonHtml(3);
    let data;
    try {
      data = await api(`/api/links/${link.id}/logs?page=${state.page}&per=15`);
    } catch (err) {
      box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
      return;
    }
    if (!data.items.length) {
      box.innerHTML = emptyHtml('inbox', '暂无访问', '这个短链还没有被访问过');
      return;
    }
    box.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>时间</th><th>IP</th><th>位置</th><th>客户端</th><th class="hide-md">来源</th><th>结果</th></tr></thead>
        <tbody>${logRowsHtml(data.items, false)}</tbody></table></div>
      ${pagerHtml(data.page, data.per_page, data.total)}`;
    $$('[data-page]', box).forEach((b) =>
      b.addEventListener('click', () => {
        state.page = Number(b.dataset.page);
        load();
      })
    );
  }
  load();
}

/* ---------------- domains ---------------- */

routes['/domains'] = {
  title: '域名',
  key: 'domains',
  async render(content, topActions) {
    const admin = me.role === 'admin';
    topActions.innerHTML = admin ? `<button class="btn btn-primary" id="addDomainBtn">${I.plus} 绑定域名</button>` : '';

    async function load() {
      let data;
      try {
        data = await api('/api/domains');
      } catch (err) {
        content.innerHTML = errorHtml(err);
        return;
      }
      content.innerHTML = `
        ${admin ? `<details class="note"${data.items.length ? '' : ' open'}>
          <summary>${I.info} 如何接入新域名${I.chevRight.replace('<svg', '<svg class="chev"')}</summary>
          <div class="note-body"><ol>
            <li>将域名接入 Cloudflare。</li>
            <li>在 Worker 的 <b>设置 → 域名和路由</b> 中添加「自定义域」，指向本 Worker。</li>
            <li>回到这里点击「绑定域名」登记。管理域名用于访问控制台，短链域名用于生成链接。</li>
          </ol></div>
        </details>` : ''}
        <div class="card">
          ${data.items.length ? `
          <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>域名</th><th>用途</th><th class="num">短链数</th><th>默认跳转</th><th>绑定时间</th>${admin ? '<th class="w-actions"></th>' : ''}</tr></thead>
          <tbody>
            ${data.items
              .map(
                (d) => `
              <tr>
                <td class="cell-main"><b>${esc(d.hostname)}</b>${d.remark ? `<div class="cell-sub">${esc(d.remark)}</div>` : ''}</td>
                <td class="clean">${d.is_admin ? '<span class="badge badge-blue">管理域名</span>' : '<span class="badge badge-gray">短链域名</span>'}</td>
                <td data-th="短链" class="num">${fmtNum(d.link_count)}</td>
                <td class="clean hide-sm">${d.is_admin ? '<span class="dim">—</span>' : modeBadge(d.defaults?.mode || 'direct')}</td>
                <td data-th="绑定于" class="nowrap dim">${fmtDate(d.created_at, false)}</td>
                ${admin ? `<td class="cell-actions"><div class="row-actions">
                  <button class="icon-btn" data-dedit="${d.id}" title="编辑" aria-label="编辑">${I.pencil}</button>
                  <button class="icon-btn danger" data-ddel="${d.id}" title="删除" aria-label="删除">${I.trash}</button>
                </div></td>` : ''}
              </tr>`
              )
              .join('')}
          </tbody></table></div>` : emptyHtml('globe', '还没有域名', admin ? '按照上方步骤接入第一个短链域名' : '请联系管理员分配域名')}
        </div>`;
      const byId = new Map(data.items.map((d) => [String(d.id), d]));
      if (admin) {
        $$('[data-dedit]', content).forEach((b) => b.addEventListener('click', () => openDomainEditor(byId.get(b.dataset.dedit), load)));
        $$('[data-ddel]', content).forEach((b) =>
          b.addEventListener('click', async () => {
            const d = byId.get(b.dataset.ddel);
            const count = d.link_count || 0;
            const ok = await confirmDialog({
              title: '删除域名',
              message: `确定删除 <b>${esc(d.hostname)}</b> 吗？${count ? `该域名下还有 <b>${count}</b> 条短链，删除后将无法访问（记录保留，可稍后手动清理）。` : ''}`,
              okText: '删除',
              danger: true,
            });
            if (!ok) return;
            try {
              await api(`/api/domains/${d.id}`, { method: 'DELETE' });
              toast('域名已删除');
              load();
            } catch (err) {
              toast(err.message, 'err');
            }
          })
        );
      }
    }

    $('#addDomainBtn')?.addEventListener('click', () => openDomainEditor(null, load));
    load();
  },
};

function openDomainEditor(domain, onSaved) {
  const isNew = !domain;
  const d = domain || { defaults: {} };
  const initialMode = d.defaults?.mode || 'direct';
  const m = openModal({
    title: isNew ? '绑定域名' : `编辑 ${domain.hostname}`,
    wide: true,
    body: `
      <form id="domForm" novalidate>
        <div class="form-section">
          ${isNew ? `<div class="field"><label>域名</label>
            <input class="input" name="hostname" placeholder="s.example.com" autocapitalize="off" spellcheck="false">
            <div class="field-hint">需先在 Cloudflare 为该域名添加指向本 Worker 的自定义域</div>
          </div>` : ''}
          <div class="field"><label>备注 <span class="opt">可选</span></label><input class="input" name="remark" value="${esc(d.remark || '')}" maxlength="200" placeholder="这个域名的用途"></div>
          <label class="toggle-row">
            <div class="txt"><b>作为管理域名</b><span>此域名用于访问管理控制台，而非生成短链${isNew ? '' : '（创建后不可修改）'}</span></div>
            <span class="switch"><input type="checkbox" name="is_admin" ${d.is_admin ? 'checked' : ''} ${isNew ? '' : 'disabled'}><i></i></span>
          </label>
        </div>
        <div class="form-section">
          <div class="form-section-title">默认跳转方式<span>在此域名下新建短链时预填</span></div>
          ${modeSegHtml(initialMode)}
          <div class="subpanel" id="styleBox">${styleEditorHtml(initialMode, d.defaults?.style || {})}</div>
        </div>
        <div class="field-error" id="domErr" hidden></div>
      </form>`,
    footer: `
      <button class="btn btn-secondary" data-close>取消</button>
      <button class="btn btn-primary" id="domSave">${isNew ? '绑定' : '保存'}</button>`,
  });
  const root = m.root;
  const getMode = bindModePicker(root, initialMode, () => ({ ...(d.defaults?.style || {}), ...readStyle(root) }));
  $('#domSave', root).addEventListener('click', async () => {
    const errEl = $('#domErr', root);
    errEl.hidden = true;
    const body = {
      remark: $('[name="remark"]', root).value.trim(),
      defaults: { mode: getMode(), style: readStyle(root) },
    };
    if (isNew) {
      body.hostname = $('[name="hostname"]', root).value.trim();
      body.is_admin = $('[name="is_admin"]', root).checked;
    }
    try {
      if (isNew) await api('/api/domains', { method: 'POST', body });
      else await api(`/api/domains/${domain.id}`, { method: 'PATCH', body });
      toast(isNew ? '域名已绑定' : '已保存');
      m.close();
      onSaved?.();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}

/* ---------------- global logs ---------------- */

routes['/logs'] = {
  title: '访问记录',
  key: 'logs',
  adminOnly: true,
  async render(content) {
    const state = { page: 1, q: '', domain: '' };
    let domains = [];
    try {
      domains = (await api('/api/domains')).items;
    } catch {}
    content.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="search-box">${I.search}<input class="input" id="gq" placeholder="搜索短链、IP 或 UA"></div>
          <select class="select" id="gDomain">
            <option value="">全部域名</option>
            ${domains.map((d) => `<option value="${d.id}">${esc(d.hostname)}</option>`).join('')}
          </select>
        </div>
        <div id="glogBox"></div>
      </div>`;
    $('#gq').addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 1; load(); }, 350));
    $('#gDomain').addEventListener('change', (e) => { state.domain = e.target.value; state.page = 1; load(); });

    async function load() {
      const box = $('#glogBox');
      box.innerHTML = skeletonHtml(4);
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.domain) params.set('domain_id', state.domain);
      params.set('page', state.page);
      let data;
      try {
        data = await api('/api/logs?' + params.toString());
      } catch (err) {
        box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
        return;
      }
      if (!data.items.length) {
        box.innerHTML = emptyHtml('inbox', '暂无记录', state.q || state.domain ? '没有匹配的访问记录' : '还没有任何访问记录');
        return;
      }
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>短链</th><th>时间</th><th>IP</th><th>位置</th><th>客户端</th><th class="hide-md">来源</th></tr></thead>
        <tbody>${logRowsHtml(data.items, true)}</tbody></table></div>
        ${pagerHtml(data.page, data.per_page, data.total)}`;
      $$('[data-page]', box).forEach((b) => b.addEventListener('click', () => { state.page = Number(b.dataset.page); load(); }));
    }
    load();
  },
};

/* ---------------- users ---------------- */

routes['/users'] = {
  title: '用户',
  key: 'users',
  adminOnly: true,
  async render(content, topActions) {
    topActions.innerHTML = `<button class="btn btn-primary" id="addUserBtn">${I.plus} 新建用户</button>`;

    async function load() {
      let data;
      try {
        data = await api('/api/users');
      } catch (err) {
        content.innerHTML = errorHtml(err);
        return;
      }
      content.innerHTML = `
        <div class="card">
          <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>用户</th><th>角色</th><th>域名范围</th><th class="num">短链 / 配额</th><th class="hide-md">登录方式</th><th>状态</th><th class="w-actions"></th></tr></thead>
          <tbody>
            ${data.items
              .map((u) => {
                const scope = u.role === 'admin' ? '全部域名' : u.domain_ids.length ? `${u.domain_ids.length} 个域名` : '无';
                const quota = u.role === 'admin' || u.quota_max_links === 0 ? `${fmtNum(u.link_count)} / 不限` : `${fmtNum(u.link_count)} / ${fmtNum(u.quota_max_links)}`;
                const auth = [u.has_password ? '密码' : null, u.passkey_count ? `通行密钥 ×${u.passkey_count}` : null].filter(Boolean).join(' · ') || '—';
                return `<tr>
                  <td class="cell-main"><div style="display:flex;align-items:center;gap:10px">
                    <div class="avatar sm">${esc((u.display_name || u.username)[0].toUpperCase())}</div>
                    <div style="min-width:0"><b>${esc(u.username)}</b>${u.display_name && u.display_name !== u.username ? `<div class="cell-sub">${esc(u.display_name)}</div>` : ''}</div>
                  </div></td>
                  <td class="clean">${u.role === 'admin' ? '<span class="badge badge-blue">管理员</span>' : '<span class="badge badge-gray">成员</span>'}</td>
                  <td data-th="域名" class="dim">${scope}</td>
                  <td data-th="短链" class="num">${quota}</td>
                  <td class="dim hide-md">${auth}</td>
                  <td class="clean">${u.disabled ? '<span class="status bad">已停用</span>' : '<span class="status ok">正常</span>'}</td>
                  <td class="cell-actions"><div class="row-actions">
                    <button class="icon-btn" data-uedit="${u.id}" title="编辑" aria-label="编辑">${I.pencil}</button>
                    ${u.id === me.id ? '' : `<button class="icon-btn danger" data-udel="${u.id}" title="删除" aria-label="删除">${I.trash}</button>`}
                  </div></td>
                </tr>`;
              })
              .join('')}
          </tbody></table></div>
        </div>`;
      const byId = new Map(data.items.map((u) => [String(u.id), u]));
      $$('[data-uedit]', content).forEach((b) => b.addEventListener('click', () => openUserEditor(byId.get(b.dataset.uedit), load)));
      $$('[data-udel]', content).forEach((b) =>
        b.addEventListener('click', async () => {
          const u = byId.get(b.dataset.udel);
          const ok = await confirmDialog({
            title: '删除用户',
            message: `确定删除用户 <b>${esc(u.username)}</b> 吗？其会话、通行密钥与 API 密钥将被清除，创建的短链保留（转为无主）。`,
            okText: '删除',
            danger: true,
          });
          if (!ok) return;
          try {
            await api(`/api/users/${u.id}`, { method: 'DELETE' });
            toast('用户已删除');
            load();
          } catch (err) {
            toast(err.message, 'err');
          }
        })
      );
    }
    $('#addUserBtn').addEventListener('click', () => openUserEditor(null, load));
    load();
  },
};

function openUserEditor(user, onSaved) {
  const isNew = !user;
  const u = user || { perms: { create_links: true, view_logs: true, use_api: true }, domain_ids: [], quota_max_links: 100, role: 'user' };
  const self = !isNew && user.id === me.id;

  let domains = [];
  openModalAsync();

  async function openModalAsync() {
    try {
      domains = (await api('/api/domains')).items.filter((d) => !d.is_admin);
    } catch {}
    const m = openModal({
      title: isNew ? '新建用户' : `编辑 ${user.username}`,
      wide: true,
      body: `
        <form id="userForm" novalidate>
          <div class="form-section">
            <div class="form-grid">
              <div class="field"><label>用户名</label>
                <input class="input" name="username" value="${esc(u.username || '')}" ${isNew ? '' : 'disabled'} autocapitalize="off" spellcheck="false" placeholder="alice">
              </div>
              <div class="field"><label>显示名称 <span class="opt">可选</span></label><input class="input" name="display_name" value="${esc(u.display_name || '')}" maxlength="60"></div>
            </div>
            <div class="form-grid">
              <div class="field"><label>${isNew ? '初始密码' : '重置密码'} ${isNew ? '' : '<span class="opt">留空则不修改</span>'}</label>
                <input class="input" type="password" name="password" autocomplete="new-password" placeholder="至少 8 位">
              </div>
              <div class="field"><label>角色</label>
                <div class="seg block">
                  <button type="button" class="${u.role !== 'admin' ? 'on' : ''}" data-role="user">普通用户</button>
                  <button type="button" class="${u.role === 'admin' ? 'on' : ''}" data-role="admin" ${self ? 'disabled' : ''}>管理员</button>
                </div>
              </div>
            </div>
          </div>
          <div id="userPerms">
            <div class="form-section">
              <div class="form-section-title">功能权限</div>
              <div class="check-list">
                <label class="check-row"><input type="checkbox" name="p_create" ${u.perms?.create_links ? 'checked' : ''}><span>创建与管理自己的短链</span></label>
                <label class="check-row"><input type="checkbox" name="p_logs" ${u.perms?.view_logs ? 'checked' : ''}><span>查看自己短链的访问记录</span></label>
                <label class="check-row"><input type="checkbox" name="p_api" ${u.perms?.use_api ? 'checked' : ''}><span>使用 API</span><span class="sub">创建密钥调用 /api/v1</span></label>
              </div>
            </div>
            <div class="form-section">
              <div class="form-section-title">可用域名</div>
              ${domains.length
                ? `<div class="check-list">${domains.map((d) => `<label class="check-row"><input type="checkbox" name="dom_${d.id}" ${u.role === 'admin' || u.domain_ids?.includes(d.id) ? 'checked' : ''}><span>${esc(d.hostname)}</span>${d.remark ? `<span class="sub">${esc(d.remark)}</span>` : ''}</label>`).join('')}</div>`
                : '<p class="field-hint">还没有可用的短链域名</p>'}
              <div class="field" style="margin-top:16px"><label>短链数量上限 <span class="opt">0 表示不限</span></label>
                <input class="input" type="number" name="quota" min="0" max="1000000" value="${u.quota_max_links ?? 100}" style="max-width:160px">
              </div>
            </div>
          </div>
          ${!self ? `
          <div class="form-section">
            <label class="toggle-row">
              <div class="txt"><b>停用账户</b><span>停用后无法登录，现有会话立即失效</span></div>
              <span class="switch"><input type="checkbox" name="disabled" ${u.disabled ? 'checked' : ''}><i></i></span>
            </label>
          </div>` : ''}
          <div class="field-error" id="userErr" hidden></div>
        </form>`,
      footer: `
        <button class="btn btn-secondary" data-close>取消</button>
        <button class="btn btn-primary" id="userSave">${isNew ? '创建' : '保存'}</button>`,
    });
    const root = m.root;
    let role = u.role;
    $$('[data-role]', root).forEach((b) =>
      b.addEventListener('click', () => {
        role = b.dataset.role;
        $$('[data-role]', root).forEach((x) => x.classList.toggle('on', x === b));
        $('#userPerms', root).hidden = role === 'admin';
      })
    );
    if (u.role === 'admin') $('#userPerms', root).hidden = true;

    $('#userSave', root).addEventListener('click', async () => {
      const errEl = $('#userErr', root);
      errEl.hidden = true;
      const body = {
        display_name: $('[name="display_name"]', root).value.trim(),
        role,
        perms: {
          create_links: $('[name="p_create"]', root).checked,
          view_logs: $('[name="p_logs"]', root).checked,
          use_api: $('[name="p_api"]', root).checked,
        },
        domain_ids: domains.filter((d) => $(`[name="dom_${d.id}"]`, root)?.checked).map((d) => d.id),
        quota_max_links: Number($('[name="quota"]', root).value) || 0,
        disabled: $('[name="disabled"]', root)?.checked || false,
      };
      const pw = $('[name="password"]', root).value;
      if (pw) body.password = pw;
      if (isNew && role === 'user' && !pw) {
        errEl.textContent = '普通用户必须设置初始密码';
        errEl.hidden = false;
        return;
      }
      try {
        if (isNew) await api('/api/users', { method: 'POST', body: { ...body, username: $('[name="username"]', root).value.trim() } });
        else await api(`/api/users/${user.id}`, { method: 'PATCH', body });
        toast(isNew ? '用户已创建' : '已保存');
        m.close();
        onSaved?.();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  }
}

/* ---------------- api keys ---------------- */

routes['/keys'] = {
  title: 'API 密钥',
  key: 'keys',
  async render(content, topActions) {
    const canApi = me.role === 'admin' || me.perms?.use_api;
    topActions.innerHTML =
      `<a class="btn btn-secondary" href="/docs" target="_blank">${I.doc} API 文档</a>` +
      (canApi ? `<button class="btn btn-primary" id="addKeyBtn">${I.plus} 创建密钥</button>` : '');

    async function load() {
      let data;
      try {
        data = await api('/api/keys');
      } catch (err) {
        content.innerHTML = errorHtml(err);
        return;
      }
      if (!data.items.length) {
        content.innerHTML = `<div class="card">${emptyHtml(
          'key',
          '还没有 API 密钥',
          canApi ? '创建密钥后即可通过 /api/v1 接口管理短链' : '当前账户没有 API 权限',
          canApi ? `<div><button class="btn btn-primary" id="emptyKey">${I.plus} 创建密钥</button></div>` : ''
        )}</div>`;
        $('#emptyKey')?.addEventListener('click', () => openKeyEditor(load));
        return;
      }
      content.innerHTML = `
        <div class="card">
          <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>名称</th><th>权限</th><th>最近使用</th><th>过期</th>${me.role === 'admin' ? '<th class="hide-md">所有者</th>' : ''}<th class="w-actions"></th></tr></thead>
          <tbody>
            ${data.items
              .map((k) => `
            <tr>
              <td class="cell-main"><b>${esc(k.name)}</b><div class="cell-sub" style="font-family:var(--mono)">${esc(k.prefix)}…</div></td>
              <td class="clean cell-block"><div class="chip-row">${k.scopes.map((s) => `<span class="badge badge-gray">${esc(s)}</span>`).join('')}</div></td>
              <td data-th="最近使用" class="nowrap dim">${k.last_used_at ? fmtRelative(k.last_used_at) : '从未'}</td>
              <td data-th="过期" class="nowrap dim">${k.expires_at ? (k.expires_at < Date.now() ? '<span class="status bad">已过期</span>' : fmtDate(k.expires_at, false)) : '永不过期'}</td>
              ${me.role === 'admin' ? `<td class="dim hide-md">${esc(k.owner?.username || '—')}${k.mine ? ' <span class="badge badge-blue">我</span>' : ''}</td>` : ''}
              <td class="cell-actions"><div class="row-actions">
                <button class="icon-btn danger" data-kdel="${k.id}" title="吊销" aria-label="吊销">${I.trash}</button>
              </div></td>
            </tr>`)
              .join('')}
          </tbody></table></div>
        </div>`;
      $$('[data-kdel]', content).forEach((b) =>
        b.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: '吊销密钥', message: '确定吊销这个 API 密钥吗？使用该密钥的应用将立即失去访问权限。', okText: '吊销', danger: true });
          if (!ok) return;
          try {
            await api(`/api/keys/${b.dataset.kdel}`, { method: 'DELETE' });
            toast('密钥已吊销');
            load();
          } catch (err) {
            toast(err.message, 'err');
          }
        })
      );
    }
    $('#addKeyBtn')?.addEventListener('click', () => openKeyEditor(load));
    load();
  },
};

const SCOPES = [
  { value: 'links:read', label: '读取短链与统计' },
  { value: 'links:write', label: '创建 / 修改 / 删除短链' },
  { value: 'logs:read', label: '读取访问记录' },
  { value: 'domains:read', label: '读取域名列表' },
];

function openKeyEditor(onSaved) {
  const m = openModal({
    title: '创建 API 密钥',
    body: `
      <form id="keyForm" novalidate>
        <div class="field"><label>名称</label><input class="input" name="name" placeholder="例如：自动化脚本" maxlength="60"></div>
        <div class="field"><label>权限范围</label>
          <div class="check-list">
            ${SCOPES.map((s) => `<label class="check-row"><input type="checkbox" name="sc_${s.value}" ${s.value === 'links:write' ? '' : 'checked'}><span>${s.label}</span><code class="sub">${s.value}</code></label>`).join('')}
          </div>
        </div>
        <div class="field"><label>有效期</label>
          <select class="select" name="expires">
            <option value="0">永不过期</option>
            <option value="7">7 天</option>
            <option value="30">30 天</option>
            <option value="90">90 天</option>
            <option value="365">一年</option>
          </select>
        </div>
        <div class="field-error" id="keyErr" hidden></div>
      </form>`,
    footer: `
      <button class="btn btn-secondary" data-close>取消</button>
      <button class="btn btn-primary" id="keySave">创建</button>`,
  });
  $('#keySave', m.root).addEventListener('click', async () => {
    const errEl = $('#keyErr', m.root);
    errEl.hidden = true;
    const scopes = SCOPES.filter((s) => $(`[name="sc_${s.value}"]`, m.root).checked).map((s) => s.value);
    try {
      const created = await api('/api/keys', {
        method: 'POST',
        body: {
          name: $('[name="name"]', m.root).value.trim() || 'API 密钥',
          scopes,
          expires_in_days: Number($('[name="expires"]', m.root).value),
        },
      });
      m.close();
      const r = openModal({
        title: '密钥已创建',
        body: `
          <div class="alert warn">${I.alert}<div>密钥仅此一次显示，请立即妥善保存。</div></div>
          <div class="key-reveal" style="margin-top:14px">${esc(created.key)}</div>`,
        footer: `
          <button class="btn btn-secondary" data-close>关闭</button>
          <button class="btn btn-primary" id="copyKey">${I.copy} 复制密钥</button>`,
      });
      $('#copyKey', r.root).addEventListener('click', async () => {
        (await copyText(created.key)) && toast('已复制');
      });
      onSaved?.();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}

/* ---------------- settings ---------------- */

function settingRow(title, desc, control) {
  return `<div class="setting-row"><div class="txt"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div><div class="ctl">${control}</div></div>`;
}

routes['/settings'] = {
  title: '设置',
  key: 'settings',
  adminOnly: true,
  narrow: true,
  async render(content) {
    let data;
    try {
      data = await api('/api/settings');
    } catch (err) {
      content.innerHTML = errorHtml(err);
      return;
    }
    const s = data.settings;
    const c = data.counts;
    let mode = s.default_mode;
    const opts = (values, current, label) => values.map((v) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label(v)}</option>`).join('');
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>常规</h3></div>
        ${settingRow('站点名称', '显示在侧边栏、登录页与浏览器标题中', `<input class="input" id="sName" value="${esc(s.site_name)}" maxlength="40">`)}
        ${settingRow('默认跳转方式', '新建短链时的预设，域名可单独覆盖', `<div class="seg" id="sMode">
            <button type="button" class="${mode === 'direct' ? 'on' : ''}" data-mode="direct">直接</button>
            <button type="button" class="${mode === 'page' ? 'on' : ''}" data-mode="page">动画页</button>
            <button type="button" class="${mode === 'confirm' ? 'on' : ''}" data-mode="confirm">确认页</button>
          </div>`)}
        ${settingRow('会话有效期', '登录状态保持的时长', `<select class="select" id="sSess">${opts([1, 7, 14, 30, 90], s.session_days, (d) => `${d} 天`)}</select>`)}
      </div>

      <div class="card">
        <div class="card-head"><h3>数据保留</h3><div class="right">定时任务每小时运行</div></div>
        ${settingRow('访问记录保留', '超过期限的记录会被自动清理', `<select class="select" id="sRet">${opts([7, 30, 90, 180, 365], s.retention_days, (d) => `${d} 天`)}</select>`)}
        ${settingRow('过期短链自动删除', '短链过期一段时间后将其删除', `<select class="select" id="sDel"><option value="0" ${s.auto_delete_expired_days === 0 ? 'selected' : ''}>不自动删除</option>${opts([7, 30, 90], s.auto_delete_expired_days, (d) => `过期 ${d} 天后删除`)}</select>`)}
        <div class="card-foot split">
          <span class="hint">修改后点击下方保存</span>
          <button class="btn btn-secondary btn-sm" id="runClean">${I.refresh} 立即清理</button>
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn-primary" id="sSave">保存设置</button>
      </div>

      <div class="card">
        <div class="card-head"><h3>系统概况</h3></div>
        <dl class="kv">
          <div><dt>短链域名</dt><dd>${fmtNum(c.domains)}<small>个</small></dd></div>
          <div><dt>用户</dt><dd>${fmtNum(c.users)}<small>位</small></dd></div>
          <div><dt>短链接</dt><dd>${fmtNum(c.links)}<small>条</small></dd></div>
          <div><dt>访问记录</dt><dd>${fmtNum(c.logs)}<small>条</small></dd></div>
          <div><dt>API 密钥</dt><dd>${fmtNum(c.keys)}<small>个</small></dd></div>
          <div><dt>通行密钥</dt><dd>${fmtNum(c.passkeys)}<small>个</small></dd></div>
        </dl>
      </div>`;

    $$('[data-mode]', content).forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        $$('[data-mode]', content).forEach((x) => x.classList.toggle('on', x === b));
      })
    );
    $('#sSave').addEventListener('click', async () => {
      try {
        await api('/api/settings', {
          method: 'PATCH',
          body: {
            site_name: $('#sName').value.trim(),
            default_mode: mode,
            retention_days: Number($('#sRet').value),
            session_days: Number($('#sSess').value),
            auto_delete_expired_days: Number($('#sDel').value),
          },
        });
        bootstrap.site_name = $('#sName').value.trim() || 'ShortLink';
        document.title = bootstrap.site_name;
        $('.sidebar-brand .name').textContent = bootstrap.site_name;
        toast('设置已保存');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    $('#runClean').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api('/api/admin/cleanup', { method: 'POST' });
        toast(`清理完成：会话 ${r.sessions_deleted} · 记录 ${r.logs_deleted} · 短链 ${r.links_deleted}`);
      } catch (err) {
        toast(err.message, 'err');
      }
      btn.disabled = false;
    });
  },
};

/* ---------------- profile ---------------- */

routes['/profile'] = {
  title: '个人设置',
  narrow: true,
  async render(content) {
    const admin = me.role === 'admin';
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>账户</h3></div>
        ${settingRow('用户名', admin ? '管理员 · 全部权限' : `成员 · 配额 ${me.quota_max_links ? fmtNum(me.quota_max_links) + ' 条' : '不限'} · ${Array.isArray(me.domain_ids) ? me.domain_ids.length : '全部'} 个域名`, `<input class="input" value="${esc(me.username)}" disabled>`)}
        ${settingRow('显示名称', '显示在侧边栏与列表中', `<div class="input-row"><input class="input" id="pfName" value="${esc(me.display_name || '')}" maxlength="60"><button class="btn btn-secondary" id="pfNameSave">保存</button></div>`)}
      </div>

      <div class="card">
        <div class="card-head"><h3>密码</h3>${me.has_password ? '' : '<span class="badge badge-orange">未设置</span>'}</div>
        ${me.has_password ? settingRow('当前密码', '', `<input class="input" type="password" id="pfCur" autocomplete="current-password">`) : ''}
        ${settingRow('新密码', '至少 8 位', `<input class="input" type="password" id="pfNew" autocomplete="new-password">`)}
        <div class="card-foot">
          <span class="hint">修改后，其他设备上的会话将被注销</span>
          <button class="btn btn-primary btn-sm" id="pfPw">更新密码</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>通行密钥</h3><div class="right"><button class="btn btn-secondary btn-sm" id="pkAdd">${I.plus} 添加</button></div></div>
        <div id="pkList">${skeletonHtml(2)}</div>
        <div class="card-foot"><span class="hint">通行密钥与当前域名（${esc(location.hostname)}）绑定，可用指纹、Face ID 或硬件钥匙免密登录。</span></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>活跃会话</h3><div class="right"><button class="btn btn-secondary btn-sm" id="sessRevoke">注销其他会话</button></div></div>
        <div id="sessList">${skeletonHtml(2)}</div>
      </div>`;

    $('#pfNameSave').addEventListener('click', async () => {
      try {
        await api('/api/me', { method: 'PATCH', body: { display_name: $('#pfName').value.trim() } });
        await loadMe();
        toast('已保存');
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    $('#pfPw').addEventListener('click', async () => {
      const next = $('#pfNew').value;
      if (next.length < 8) return toast('新密码至少 8 位', 'err');
      try {
        await api('/api/me/password', {
          method: 'POST',
          body: { current: $('#pfCur')?.value || '', next },
        });
        toast('密码已更新');
        $('#pfNew').value = '';
        if ($('#pfCur')) $('#pfCur').value = '';
      } catch (err) {
        toast(err.message, 'err');
      }
    });

    async function loadPasskeys() {
      const box = $('#pkList');
      const data = await api('/api/me');
      if (!data.passkeys.length) {
        box.innerHTML = emptyHtml('passkey', '未绑定通行密钥', '添加后可使用指纹 / Face ID 登录', '', 'sm');
        return;
      }
      box.innerHTML = `<div class="hlist">${data.passkeys
        .map(
          (p) => `
        <div class="hlist-item">
          <div class="ico">${I.passkey}</div>
          <div class="grow"><div class="t1">${esc(p.name || '通行密钥')}${p.backed_up ? ' <span class="badge badge-green">已同步</span>' : ''}</div>
          <div class="t2">添加于 ${fmtDate(p.created_at, false)}</div></div>
          <button class="icon-btn danger" data-pkdel="${p.id}" title="移除" aria-label="移除">${I.trash}</button>
        </div>`
        )
        .join('')}</div>`;
      $$('[data-pkdel]', box).forEach((b) =>
        b.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: '移除通行密钥', message: '确定移除这个通行密钥吗？移除后将无法用它登录。', okText: '移除', danger: true });
          if (!ok) return;
          try {
            await api(`/api/me/passkeys/${b.dataset.pkdel}`, { method: 'DELETE' });
            toast('已移除');
            loadPasskeys();
          } catch (err) {
            toast(err.message, 'err');
          }
        })
      );
    }

    $('#pkAdd').addEventListener('click', async () => {
      try {
        const options = await api('/api/me/passkeys/options', { method: 'POST' });
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge: b64u2buf(options.challenge),
            rp: options.rp,
            user: { ...options.user, id: b64u2buf(options.user.id) },
            pubKeyCredParams: options.pubKeyCredParams,
            timeout: options.timeout,
            attestation: options.attestation || 'none',
            authenticatorSelection: options.authenticatorSelection,
            excludeCredentials: (options.excludeCredentials || []).map((c) => ({ id: b64u2buf(c.id), transports: c.transports })),
          },
        });
        const r = cred.response;
        const name = prompt('为这个通行密钥起个名字：', '我的通行密钥') || '通行密钥';
        await api('/api/me/passkeys/verify', {
          method: 'POST',
          body: {
            name: name.slice(0, 40),
            credential: {
              id: cred.id,
              rawId: buf2b64u(cred.rawId),
              type: cred.type,
              response: {
                clientDataJSON: buf2b64u(r.clientDataJSON),
                attestationObject: buf2b64u(r.attestationObject),
                transports: ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
              },
            },
          },
        });
        toast('通行密钥已添加');
        loadPasskeys();
      } catch (err) {
        if (err.name === 'NotAllowedError') toast('已取消', 'err');
        else toast(err.message || '添加失败', 'err');
      }
    });

    async function loadSessions() {
      const box = $('#sessList');
      const data = await api('/api/me/sessions');
      box.innerHTML = `<div class="hlist">${data.sessions
        .map((s) => {
          const ua = parseUA(s.ua);
          return `
        <div class="hlist-item">
          <div class="ico">${I.terminal}</div>
          <div class="grow"><div class="t1">${ua.browser} · ${ua.os} ${s.current ? '<span class="badge badge-blue">当前设备</span>' : ''}</div>
          <div class="t2">${esc(s.ip || '未知 IP')} · 活跃于 ${fmtRelative(s.last_seen_at)}</div></div>
        </div>`;
        })
        .join('')}</div>`;
    }
    $('#sessRevoke').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '注销其他会话', message: '除了当前浏览器，其他已登录设备都将被注销。', okText: '注销' });
      if (!ok) return;
      await api('/api/me/sessions/revoke-others', { method: 'POST' });
      toast('其他会话已注销');
      loadSessions();
    });

    loadPasskeys();
    loadSessions();
  },
};

/* ---------------- boot ---------------- */

(async function boot() {
  // theme
  const stored = localStorage.getItem('sl-theme');
  const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  try {
    bootstrap = await api('/api/bootstrap');
  } catch {
    bootstrap = { needsSetup: false, site_name: 'ShortLink' };
  }
  document.title = bootstrap.site_name || 'ShortLink';
  if (!bootstrap.needsSetup) {
    try {
      await loadMe();
    } catch {
      me = null;
    }
  }
  render();
})();
