/* ============================================================
   ShortLink console SPA — vanilla JS, no dependencies
   ============================================================ */

import { NOTE_THEMES, SECURE_MODES, encryptNote, encryptBytes, b64u, mountNote, fmtDuration, displayParams } from '/note.js';
import { SecureText } from '/secure-render.js';

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
    people: wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>'),
    ticket: wrap('<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/>'),
    scroll: wrap('<path d="M8 21h11a2 2 0 0 0 2-2v-1H10v1a2 2 0 0 1-4 0V5a2 2 0 0 0-2-2h12a2 2 0 0 1 2 2v13"/><path d="M10 8h5M10 12h5"/>'),
    chat: wrap('<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.3 0-2.6-.3-3.7-.8L3 20.5l1.6-4.3A8 8 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/>'),
    flame: wrap('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.2 1.8 1 2.8 2 3.3-.5-3 .3-6.3 1-8.8z"/>'),
    lock: wrap('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    snow: wrap('<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>'),
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
    if (res.status === 403 && data?.error?.code === 'password_change_required' && me) {
      me.must_change_password = true;
      render();
    }
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

function openModal({ title, body, footer, wide, xwide, onClose }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal${xwide ? ' xwide' : wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
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

// what the signed-in account may see/do (mirrors src/caps.js on the server)
const can = {
  users: () => !!me?.admin_perms?.users,
  domains: () => !!me?.admin_perms?.domains,
  settings: () => !!me?.admin_perms?.settings,
  content: () => !!me?.admin_perms?.content,
  anyAdmin: () => Object.values(me?.admin_perms || {}).some(Boolean),
  links: () => !!me?.caps?.links?.create,
  notes: () => !!me?.caps?.notes?.create || can.content(),
  rooms: () => !!me?.caps?.rooms?.create || can.content(),
  logs: () => !!me?.caps?.logs?.view,
  api: () => !!me?.caps?.api?.use || can.users(),
};

function roleLabel(u) {
  if (u.is_owner) return '所有者';
  if (u.role === 'admin') return '管理员';
  return u.group?.name || '成员';
}

const NAV = [
  { path: '/', label: '概览', icon: 'house' },
  { path: '/links', label: '短链接', icon: 'link' },
  { path: '/notes', label: '密信', icon: 'flame', show: () => can.notes() },
  { path: '/rooms', label: '聊天室', icon: 'chat', show: () => can.rooms() },
  { path: '/domains', label: '域名', icon: 'globe' },
  { path: '/logs', label: '访问记录', icon: 'clock', show: () => can.content() },
  { section: '管理', show: () => can.users() || can.settings() },
  { path: '/users', label: '用户', icon: 'person', show: () => can.users() },
  { path: '/groups', label: '用户组', icon: 'people', show: () => can.users() },
  { path: '/access', label: '邀请与登录链接', icon: 'ticket', show: () => can.users() },
  { path: '/audit', label: '操作日志', icon: 'scroll', show: () => can.users() },
  { path: '/settings', label: '设置', icon: 'gear', show: () => can.settings() },
  { section: '开发者', show: () => can.api() },
  { path: '/keys', label: 'API 密钥', icon: 'key', show: () => can.api() },
  { path: '/docs', label: 'API 文档', icon: 'doc', external: true, show: () => can.api() },
];

function currentPath() {
  const p = location.pathname;
  return p === '' ? '/' : p;
}

async function render() {
  const app = $('#app');
  const path = currentPath();
  const tokenMatch = path.match(/^\/(invite|login)\/([A-Za-z0-9_-]+)$/);
  if (tokenMatch) {
    await renderTokenPage(app, tokenMatch[1], tokenMatch[2]);
    return;
  }
  if (!me) {
    await renderAuth(app);
    return;
  }
  if (me.must_change_password) {
    renderPasswordGate(app);
    return;
  }
  const page = routes[path] || routes['/'];
  if (!page) return;
  if (page.need && !page.need()) {
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
              <div class="who"><b>${esc(me.display_name || me.username)}</b><span>${esc(roleLabel(me))}</span></div>
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
  nav.innerHTML = NAV.map((item) => {
    if (item.show && !item.show()) return '';
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

/* ---------------- invite / login-link / forced password screens ---------------- */

function authShell(inner) {
  return `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-head">
          <div class="mark lg">${I.link}</div>
          ${inner.head}
        </div>
        ${inner.body}
      </div>
      <p class="auth-foot">${esc(bootstrap?.site_name || 'ShortLink')}</p>
    </div>`;
}

async function renderTokenPage(app, kind, token) {
  const infoPath = kind === 'invite' ? `/api/invite/${token}` : `/api/login-link/${token}`;
  let info;
  try {
    info = await api(infoPath);
  } catch (err) {
    app.innerHTML = authShell({
      head: `<div class="auth-title">链接已失效</div><div class="auth-sub">${esc(err.message)}</div>`,
      body: `<a class="btn btn-secondary btn-lg btn-block" href="/" data-nav>返回登录页</a>`,
    });
    return;
  }
  const switching = me ? `<div class="alert warn" style="margin-bottom:16px">${I.alert}<div>你当前以 <b>${esc(me.username)}</b> 登录，继续后会切换到新账户。</div></div>` : '';
  if (kind === 'login') {
    app.innerHTML = authShell({
      head: `<div class="auth-title">登录到 ${esc(info.site_name)}</div><div class="auth-sub">这个链接会让你以下面的身份登录</div>`,
      body: `${switching}
        <div class="token-who"><div class="avatar">${esc((info.display_name || info.username)[0].toUpperCase())}</div><div><b>${esc(info.display_name)}</b><span>${esc(info.username)}</span></div></div>
        <div class="field-error" id="tkErr" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" id="tkGo" style="margin-top:18px">以 ${esc(info.username)} 登录</button>
        <p class="auth-foot" style="margin-top:14px">${info.expires_at ? `链接 ${fmtDate(info.expires_at)} 前有效` : '链接长期有效'}${info.uses_left !== null ? ` · 还能使用 ${info.uses_left} 次` : ''}</p>`,
    });
    $('#tkGo').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api(`/api/login-link/${token}`, { method: 'POST', body: {} });
        await loadMe();
        history.replaceState(null, '', '/');
        render();
      } catch (err) {
        $('#tkErr').textContent = err.message;
        $('#tkErr').hidden = false;
        e.currentTarget.disabled = false;
      }
    });
    return;
  }
  app.innerHTML = authShell({
    head: `<div class="auth-title">加入 ${esc(info.site_name)}</div><div class="auth-sub">${info.label ? esc(info.label) + ' · ' : ''}创建你的账户${info.group ? `（${esc(info.group)}）` : ''}</div>`,
    body: `${switching}
      <form id="invForm" novalidate>
        <div class="field"><label>用户名</label><input class="input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="2-32 位字母、数字或 _ . -"></div>
        <div class="field"><label>显示名称 <span class="opt">可选</span></label><input class="input" name="display_name" maxlength="60"></div>
        <div class="field"><label>密码</label><input class="input" type="password" name="password" autocomplete="new-password" placeholder="至少 8 位"></div>
        <div class="field-error" id="tkErr" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" style="margin-top:20px">创建账户</button>
      </form>
      ${info.account_days ? `<p class="auth-foot" style="margin-top:14px">账户有效期 ${info.account_days} 天</p>` : ''}`,
  });
  $('#invForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/invite/${token}`, {
        method: 'POST',
        body: { username: fd.get('username').trim(), display_name: fd.get('display_name').trim(), password: fd.get('password') },
      });
      await loadMe();
      history.replaceState(null, '', '/');
      render();
    } catch (err) {
      $('#tkErr').textContent = err.message;
      $('#tkErr').hidden = false;
    }
  });
}

function renderPasswordGate(app) {
  app.innerHTML = authShell({
    head: `<div class="auth-title">设置新密码</div><div class="auth-sub">管理员要求你在首次登录时修改初始密码</div>`,
    body: `
      <form id="pgForm" novalidate>
        <div class="field"><label>初始密码</label><input class="input" type="password" name="current" autocomplete="current-password"></div>
        <div class="field"><label>新密码</label><input class="input" type="password" name="next" autocomplete="new-password" placeholder="至少 8 位"></div>
        <div class="field-error" id="pgErr" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" style="margin-top:20px">保存并继续</button>
      </form>
      <button class="btn btn-ghost btn-block" id="pgOut" style="margin-top:8px">退出登录</button>`,
  });
  $('#pgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/me/password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } });
      await loadMe();
      toast('密码已更新');
      render();
    } catch (err) {
      $('#pgErr').textContent = err.message;
      $('#pgErr').hidden = false;
    }
  });
  $('#pgOut').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    me = null;
    route('/');
  });
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
        <div class="stat-tile"><div class="label">${I.globe} 短链域名</div><div class="value" id="stDomains">–</div><div class="delta">${can.content() ? '全部已绑定域名' : '可使用的域名'}</div></div>
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
    $('#stLinksSub').textContent = [data.scope === 'own' ? '我创建的' : `全部 ${fmtNum(data.users_total)} 位用户`, data.notes_total ? `另有 ${fmtNum(data.notes_total)} 封密信` : null].filter(Boolean).join(' · ');

    renderChart($('#chartBox'), data.series);
    const top = $('#topLinks');
    top.innerHTML = data.top_links.length
      ? `<div class="hlist">${data.top_links
          .map(
            (t, i) => `
        <div class="hlist-item">
          <div class="rank">${i + 1}</div>
          <div class="grow"><div class="t1 mono">${t.kind === 'note' ? `${esc(t.hostname)}/${esc(t.code)} <span class="badge badge-orange">密信</span>` : `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.hostname)}/${esc(t.code)}</a>`}</div>
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
          <div class="grow"><div class="t1 mono">${esc(r.hostname)}/${esc(r.code)}${r.kind === 'note' ? ' <span class="badge badge-orange">密信</span>' : ''}</div>
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
    const canCreate = can.links();
    const admin = can.content();
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
      const canViewLog = can.logs();
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

function modeSegHtml(mode, allowed = MODES.map((m) => m.value)) {
  const list = MODES.filter((m) => allowed.includes(m.value));
  const only = list.length === 1 ? `<div class="field-hint">当前账户只能使用「${list[0].label}」</div>` : '';
  return `<div class="seg block">${list.map((m) => `<button type="button" class="${mode === m.value ? 'on' : ''}" data-mode="${m.value}">${m.label}</button>`).join('')}</div>
    <div class="field-hint" data-mode-hint>${MODES.find((m) => m.value === mode)?.hint || ''}</div>${only}`;
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
  const lc = me.caps?.links || {};
  const allowedModes = lc.modes?.length ? lc.modes : MODES.map((x) => x.value);
  if (!allowedModes.includes(d.mode)) d.mode = allowedModes[0];
  const customOk = lc.custom_code !== false;
  const minLen = lc.min_code_len || 1;
  const targetLocked = !isNew && lc.edit_target === false;
  const lengths = [4, 5, 6, 7, 8, 10].filter((n) => n >= Math.min(minLen, 10));
  if (!lengths.includes(d.random_length)) d.random_length = lengths[0];

  const m = openModal({
    title: isNew ? '新建短链' : `编辑 ${link.code}`,
    wide: true,
    body: `
      <form id="linkForm" novalidate>
        <div class="form-section">
          <div class="field"><label>目标链接</label>
            <input class="input" name="target" type="url" required placeholder="https://example.com/very/long/url" value="${esc(d.target)}" ${targetLocked ? 'disabled' : ''}>
            ${targetLocked ? '<div class="field-hint">当前账户创建后不能修改目标链接</div>' : ''}
          </div>
          <div class="field"><label>短链地址</label>
            <div class="joined">
              <select class="select" name="domain_id" aria-label="域名">
                ${domains.map((dm) => `<option value="${dm.id}" ${d.domain_id === dm.id || d.domain?.id === dm.id ? 'selected' : ''}>${esc(dm.hostname)}</option>`).join('')}
              </select>
              <span class="sep">/</span>
              <input class="input mono" name="code" value="${esc(d.code || '')}" placeholder="${customOk ? '留空自动生成' : '自动生成'}" maxlength="64" autocapitalize="off" spellcheck="false" aria-label="后缀" ${customOk ? '' : 'disabled'}>
              ${customOk ? `<button type="button" class="icon-btn" id="rollBtn" title="随机生成" aria-label="随机生成">${I.refresh}</button>` : ''}
            </div>
            <div class="field-hint" id="codeHint">${!customOk ? `当前账户只能使用随机后缀（至少 ${minLen} 位）` : isNew ? `留空将自动生成随机后缀；自定义支持字母、数字、下划线和连字符${minLen > 1 ? `，至少 ${minLen} 位` : ''}` : '支持字母、数字、下划线、连字符'}</div>
          </div>
          <div class="form-grid">
            <div class="field"><label>备注 <span class="opt">可选</span></label><input class="input" name="note" value="${esc(d.note || '')}" maxlength="200" placeholder="这条链接的用途"></div>
            <div class="field"><label>过期时间 <span class="opt">可选</span></label>
              <input class="input" name="expires_at" type="datetime-local" value="${d.expires_at ? new Date(d.expires_at - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">
            </div>
          </div>
          ${isNew ? `<div class="field"><label>随机后缀长度</label>
            <select class="select" name="random_length" style="max-width:160px">${lengths.map((n) => `<option value="${n}" ${n === (d.random_length || 6) ? 'selected' : ''}>${n} 位</option>`).join('')}</select>
          </div>` : ''}
        </div>
        <div class="form-section">
          <div class="form-section-title">跳转方式</div>
          ${modeSegHtml(d.mode, allowedModes)}
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
      else if (r.reason === 'too_short') setHint(`后缀至少需要 ${r.min} 位`, 'var(--red)');
      else if (r.reason === 'invalid' || r.reason === 'reserved' || r.reason === 'forbidden') setHint('后缀不可用', 'var(--red)');
      else setHint('后缀可用', 'var(--green)');
    } catch {}
  }, 400);
  $('#rollBtn', root)?.addEventListener('click', () => {
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
    if (code && customOk) body.code = code;
    if (targetLocked) delete body.target;
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
        <td class="clean">${logStatusHtml(g.status)}</td>
      </tr>`;
    })
    .join('');
}

const LOG_STATUS = {
  hit: ['ok', '已跳转'],
  view: ['', '看了封面'],
  opened: ['ok', '已打开'],
  denied_password: ['warn', '密码错误'],
  exhausted: ['warn', '次数用完'],
  burned: ['', '已结束'],
  expired: ['warn', '已过期'],
  disabled: ['warn', '已停用'],
};

function logStatusHtml(status) {
  const [cls, label] = LOG_STATUS[status] || ['', status || '—'];
  return `<span class="status ${cls}">${label}</span>`;
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
    footer: `<a class="btn btn-secondary" id="csvBtn" href="/api/links/${link.id}/logs.csv" download style="margin-right:auto" hidden>${I.download} 导出 CSV</a><span class="dim" id="ipNote" style="margin-right:auto;font-size:12.5px" hidden></span><button class="btn btn-secondary" data-close>关闭</button>`,
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
    $('#csvBtn', m.root).hidden = !data.can_export;
    const ipNote = $('#ipNote', m.root);
    ipNote.hidden = data.can_export || data.ip_policy === 'full';
    ipNote.textContent = data.ip_policy === 'masked' ? '访客 IP 已按账户设置打码' : data.ip_policy === 'none' ? '访客 IP 已按账户设置隐藏' : '';
    if (!data.items.length) {
      box.innerHTML = emptyHtml('inbox', '暂无访问', link.kind === 'note' ? '这条密信还没有被打开过' : '这个短链还没有被访问过');
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

/* ---------------- burn-after-reading notes ---------------- */

const notesState = { q: '', status: '', page: 1 };
const NOTE_KEYS = 'sl-note-links';
const BURN_REASON = { exhausted: '次数用完', password: '密码错误过多', manual: '手动结束', expired: '到期结束' };

// E2E links carry the key after "#", which the server never sees. Remember it in
// this browser so the author can copy the full link again later.
function rememberNoteUrl(id, url) {
  try {
    const m = JSON.parse(localStorage.getItem(NOTE_KEYS) || '{}');
    m[id] = url;
    localStorage.setItem(NOTE_KEYS, JSON.stringify(m));
  } catch {}
}
function recalledNoteUrl(id) {
  try {
    return JSON.parse(localStorage.getItem(NOTE_KEYS) || '{}')[id] || null;
  } catch {
    return null;
  }
}

function noteStatusHtml(n) {
  switch (n.status) {
    case 'pending':
      return `<span class="status ok">待查看</span><div class="cell-sub">${n.max_opens ? `0 / ${n.max_opens} 次` : '不限次数'}</div>`;
    case 'opened':
      return `<span class="status ok">已打开</span><div class="cell-sub">${n.opens}${n.max_opens ? ` / ${n.max_opens}` : ''} 次</div>`;
    case 'burned':
      return `<span class="status">已结束</span><div class="cell-sub">${BURN_REASON[n.burn_reason] || ''}</div>`;
    case 'expired':
      return '<span class="status warn">已过期</span>';
    default:
      return '<span class="status warn">已停用</span>';
  }
}

function noteLimitChips(n) {
  const chips = [];
  if (n.has_password) chips.push('密码');
  if (n.open_ttl) chips.push(`打开后 ${fmtDuration(n.open_ttl)}`);
  if (n.expires_at) chips.push(`${fmtDate(n.expires_at, false).slice(5)} 前`);
  if (n.enc === 'server') chips.push('服务端加密');
  if (n.display?.hide_on_blur) chips.push('切出即隐藏');
  return `<div class="chip-row">${chips.map((c) => `<span class="badge badge-gray">${esc(c)}</span>`).join('') || '<span class="dim">—</span>'}</div>`;
}

routes['/notes'] = {
  title: '密信',
  key: 'notes',
  need: () => can.notes(),
  async render(content, topActions) {
    const canCreate = !!me.caps?.notes?.create;
    topActions.innerHTML = canCreate ? `<button class="btn btn-primary" id="newNoteBtn">${I.plus} 写密信</button>` : '';
    let domains = [];
    try {
      domains = (await api('/api/domains')).items.filter((d) => d.can_use);
    } catch {}
    content.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="search-box">${I.search}<input class="input" id="nq" placeholder="搜索后缀或备注" value="${esc(notesState.q)}"></div>
          <div class="spacer"></div>
          <div class="seg">
            <button data-st="" class="${notesState.status === '' ? 'on' : ''}">全部</button>
            <button data-st="live" class="${notesState.status === 'live' ? 'on' : ''}">进行中</button>
            <button data-st="burned" class="${notesState.status === 'burned' ? 'on' : ''}">已结束</button>
          </div>
        </div>
        <div id="notesList"></div>
      </div>`;
    $('#nq').addEventListener('input', debounce((e) => { notesState.q = e.target.value; notesState.page = 1; load(); }, 350));
    $$('[data-st]', content).forEach((b) => b.addEventListener('click', () => {
      notesState.status = b.dataset.st;
      notesState.page = 1;
      $$('[data-st]', content).forEach((x) => x.classList.toggle('on', x === b));
      load();
    }));
    const openComposer = () => openNoteComposer(domains, load);
    $('#newNoteBtn')?.addEventListener('click', openComposer);

    async function load() {
      const box = $('#notesList');
      box.innerHTML = skeletonHtml(4);
      const params = new URLSearchParams({ page: notesState.page });
      if (notesState.q) params.set('q', notesState.q);
      if (notesState.status) params.set('status', notesState.status);
      let data;
      try {
        data = await api('/api/notes?' + params);
      } catch (err) {
        box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
        return;
      }
      if (!data.items.length) {
        const filtered = notesState.q || notesState.status;
        box.innerHTML = emptyHtml(
          'flame',
          filtered ? '没有匹配的密信' : '还没有密信',
          filtered ? '换个关键词或筛选条件试试' : '密信只能被查看有限次数，看完就从服务器删除',
          canCreate && !filtered ? `<div><button class="btn btn-primary" id="emptyNote">${I.plus} 写第一封密信</button></div>` : ''
        );
        $('#emptyNote')?.addEventListener('click', openComposer);
        return;
      }
      const modeLabel = (id) => SECURE_MODES.find((x) => x.id === id)?.label || id;
      const themeLabel = (id) => NOTE_THEMES.find((x) => x.id === id)?.label || id;
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>密信</th><th>状态</th><th>限制</th><th class="hide-md">外观</th><th>创建</th><th class="w-actions"></th></tr></thead>
          <tbody>${data.items.map((n) => `
            <tr>
              <td class="cell-main">
                <span class="short-url"><span class="mono-num"><span class="dim">${esc(n.domain.hostname)}/</span>${esc(n.code)}</span></span>
                <div class="cell-sub truncate">${esc(n.label || n.meta?.title || '（无备注）')}</div>
              </td>
              <td class="clean">${noteStatusHtml(n)}</td>
              <td class="clean cell-block">${noteLimitChips(n)}</td>
              <td class="dim hide-md nowrap">${esc(themeLabel(n.theme?.name || 'min'))} · ${esc(modeLabel(n.display?.mode || 'click'))}</td>
              <td data-th="创建" class="nowrap dim">${fmtRelative(n.created_at)}${can.content() && n.owner && n.owner.id !== me.id ? `<div class="cell-sub">${esc(n.owner.username)}</div>` : ''}</td>
              <td class="cell-actions"><div class="row-actions">
                <button class="icon-btn" data-nlogs="${n.id}" title="打开记录" aria-label="打开记录">${I.clock}</button>
                <button class="icon-btn" data-nmenu="${n.id}" title="更多" aria-label="更多">${I.dots}</button>
              </div></td>
            </tr>`).join('')}
          </tbody></table></div>
        ${pagerHtml(data.page, data.per_page, data.total)}`;
      const byId = new Map(data.items.map((n) => [String(n.id), n]));
      $$('[data-nlogs]', box).forEach((b) => b.addEventListener('click', () => openLinkLogs(byId.get(b.dataset.nlogs))));
      $$('[data-nmenu]', box).forEach((b) => b.addEventListener('click', () => {
        const n = byId.get(b.dataset.nmenu);
        const live = n.status === 'pending' || n.status === 'opened' || n.status === 'disabled';
        openMenu(b, [
          ...(live ? [{ label: '复制链接', icon: I.copy, action: () => copyNoteLink(n) }] : []),
          ...(n.enc === 'server' && n.status !== 'burned' ? [{ label: '查看内容', icon: I.eye, action: () => viewNoteContent(n) }] : []),
          ...(live ? [{
            label: n.enabled ? '停用' : '启用',
            icon: n.enabled ? I.x : I.check,
            action: async () => {
              try {
                await api(`/api/links/${n.id}`, { method: 'PATCH', body: { enabled: !n.enabled } });
                toast(n.enabled ? '已停用' : '已启用');
                load();
              } catch (err) { toast(err.message, 'err'); }
            },
          }] : []),
          '-',
          ...(n.status !== 'burned' ? [{ label: '立即销毁', icon: I.flame, danger: true, action: async () => {
            const ok = await confirmDialog({ title: '销毁密信', message: '销毁后内容立即从服务器删除，链接无法再打开。打开记录会保留。', okText: '销毁', danger: true });
            if (!ok) return;
            try {
              await api(`/api/notes/${n.id}/burn`, { method: 'POST' });
              toast('已销毁');
              load();
            } catch (err) { toast(err.message, 'err'); }
          } }] : []),
          { label: '删除', icon: I.trash, danger: true, action: async () => {
            const ok = await confirmDialog({ title: '删除密信', message: '密信和它的打开记录都会被删除，此操作不可撤销。', okText: '删除', danger: true });
            if (!ok) return;
            try {
              await api(`/api/notes/${n.id}`, { method: 'DELETE' });
              toast('已删除');
              load();
            } catch (err) { toast(err.message, 'err'); }
          } },
        ]);
      }));
      $$('[data-page]', box).forEach((b) => b.addEventListener('click', () => { notesState.page = Number(b.dataset.page); load(); }));
    }
    load();
  },
};

async function copyNoteLink(n) {
  if (n.enc === 'server') return (await copyText(n.url)) && toast('已复制');
  const full = recalledNoteUrl(n.id);
  if (full) return (await copyText(full)) && toast('已复制完整链接');
  openModal({
    title: '无法复制完整链接',
    body: `<p class="modal-text">这封密信是端到端加密的，解密密钥只在创建时显示过一次，服务器上没有保存。只有在创建它的那个浏览器里才能重新复制完整链接。</p>`,
    footer: '<button class="btn btn-primary" data-close>知道了</button>',
  });
}

async function viewNoteContent(n) {
  const ok = await confirmDialog({
    title: '查看密信内容',
    message: n.owner?.id === me.id ? '查看不会消耗打开次数。' : '这封密信是其他用户创建的。查看操作会记录在操作日志里，不会消耗打开次数。',
    okText: '查看',
  });
  if (!ok) return;
  try {
    const { payload } = await api(`/api/notes/${n.id}/content`);
    openModal({
      title: `密信内容 · ${n.code}`,
      wide: true,
      body: `<div class="note-content-view" style="white-space:pre-wrap">${esc(payload.text)}</div>`,
      footer: '<button class="btn btn-secondary" data-close>关闭</button>',
    });
  } catch (err) {
    toast(err.message, 'err');
  }
}

const TTL_CHOICES = [
  [3600, '1 小时'],
  [86400, '1 天'],
  [7 * 86400, '7 天'],
  [30 * 86400, '30 天'],
  [0, '长期'],
];

function openNoteComposer(domains, onSaved) {
  const nc = me.caps?.notes || {};
  if (!domains.length) return toast('还没有可用的短链域名，请联系管理员', 'err');
  const e2eAllowed = nc.e2e !== false;
  const maxOpensCap = nc.max_opens || 0;
  const ttlCap = (nc.max_ttl_hours || 0) * 3600;
  const opensChoices = [1, 2, 3, 5, 10, 0].filter((n) => (maxOpensCap ? n > 0 && n <= maxOpensCap : true));
  const ttlChoices = TTL_CHOICES.filter(([s]) => (ttlCap ? s > 0 && s <= ttlCap : true));
  const customOk = me.caps?.links?.custom_code !== false;
  const state = {
    theme: 'min',
    mode: 'click',
    format: 'text',
    enc: e2eAllowed ? 'e2e' : 'server',
  };

  const m = openModal({
    title: '写密信',
    xwide: true,
    onClose: () => viewer?.destroy(),
    body: `
      <div class="composer">
        <form class="composer-form" novalidate>
          <div class="tpl-bar" id="tplBar">
            <select class="select" id="tplSelect" aria-label="模板"><option value="">从模板开始…</option></select>
            <button type="button" class="btn btn-secondary btn-sm" id="tplApply" disabled>套用</button>
            <button type="button" class="btn btn-secondary btn-sm" id="tplDel" hidden>删除</button>
            <span class="tpl-spacer"></span>
            <button type="button" class="btn btn-secondary btn-sm" id="tplSave">存为模板</button>
          </div>
          <div class="form-section">
            <div class="field">
              <label for="nText">内容</label>
              <textarea class="textarea" id="nText" name="text" rows="7" placeholder="写下只想让对方看一次的内容"></textarea>
              <div class="field-hint"><span id="nBytes">0 字节</span> / ${nc.max_kb || 64} KB · 内容${e2eAllowed ? '在你的浏览器里加密后才上传' : '加密保存在服务器上'}，对方看到的是画出来的文字，无法选中或复制</div>
            </div>
            ${bootstrap?.features?.media ? `
            <div class="field">
              <label>图片 <span class="opt">最多 6 张</span></label>
              <input type="file" id="nPics" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
              <div class="pic-strip" id="picStrip"><button type="button" class="pic-add" id="nPicsBtn">+ 添加图片</button></div>
              <div class="field-hint">打开时画在画布上，和文字一样不可下载、不可直接读取</div>
            </div>` : ''}
          </div>

          <div class="form-section">
            <div class="form-section-title">封面<span>打开前就能看到，也会出现在聊天软件的链接预览里，不要写敏感内容</span></div>
            <div class="form-grid">
              <div class="field"><label>标题</label><input class="input" name="title" maxlength="60" placeholder="你收到一封密信"></div>
              <div class="field"><label>署名 <span class="opt">可选</span></label><input class="input" name="from" maxlength="40" placeholder="${esc(me.display_name || me.username)}"></div>
            </div>
            <div class="field"><label>提示语 <span class="opt">可选</span></label><input class="input" name="hint" maxlength="140" placeholder="例如：找个没人的地方再打开"></div>
            <div class="field"><label>页面风格</label>
              <div class="theme-picks">${NOTE_THEMES.map((t) => `<button type="button" class="theme-pick${t.id === state.theme ? ' on' : ''}" data-theme-pick="${t.id}"><i style="background:${t.swatch}"></i>${t.label}</button>`).join('')}</div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">显示方式<span>改任意参数，右侧预览即时更新</span></div>
            <div class="mode-cards" id="modeSeg">${SECURE_MODES.map((x) => `<button type="button" class="mode-card${x.id === state.mode ? ' on' : ''}" data-nmode="${x.id}"><b>${x.label}${x.tag ? `<span class="mode-tag${x.anti ? ' anti' : ''}">${x.tag}</span>` : ''}</b></button>`).join('')}</div>
            <div class="field-hint" id="modeDesc"></div>
            <div class="subpanel" id="modeOpts"></div>
            <label class="toggle-row"><div class="txt"><b>按住才显示</b><span>手指按住画面时才显示，松开立即隐藏</span></div><span class="switch"><input type="checkbox" name="hold"><i></i></span></label>
            <label class="toggle-row"><div class="txt"><b>切出页面时隐藏</b><span>访客切到别的应用或标签页时内容自动模糊</span></div><span class="switch"><input type="checkbox" name="hide_on_blur"><i></i></span></label>
            <div class="form-grid" style="margin-top:4px">
              <div class="field"><label>看完之后</label>
                <select class="select" name="after"><option value="quiet">安静结束</option><option value="message">显示一句话</option><option value="redirect">跳转到一个链接</option></select>
              </div>
              <div class="field" id="afterBox" hidden><label id="afterLabel">结束语</label><input class="input" name="after_value" maxlength="300"></div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">访问限制</div>
            <div class="form-grid">
              <div class="field"><label>可查看次数</label>
                <select class="select" name="max_opens">${opensChoices.map((n) => `<option value="${n}">${n ? `${n} 次` : '不限'}</option>`).join('')}</select>
              </div>
              <div class="field"><label>有效期</label>
                <select class="select" name="ttl">${ttlChoices.map(([s, l]) => `<option value="${s}" ${s === 86400 ? 'selected' : ''}>${l}</option>`).join('')}</select>
              </div>
              <div class="field"><label>首次打开后</label>
                <select class="select" name="open_ttl"><option value="">不额外限制</option><option value="300">5 分钟内有效</option><option value="3600">1 小时内有效</option><option value="86400">1 天内有效</option></select>
              </div>
              <div class="field"><label>访问密码 <span class="opt">可选</span></label><input class="input" name="password" type="text" autocomplete="off" placeholder="不设置"></div>
            </div>
            <div class="field" id="pwFailBox" hidden><label>密码错误</label>
              <select class="select" name="pw_max_fail" style="max-width:240px"><option value="3">3 次后销毁</option><option value="5" selected>5 次后销毁</option><option value="10">10 次后销毁</option><option value="0">不限次数</option></select>
            </div>
          </div>

          <div class="form-section">
            <details class="cap-details" id="accessDetails">
              <summary><span>更多限制</span><span class="sub">定时解锁、地区、IP、设备</span>${I.chevRight.replace('<svg', '<svg class="chev"')}</summary>
              <div style="margin-top:14px">
                <div class="field"><label>定时解锁 <span class="opt">可选</span></label>
                  <input class="input" name="unlock_at" type="datetime-local">
                  <div class="field-hint">在此时间之前，打开只会看到倒计时</div>
                </div>
                <div class="field"><label>地区限制</label>
                  <div class="seg block" style="max-width:360px"><button type="button" class="on" data-geo="off">不限</button><button type="button" data-geo="allow">仅允许</button><button type="button" data-geo="deny">禁止</button></div>
                  <input class="input" name="geo_list" placeholder="国家/地区代码，逗号分隔，如 CN, HK, US" hidden style="margin-top:8px">
                </div>
                <div class="field"><label>IP 白名单 <span class="opt">可选</span></label>
                  <textarea class="textarea" name="ip_list" rows="2" placeholder="每行一个 IP 或网段，如 203.0.113.5 或 203.0.113.0/24"></textarea>
                </div>
                <label class="toggle-row"><div class="txt"><b>锁定首个打开的网络</b><span>之后换 IP 无法打开</span></div><span class="switch"><input type="checkbox" name="lock_ip"><i></i></span></label>
                <label class="toggle-row"><div class="txt"><b>锁定首台打开的设备</b><span>换设备或清除浏览器数据后无法打开</span></div><span class="switch"><input type="checkbox" name="lock_device"><i></i></span></label>
                ${nc.webhook ? `
                <div class="field"><label>打开通知 Webhook <span class="opt">可选</span></label>
                  <input class="input mono" name="webhook_url" type="url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://… 被打开时推送通知">
                  <div class="field-hint">每次成功打开后，向该 https 地址 POST 一条事件（含次数、地区）。不能是内网地址。</div>
                </div>` : ''}
              </div>
            </details>
          </div>

          <div class="form-section">
            <div class="form-section-title">链接</div>
            <div class="field">
              <div class="joined">
                <select class="select" name="domain_id" aria-label="域名">${domains.map((d) => `<option value="${d.id}">${esc(d.hostname)}</option>`).join('')}</select>
                <span class="sep">/</span>
                <input class="input mono" name="code" placeholder="${customOk ? '留空随机生成' : '随机生成'}" maxlength="64" autocapitalize="off" spellcheck="false" aria-label="后缀" ${customOk ? '' : 'disabled'}>
              </div>
            </div>
            <div class="field"><label>备注 <span class="opt">只有你能看到</span></label><input class="input" name="label" maxlength="200" placeholder="例如：门禁密码 · 发给小林"></div>
            ${e2eAllowed ? `
            <div class="field"><label>加密方式</label>
              <div class="seg block" id="encSeg"><button type="button" data-enc="e2e" class="on">端到端加密</button><button type="button" data-enc="server">服务端加密</button></div>
              <div class="field-hint" id="encHint"></div>
            </div>` : `<div class="alert">${I.info}<div>当前账户的密信使用服务端加密：内容加密保存在服务器上，被举报时管理员可以查看。</div></div>`}
          </div>
          <div class="field-error" id="noteErr" hidden></div>
        </form>
        <aside class="composer-preview">
          <div class="preview-label">访客看到的样子</div>
          <div class="preview-phone"><div class="nt-scope nt-min" id="previewScope"><div class="nt-wrap" id="previewRoot"></div></div></div>
          <p class="field-hint" style="text-align:center">点「打开」试播显示效果，不会创建任何内容</p>
        </aside>
      </div>`,
    footer: `<button class="btn btn-secondary" data-close>取消</button><button class="btn btn-primary" id="noteSave">${I.flame} 生成链接</button>`,
  });
  const root = m.root;
  const val = (n) => $(`[name="${n}"]`, root);

  const slider = (name, label, min, max, step, def, fmt) =>
    `<div class="slider-row"><label>${label}<b data-out="${name}"></b></label><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${def}" data-fmt="${fmt || ''}"></div>`;

  function modeOptsHtml() {
    const m = state.mode;
    if (m === 'motion')
      return (
        slider('mspeed', '滚动速度', 3, 30, 1, 14, 'x10') +
        slider('contrast', '对比度', 20, 100, 1, 100, 'pct') +
        slider('cell', '噪点粗细', 1, 4, 1, 1, 'px') +
        `<label class="toggle-row" style="margin-top:4px"><div class="txt"><b>灰度噪点</b><span>默认黑白，开启后更柔和</span></div><span class="switch"><input type="checkbox" name="density"><i></i></span></label>`
      );
    if (m === 'comp')
      return (
        slider('contrast', '对比度', 20, 100, 1, 82, 'pct') +
        slider('interval', '翻转间隔', 1, 6, 1, 1, 'frame') +
        slider('refresh', '噪点刷新', 0, 30, 1, 10, 'cycle') +
        slider('cell', '噪点粗细', 1, 4, 1, 1, 'px')
      );
    if (m === 'type')
      return slider('chunk', '每次出现', 1, 10, 1, 2, 'char') + slider('speed', '间隔', 40, 400, 10, 120, 'ms');
    if (m === 'window')
      return slider('window', '同时显示', 2, 14, 1, 6, 'char') + slider('speed', '间隔', 80, 600, 10, 220, 'ms');
    if (m === 'countdown')
      return slider('seconds', '显示时长', 3, 120, 1, 30, 'sec');
    return '<p class="field-hint">打开即显示全文。</p>';
  }

  function readDisplay() {
    const after = val('after').value;
    const afterValue = val('after_value').value.trim();
    const num = (n, d) => (val(n) ? Number(val(n).value) : d);
    return {
      mode: state.mode,
      hold: val('hold').checked,
      hide_on_blur: val('hide_on_blur').checked,
      mspeed: num('mspeed', 14),
      contrast: num('contrast', state.mode === 'comp' ? 82 : 100),
      cell: num('cell', 1),
      density: !!val('density')?.checked ? 'gray' : 'bin',
      interval: num('interval', 1),
      refresh: num('refresh', 8),
      chunk: num('chunk', 2),
      window: num('window', 6),
      speed: num('speed', state.mode === 'window' ? 220 : 120),
      seconds: num('seconds', 30),
      after,
      after_text: after === 'message' ? afterValue : null,
      after_url: after === 'redirect' ? afterValue : null,
    };
  }

  function paintSliderOuts() {
    $$('[data-out]', root).forEach((out) => {
      const inp = val(out.dataset.out);
      if (!inp) return;
      const v = Number(inp.value);
      const fmt = inp.dataset.fmt;
      out.textContent =
        fmt === 'x10' ? (v / 10).toFixed(1) + '×' : fmt === 'pct' ? v + '%' : fmt === 'px' ? v + 'px' : fmt === 'char' ? v + ' 字' : fmt === 'ms' ? v + 'ms' : fmt === 'sec' ? v + ' 秒' : fmt === 'frame' ? v + ' 帧' : fmt === 'cycle' ? (v ? v + ' 周期' : '不刷新') : v;
    });
  }

  function coverData() {
    const ttl = Number(val('ttl').value);
    const pw = val('password').value;
    return {
      code: 'preview',
      site: bootstrap?.site_name || 'ShortLink',
      status: 'pending',
      enc: state.enc,
      meta: { title: val('title').value.trim() || null, from: val('from').value.trim() || null, hint: val('hint').value.trim() || null },
      theme: { name: state.theme },
      display: readDisplay(),
      max_opens: Number(val('max_opens').value),
      opens: 0,
      open_ttl: Number(val('open_ttl').value) || null,
      expires_at: ttl ? Date.now() + ttl * 1000 : null,
      needs_password: !!pw,
      attempts_left: pw && Number(val('pw_max_fail').value) ? Number(val('pw_max_fail').value) : null,
      is_bot: false,
    };
  }

  let viewer = null;
  function paintPreview() {
    const scope = $('#previewScope', root);
    scope.className = `nt-scope nt-${state.theme}`;
    viewer?.destroy();
    const text = val('text').value;
    viewer = mountNote($('#previewRoot', root), coverData(), { preview: { text: text || '（这里会显示你写的内容）' } });
  }
  const repaint = debounce(paintPreview, 200);

  function paintMode() {
    $('#modeDesc', root).textContent = SECURE_MODES.find((x) => x.id === state.mode)?.desc || '';
    $('#modeOpts', root).innerHTML = modeOptsHtml();
    paintSliderOuts();
  }
  function paintEnc() {
    const hint = $('#encHint', root);
    if (hint) hint.textContent = state.enc === 'e2e' ? '解密密钥只放在链接 # 后面，服务器和管理员都看不到内容。链接丢了就无法找回。' : '内容加密保存在服务器上，管理员可以查看。适合需要事后核对的场景。';
  }

  $$('[data-theme-pick]', root).forEach((b) => b.addEventListener('click', () => {
    state.theme = b.dataset.themePick;
    $$('[data-theme-pick]', root).forEach((x) => x.classList.toggle('on', x === b));
    paintPreview();
  }));
  $$('[data-nmode]', root).forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.nmode;
    $$('[data-nmode]', root).forEach((x) => x.classList.toggle('on', x === b));
    paintMode();
    paintPreview();
  }));
  $$('[data-enc]', root).forEach((b) => b.addEventListener('click', () => {
    state.enc = b.dataset.enc;
    $$('[data-enc]', root).forEach((x) => x.classList.toggle('on', x === b));
    paintEnc();
    paintPreview();
  }));
  val('after').addEventListener('change', (e) => {
    const v = e.target.value;
    $('#afterBox', root).hidden = v === 'quiet';
    $('#afterLabel', root).textContent = v === 'redirect' ? '跳转地址' : '结束语';
    val('after_value').placeholder = v === 'redirect' ? 'https://' : '例如：看完记得回我';
  });
  val('password').addEventListener('input', (e) => {
    $('#pwFailBox', root).hidden = !e.target.value;
  });
  root.querySelector('.composer-form').addEventListener('input', (e) => {
    if (e.target.name === 'text') {
      const n = new TextEncoder().encode(e.target.value).length;
      $('#nBytes', root).textContent = n < 1024 ? `${n} 字节` : `${(n / 1024).toFixed(1)} KB`;
    }
    if (e.target.type === 'range') paintSliderOuts();
    repaint();
  });
  root.querySelector('.composer-form').addEventListener('change', repaint);
  let geoMode = 'off';
  $$('[data-geo]', root).forEach((b) => b.addEventListener('click', () => {
    geoMode = b.dataset.geo;
    $$('[data-geo]', root).forEach((x) => x.classList.toggle('on', x === b));
    val('geo_list').hidden = geoMode === 'off';
  }));
  paintMode();
  paintEnc();
  paintPreview();
  setTimeout(() => val('text').focus(), 60);

  // ---------- composer templates ----------
  let templates = [];
  const tplSel = $('#tplSelect', root);
  const setVal = (name, v) => {
    const el = val(name);
    if (!el || v == null) return false;
    if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === String(v))) return false;
    el.value = String(v);
    return true;
  };
  const setChk = (name, v) => { const el = val(name); if (el) el.checked = !!v; };
  function captureConfig() {
    return {
      theme: state.theme, mode: state.mode, enc: state.enc,
      display: readDisplay(),
      max_opens: Number(val('max_opens').value),
      ttl: Number(val('ttl').value),
      open_ttl: val('open_ttl').value || '',
      pw_max_fail: Number(val('pw_max_fail').value),
      geo_mode: geoMode,
      geo_list: val('geo_list').value,
      ip_list: val('ip_list').value,
      lock_ip: val('lock_ip').checked,
      lock_device: val('lock_device').checked,
    };
  }
  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    const d = cfg.display || {};
    if (e2eAllowed && (cfg.enc === 'e2e' || cfg.enc === 'server')) {
      state.enc = cfg.enc;
      $$('[data-enc]', root).forEach((x) => x.classList.toggle('on', x.dataset.enc === state.enc));
    }
    if (NOTE_THEMES.some((t) => t.id === cfg.theme)) {
      state.theme = cfg.theme;
      $$('[data-theme-pick]', root).forEach((x) => x.classList.toggle('on', x.dataset.themePick === state.theme));
    }
    const mode = d.mode || cfg.mode;
    if (SECURE_MODES.some((x) => x.id === mode)) {
      state.mode = mode;
      $$('[data-nmode]', root).forEach((x) => x.classList.toggle('on', x.dataset.nmode === state.mode));
    }
    paintMode(); // render this mode's sliders before filling them
    ['mspeed', 'contrast', 'cell', 'interval', 'refresh', 'chunk', 'window', 'speed', 'seconds'].forEach((k) => setVal(k, d[k]));
    setChk('density', d.density === 'gray');
    setChk('hold', d.hold);
    setChk('hide_on_blur', d.hide_on_blur);
    if (['quiet', 'message', 'redirect'].includes(d.after)) {
      setVal('after', d.after);
      $('#afterBox', root).hidden = d.after === 'quiet';
      $('#afterLabel', root).textContent = d.after === 'redirect' ? '跳转地址' : '结束语';
      setVal('after_value', d.after === 'redirect' ? d.after_url : d.after_text);
    }
    setVal('max_opens', cfg.max_opens);
    setVal('ttl', cfg.ttl);
    setVal('open_ttl', cfg.open_ttl);
    setVal('pw_max_fail', cfg.pw_max_fail);
    if (['off', 'allow', 'deny'].includes(cfg.geo_mode)) {
      geoMode = cfg.geo_mode;
      $$('[data-geo]', root).forEach((x) => x.classList.toggle('on', x.dataset.geo === geoMode));
      val('geo_list').hidden = geoMode === 'off';
    }
    setVal('geo_list', cfg.geo_list);
    setVal('ip_list', cfg.ip_list);
    setChk('lock_ip', cfg.lock_ip);
    setChk('lock_device', cfg.lock_device);
    paintSliderOuts();
    paintEnc();
    paintPreview();
  }
  function renderTplOptions() {
    tplSel.innerHTML = '<option value="">从模板开始…</option>' + templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  }
  async function loadTemplates() {
    try {
      const r = await api('/api/note-templates');
      templates = r.items || [];
      renderTplOptions();
    } catch {}
  }
  tplSel.addEventListener('change', () => {
    const has = !!tplSel.value;
    $('#tplApply', root).disabled = !has;
    $('#tplDel', root).hidden = !has;
  });
  $('#tplApply', root).addEventListener('click', () => {
    const t = templates.find((x) => String(x.id) === tplSel.value);
    if (t) { applyConfig(t.config); toast(`已套用「${t.name}」`); }
  });
  $('#tplSave', root).addEventListener('click', async () => {
    const name = (prompt('模板名称') || '').trim();
    if (!name) return;
    try {
      const r = await api('/api/note-templates', { method: 'POST', body: { name, config: captureConfig() } });
      templates.unshift(r.item);
      renderTplOptions();
      tplSel.value = String(r.item.id);
      tplSel.dispatchEvent(new Event('change'));
      toast('模板已保存');
    } catch (e) { toast(e.message || '保存失败', 'err'); }
  });
  $('#tplDel', root).addEventListener('click', async () => {
    const t = templates.find((x) => String(x.id) === tplSel.value);
    if (!t || !confirm(`删除模板「${t.name}」？`)) return;
    try {
      await api(`/api/note-templates/${t.id}`, { method: 'DELETE' });
      templates = templates.filter((x) => x.id !== t.id);
      renderTplOptions();
      tplSel.dispatchEvent(new Event('change'));
      toast('已删除');
    } catch (e) { toast(e.message || '删除失败', 'err'); }
  });
  loadTemplates();

  // ---------- image attachments ----------
  const pics = []; // { file, url }
  const picStrip = $('#picStrip', root);
  if (picStrip) {
  const renderPics = () => {
    picStrip.querySelectorAll('.pic-thumb').forEach((n) => n.remove());
    const addBtn = $('#nPicsBtn', root);
    pics.forEach((p, i) => {
      const t = document.createElement('div');
      t.className = 'pic-thumb';
      t.innerHTML = `<img src="${p.url}" alt=""><button type="button" class="pic-del" data-i="${i}" aria-label="移除">×</button>`;
      picStrip.insertBefore(t, addBtn);
    });
    addBtn.hidden = pics.length >= 6;
  };
  $('#nPicsBtn', root).addEventListener('click', () => $('#nPics', root).click());
  $('#nPics', root).addEventListener('change', (e) => {
    for (const f of e.target.files) {
      if (pics.length >= 6) break;
      if (f.size > 2 * 1024 * 1024) { toast(`${f.name} 超过 2MB`, 'err'); continue; }
      pics.push({ file: f, url: URL.createObjectURL(f) });
    }
    e.target.value = '';
    renderPics();
  });
  picStrip.addEventListener('click', (e) => {
    const b = e.target.closest('.pic-del');
    if (!b) return;
    const [p] = pics.splice(Number(b.dataset.i), 1);
    if (p) URL.revokeObjectURL(p.url);
    renderPics();
  });
  }

  $('#noteSave', root).addEventListener('click', async (ev) => {
    const errEl = $('#noteErr', root);
    errEl.hidden = true;
    const text = val('text').value;
    const fail = (msg) => {
      errEl.textContent = msg;
      errEl.hidden = false;
    };
    if (!text.trim()) return fail('请填写密信内容');
    const display = readDisplay();
    if (display.after === 'redirect' && !/^https?:\/\//.test(display.after_url || '')) return fail('跳转地址需要以 http:// 或 https:// 开头');
    const ttl = Number(val('ttl').value);
    const body = {
      domain_id: Number(val('domain_id').value),
      label: val('label').value.trim(),
      max_opens: Number(val('max_opens').value),
      expires_at: ttl ? Date.now() + ttl * 1000 : null,
      open_ttl: Number(val('open_ttl').value) || null,
      password: val('password').value || null,
      pw_max_fail: Number(val('pw_max_fail').value),
      unlock_at: val('unlock_at').value ? new Date(val('unlock_at').value).getTime() : null,
      webhook_url: val('webhook_url')?.value.trim() || null,
      access: {
        geo_mode: geoMode,
        geo_list: geoMode === 'off' ? [] : val('geo_list').value.split(/[,，\s]+/).filter(Boolean),
        ip_list: val('ip_list').value.split(/\n+/).map((x) => x.trim()).filter(Boolean),
        lock_ip: val('lock_ip').checked,
        lock_device: val('lock_device').checked,
      },
      display,
      theme: { name: state.theme },
      meta: { title: val('title').value.trim(), from: val('from').value.trim(), hint: val('hint').value.trim() },
      random_length: 8,
      enc: state.enc,
    };
    const code = val('code').value.trim();
    if (code && customOk) body.code = code;
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      let key = null;
      if (state.enc === 'e2e') {
        const sealed = await encryptNote({ text });
        body.cipher = sealed.cipher;
        body.kcv = sealed.kcv;
        key = sealed.key;
      } else {
        body.payload = { text };
      }
      const { item } = await api('/api/notes', { method: 'POST', body });
      for (const p of pics) {
        const buf = new Uint8Array(await p.file.arrayBuffer());
        const data = key ? await encryptBytes(key, buf) : b64u(buf);
        await api(`/api/notes/${item.id}/media`, { method: 'POST', body: { mime: p.file.type, data } });
        URL.revokeObjectURL(p.url);
      }
      const url = key ? `${item.url}#k=${key}` : item.url;
      if (key) rememberNoteUrl(item.id, url);
      viewer?.destroy();
      m.close();
      onSaved?.();
      showNoteCreated(item, url, !!key);
    } catch (err) {
      fail(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

function showNoteCreated(item, url, e2e) {
  const r = openModal({
    title: '密信已生成',
    body: `
      <div class="success-box">
        <div class="tick">${I.flame}</div>
        <div class="code-pill note-url">${esc(url)}</div>
        <p>${item.max_opens ? `可查看 ${item.max_opens} 次` : '不限查看次数'}${item.expires_at ? ` · ${fmtDate(item.expires_at)} 前有效` : ''}${item.has_password ? ' · 需要密码' : ''}</p>
      </div>
      ${e2e ? `<div class="alert warn" style="margin-top:14px">${I.alert}<div># 后面是解密密钥，服务器上没有保存。请现在复制并发送，之后只能在这个浏览器里重新复制。</div></div>` : ''}
      ${item.has_password ? `<p class="field-hint" style="margin-top:10px">记得把密码通过另一个渠道告诉对方。</p>` : ''}`,
    footer: `<button class="btn btn-secondary" data-close>关闭</button><button class="btn btn-primary" id="copyNoteUrl">${I.copy} 复制链接</button>`,
  });
  $('#copyNoteUrl', r.root).addEventListener('click', async () => (await copyText(url)) && toast('已复制'));
}

/* ---------------- chat rooms ---------------- */

const ROOM_TYPE_LABEL = { dm: '单聊', group: '群聊', burn: '焰信' };
const ROOM_TYPES = [
  { id: 'dm', label: '单聊', hint: '2 人，满员锁定' },
  { id: 'group', label: '群聊', hint: '多人，可设人数上限' },
  { id: 'burn', label: '焰信', hint: '服务器不存消息，读完即逝' },
];

function roomKeyUrl(id) { return recalledNoteUrl('r' + id); }
function rememberRoomUrl(id, url) { rememberNoteUrl('r' + id, url); }

routes['/rooms'] = {
  title: '聊天室',
  key: 'rooms',
  need: () => can.rooms(),
  async render(content, topActions) {
    const canCreate = !!me.caps?.rooms?.create;
    topActions.innerHTML = canCreate ? `<button class="btn btn-primary" id="newRoomBtn">${I.plus} 创建聊天室</button>` : '';
    let domains = [];
    try {
      domains = (await api('/api/domains')).items.filter((d) => d.can_use);
    } catch {}
    const openComposer = () => openRoomComposer(domains, load);
    $('#newRoomBtn')?.addEventListener('click', openComposer);
    content.innerHTML = `<div class="card"><div id="roomsList"></div></div>`;

    async function load() {
      const box = $('#roomsList');
      box.innerHTML = skeletonHtml(3);
      let data;
      try {
        data = await api('/api/rooms');
      } catch (err) {
        box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
        return;
      }
      if (!data.items.length) {
        box.innerHTML = emptyHtml('chat', '还没有聊天室', '创建一个用链接拉起的实时聊天，消息端到端加密', canCreate ? `<div><button class="btn btn-primary" id="emptyRoom">${I.plus} 创建聊天室</button></div>` : '');
        $('#emptyRoom')?.addEventListener('click', openComposer);
        return;
      }
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>聊天室</th><th>类型</th><th>状态</th><th>消息显示</th><th>创建</th><th class="w-actions"></th></tr></thead>
          <tbody>${data.items.map((rm) => {
            const p = rm.policy || {};
            const disp = SECURE_MODES.find((x) => x.id === (p.display?.mode))?.label || '直接显示';
            return `<tr>
              <td class="cell-main"><span class="mono-num"><span class="dim">${esc(rm.domain.hostname)}/</span>${esc(rm.code)}</span><div class="cell-sub truncate">${esc(rm.label || '（无备注）')}</div></td>
              <td class="clean"><span class="badge badge-gray">${ROOM_TYPE_LABEL[rm.type] || rm.type}</span></td>
              <td class="clean">${rm.room_status === 'destroyed' ? '<span class="status">已结束</span>' : rm.room_status === 'closed' ? '<span class="status">已关闭</span>' : '<span class="status ok">进行中</span>'}</td>
              <td class="dim hide-md">${esc(disp)}${p.disappear ? ` · 阅后 ${p.disappear}s` : ''}</td>
              <td data-th="创建" class="nowrap dim">${fmtRelative(rm.created_at)}${can.content() && rm.owner && rm.owner.id !== me.id ? `<div class="cell-sub">${esc(rm.owner.username)}</div>` : ''}</td>
              <td class="cell-actions"><div class="row-actions">
                ${rm.room_status === 'open' ? `<button class="icon-btn" data-enter="${rm.id}" title="进入（房主）" aria-label="进入">${I.external}</button>` : ''}
                <button class="icon-btn" data-rmenu="${rm.id}" title="更多" aria-label="更多">${I.dots}</button>
              </div></td>
            </tr>`;
          }).join('')}</tbody></table></div>`;
      const byId = new Map(data.items.map((rm) => [String(rm.id), rm]));
      $$('[data-enter]', box).forEach((a) => a.addEventListener('click', () => enterRoomAsOwner(byId.get(a.dataset.enter))));
      $$('[data-rmenu]', box).forEach((b) => b.addEventListener('click', () => {
        const rm = byId.get(b.dataset.rmenu);
        openMenu(b, [
          ...(rm.room_status === 'open' ? [{ label: '复制邀请链接', icon: I.copy, action: () => copyRoomLink(rm) }] : []),
          ...(rm.room_status === 'open' ? [{ label: '结束聊天室', icon: I.x, danger: true, action: async () => {
            const ok = await confirmDialog({ title: '结束聊天室', message: '所有人会被断开连接，消息记录一并清除。链接将无法再进入。', okText: '结束', danger: true });
            if (!ok) return;
            try { await api(`/api/rooms/${rm.id}/destroy`, { method: 'POST' }); toast('已结束'); load(); } catch (err) { toast(err.message, 'err'); }
          } }] : []),
          { label: '删除', icon: I.trash, danger: true, action: async () => {
            const ok = await confirmDialog({ title: '删除聊天室', message: '彻底删除这个聊天室及其短码，此操作不可撤销。', okText: '删除', danger: true });
            if (!ok) return;
            try { await api(`/api/rooms/${rm.id}`, { method: 'DELETE' }); toast('已删除'); load(); } catch (err) { toast(err.message, 'err'); }
          } },
        ]);
      }));
    }
    load();
  },
};

async function enterRoomAsOwner(rm) {
  const full = roomKeyUrl(rm.id);
  if (!full) {
    openModal({
      title: '无法以房主身份进入',
      body: `<p class="modal-text">房间密钥只保存在创建它的那个浏览器里。换了浏览器就只能用邀请链接以普通成员身份加入，无法进行房主管理。</p>`,
      footer: '<button class="btn btn-primary" data-close>知道了</button>',
    });
    return;
  }
  try {
    const { token } = await api(`/api/rooms/${rm.id}/enter`, { method: 'POST' });
    const hash = full.indexOf('#');
    const url = `${full.slice(0, hash)}?o=${encodeURIComponent(token)}${full.slice(hash)}`;
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function copyRoomLink(rm) {
  const full = roomKeyUrl(rm.id);
  if (full) return (await copyText(full)) && toast('已复制邀请链接');
  openModal({
    title: '无法复制完整链接',
    body: `<p class="modal-text">这个聊天室是端到端加密的，房间密钥只在创建时显示过一次。只有创建它的那个浏览器里才能重新复制完整邀请链接。你可以结束它再重新创建一个。</p>`,
    footer: '<button class="btn btn-primary" data-close>知道了</button>',
  });
}

const DISAPPEAR_CHOICES = [[0, '不消失'], [10, '10 秒'], [30, '30 秒'], [60, '1 分钟'], [180, '3 分钟']];

function openRoomComposer(domains, onSaved) {
  if (!domains.length) return toast('还没有可用的短链域名，请联系管理员', 'err');
  const caps = me.caps?.rooms || {};
  const memberCap = caps.max_members || 1000;
  const ipAllowed = (me.caps?.logs?.ip || 'full') === 'full';
  const state = { type: 'group', mode: 'motion', theme: 'min' };

  const m = openModal({
    title: '创建聊天室',
    xwide: true,
    onClose: () => preview?.destroy(),
    body: `
      <div class="composer">
        <form class="composer-form" novalidate>
          <div class="form-section">
            <div class="form-section-title">类型</div>
            <div class="mode-cards" id="rtype">${ROOM_TYPES.map((t) => `<button type="button" class="mode-card${t.id === state.type ? ' on' : ''}" data-rt="${t.id}"><b>${t.label}</b><span class="dim" style="font-size:12px">${t.hint}</span></button>`).join('')}</div>
            <div class="form-grid" style="margin-top:12px">
              <div class="field" id="maxBox"><label>人数上限</label><input class="input" type="number" name="max_members" min="2" max="${memberCap}" value="${Math.min(20, memberCap)}"></div>
              <div class="field"><label>备注 <span class="opt">只有你能看到</span></label><input class="input" name="label" maxlength="200" placeholder="例如：周末活动群"></div>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">消息显示<span>决定对方看到的消息长什么样，改参数右侧即时预览</span></div>
            <div class="mode-cards" id="rmode">${SECURE_MODES.map((x) => `<button type="button" class="mode-card${x.id === state.mode ? ' on' : ''}" data-rmode="${x.id}"><b>${x.label}${x.tag ? `<span class="mode-tag${x.anti ? ' anti' : ''}">${x.tag}</span>` : ''}</b></button>`).join('')}</div>
            <div class="field-hint" id="rmodeDesc"></div>
            <div class="subpanel" id="rmodeOpts"></div>
            <label class="toggle-row"><div class="txt"><b>按住才显示</b></div><span class="switch"><input type="checkbox" name="hold"><i></i></span></label>
            <label class="toggle-row"><div class="txt"><b>切出页面时隐藏</b></div><span class="switch"><input type="checkbox" name="hide_on_blur"><i></i></span></label>
            <div class="field" style="margin-top:4px"><label>阅后消失</label>
              <select class="select" name="disappear" style="max-width:220px">${DISAPPEAR_CHOICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">消息保留<span>焰信不保存任何消息</span></div>
            <select class="select" name="retain" style="max-width:260px" ${state.type === 'burn' ? 'disabled' : ''}>
              <option value="0">不保留（离线收不到）</option>
              <option value="30" selected>保留最近 30 条</option>
              <option value="100">保留最近 100 条</option>
              <option value="500">保留最近 500 条</option>
            </select>
          </div>

          <div class="form-section">
            <div class="form-section-title">成员互相可见</div>
            <div class="check-list">
              <label class="check-row"><input type="checkbox" name="v_device" checked><span>设备与浏览器</span></label>
              <label class="check-row"><input type="checkbox" name="v_geo" checked><span>所在地区（国家 / 城市）</span></label>
              <label class="check-row"><input type="checkbox" name="v_local_time"><span>当地时区</span></label>
              <label class="check-row"><input type="checkbox" name="v_ip" ${ipAllowed ? '' : 'disabled'}><span>IP 地址${ipAllowed ? '' : '（当前账户不可开启）'}</span></label>
              <label class="check-row"><input type="checkbox" name="v_typing" checked><span>正在输入</span></label>
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-title">进入控制</div>
            <div class="field"><label>房间密码 <span class="opt">可选</span></label><input class="input" name="password" type="text" autocomplete="off" placeholder="不设置"></div>
            <label class="toggle-row"><div class="txt"><b>仅限本站已登录用户</b><span>未登录的人无法进入</span></div><span class="switch"><input type="checkbox" name="login_required"><i></i></span></label>
          </div>

          <div class="form-section">
            <div class="form-section-title">链接</div>
            <div class="field"><div class="joined">
              <select class="select" name="domain_id">${domains.map((d) => `<option value="${d.id}">${esc(d.hostname)}</option>`).join('')}</select>
              <span class="sep">/</span>
              <input class="input mono" name="code" placeholder="留空随机生成" maxlength="64" autocapitalize="off" spellcheck="false">
            </div></div>
            <div class="field"><label>页面风格</label>
              <div class="theme-picks">${NOTE_THEMES.map((t) => `<button type="button" class="theme-pick${t.id === state.theme ? ' on' : ''}" data-rtheme="${t.id}"><i style="background:${t.swatch}"></i>${t.label}</button>`).join('')}</div>
            </div>
          </div>
          <div class="field-error" id="roomErr" hidden></div>
        </form>
        <aside class="composer-preview">
          <div class="preview-label">一条消息的样子</div>
          <div class="preview-phone"><div class="nt-scope nt-min" id="rPreviewScope" style="padding:18px"><div id="rPreview"></div></div></div>
          <p class="field-hint" style="text-align:center">端到端加密，服务器只转发密文</p>
        </aside>
      </div>`,
    footer: `<button class="btn btn-secondary" data-close>取消</button><button class="btn btn-primary" id="roomSave">${I.chat} 创建并生成链接</button>`,
  });
  const root = m.root;
  const val = (n) => $(`[name="${n}"]`, root);

  const slider = (name, label, min, max, step, def, fmt) =>
    `<div class="slider-row"><label>${label}<b data-out="${name}"></b></label><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${def}" data-fmt="${fmt || ''}"></div>`;
  function modeOptsHtml() {
    const mm = state.mode;
    if (mm === 'motion') return slider('mspeed', '滚动速度', 3, 30, 1, 14, 'x10') + slider('contrast', '对比度', 20, 100, 1, 100, 'pct');
    if (mm === 'comp') return slider('contrast', '对比度', 20, 100, 1, 82, 'pct') + slider('interval', '翻转间隔', 1, 6, 1, 1, 'frame');
    if (mm === 'type') return slider('chunk', '每次出现', 1, 10, 1, 2, 'char') + slider('speed', '间隔', 40, 400, 10, 120, 'ms');
    if (mm === 'window') return slider('window', '同时显示', 2, 14, 1, 6, 'char') + slider('speed', '间隔', 80, 600, 10, 220, 'ms');
    if (mm === 'countdown') return slider('seconds', '显示时长', 3, 120, 1, 30, 'sec');
    return '<p class="field-hint">打开即显示全文。</p>';
  }
  function paintOuts() {
    $$('[data-out]', root).forEach((out) => {
      const inp = val(out.dataset.out); if (!inp) return;
      const v = Number(inp.value), f = inp.dataset.fmt;
      out.textContent = f === 'x10' ? (v / 10).toFixed(1) + '×' : f === 'pct' ? v + '%' : f === 'char' ? v + ' 字' : f === 'ms' ? v + 'ms' : f === 'sec' ? v + ' 秒' : f === 'frame' ? v + ' 帧' : v;
    });
  }
  function readDisplay() {
    const num = (n, d) => (val(n) ? Number(val(n).value) : d);
    return {
      mode: state.mode,
      mspeed: num('mspeed', 14), contrast: num('contrast', state.mode === 'comp' ? 82 : 100),
      interval: num('interval', 1), chunk: num('chunk', 2),
      window: num('window', 6), speed: num('speed', state.mode === 'window' ? 220 : 120), seconds: num('seconds', 30),
    };
  }

  let preview = null;
  function paintPreview() {
    const scope = $('#rPreviewScope', root);
    scope.className = `nt-scope nt-${state.theme}`;
    preview?.destroy();
    const host = $('#rPreview', root);
    host.innerHTML = `<div class="rm-msg"><span class="rm-av" style="--c:#6b7cff">小</span><div class="rm-bubble"><div class="rm-who">小林</div><div class="rm-body"></div><div class="rm-time">20:41</div></div></div>`;
    preview = new SecureText($('.rm-body', host), { mode: state.mode, params: displayParams(readDisplay()), accent: '#6b7cff' });
    preview.setText('到了吗？我在二楼靠窗的位置');
  }
  const repaint = debounce(paintPreview, 200);
  function paintMode() {
    $('#rmodeDesc', root).textContent = SECURE_MODES.find((x) => x.id === state.mode)?.desc || '';
    $('#rmodeOpts', root).innerHTML = modeOptsHtml();
    paintOuts();
  }

  $$('[data-rt]', root).forEach((b) => b.addEventListener('click', () => {
    state.type = b.dataset.rt;
    $$('[data-rt]', root).forEach((x) => x.classList.toggle('on', x === b));
    $('#maxBox', root).style.display = state.type === 'dm' ? 'none' : '';
    val('retain').disabled = state.type === 'burn';
    if (state.type === 'burn') val('retain').value = '0';
  }));
  $$('[data-rmode]', root).forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.rmode;
    $$('[data-rmode]', root).forEach((x) => x.classList.toggle('on', x === b));
    paintMode();
    paintPreview();
  }));
  $$('[data-rtheme]', root).forEach((b) => b.addEventListener('click', () => {
    state.theme = b.dataset.rtheme;
    $$('[data-rtheme]', root).forEach((x) => x.classList.toggle('on', x === b));
    paintPreview();
  }));
  root.querySelector('.composer-form').addEventListener('input', (e) => { if (e.target.type === 'range') paintOuts(); repaint(); });
  paintMode();
  paintPreview();

  $('#roomSave', root).addEventListener('click', async (ev) => {
    const errEl = $('#roomErr', root);
    errEl.hidden = true;
    const body = {
      domain_id: Number(val('domain_id').value),
      type: state.type,
      max_members: Number(val('max_members')?.value) || 20,
      label: val('label').value.trim(),
      password: val('password').value || null,
      login_required: val('login_required').checked,
      policy: {
        retain: Number(val('retain').value),
        disappear: Number(val('disappear').value),
        hold: val('hold').checked,
        hide_on_blur: val('hide_on_blur').checked,
        display: readDisplay(),
        theme: { name: state.theme },
        visible: { device: val('v_device').checked, geo: val('v_geo').checked, local_time: val('v_local_time').checked, ip: val('v_ip').checked, typing: val('v_typing').checked },
      },
    };
    const code = val('code').value.trim();
    if (code) body.code = code;
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      // E2E room key, generated here and only ever in the invite link
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const key = buf2b64u(keyBytes);
      const { item } = await api('/api/rooms', { method: 'POST', body });
      const url = `${item.url}#k=${key}`;
      rememberRoomUrl(item.id, url);
      preview?.destroy();
      m.close();
      onSaved?.();
      showRoomCreated(item, url);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
}

function showRoomCreated(item, url) {
  const r = openModal({
    title: '聊天室已创建',
    body: `
      <div class="success-box">
        <div class="tick">${I.chat}</div>
        <div class="code-pill note-url">${esc(url)}</div>
        <p>${ROOM_TYPE_LABEL[item.type] || ''} · 把链接发给要聊天的人</p>
      </div>
      <div class="alert warn" style="margin-top:14px">${I.alert}<div># 后面是房间密钥，服务器上没有保存。所有参与者都用这个完整链接进入；之后只能在这个浏览器里重新复制。</div></div>`,
    footer: `<button class="btn btn-secondary" data-close>关闭</button><a class="btn btn-secondary" href="${esc(url)}" target="_blank" rel="noopener">进入</a><button class="btn btn-primary" id="copyRoom">${I.copy} 复制链接</button>`,
  });
  $('#copyRoom', r.root).addEventListener('click', async () => (await copyText(url)) && toast('已复制'));
}


/* ---------------- domains ---------------- */

routes['/domains'] = {
  title: '域名',
  key: 'domains',
  async render(content, topActions) {
    const admin = can.domains();
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
  need: () => can.content(),
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
          <select class="select" id="gKind">
            <option value="">全部类型</option>
            <option value="link">短链接</option>
            <option value="note">密信</option>
          </select>
        </div>
        <div id="glogBox"></div>
      </div>`;
    $('#gq').addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 1; load(); }, 350));
    $('#gDomain').addEventListener('change', (e) => { state.domain = e.target.value; state.page = 1; load(); });
    $('#gKind').addEventListener('change', (e) => { state.kind = e.target.value; state.page = 1; load(); });

    async function load() {
      const box = $('#glogBox');
      box.innerHTML = skeletonHtml(4);
      const params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.domain) params.set('domain_id', state.domain);
      if (state.kind) params.set('kind', state.kind);
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
        <thead><tr><th>短链</th><th>时间</th><th>IP</th><th>位置</th><th>客户端</th><th class="hide-md">来源</th><th>结果</th></tr></thead>
        <tbody>${logRowsHtml(data.items, true)}</tbody></table></div>
        ${pagerHtml(data.page, data.per_page, data.total)}`;
      $$('[data-page]', box).forEach((b) => b.addEventListener('click', () => { state.page = Number(b.dataset.page); load(); }));
    }
    load();
  },
};

/* ---------------- capability form (groups & per-user adjustments) ---------------- */

const SCOPE_OPTIONS = [
  ['links:read', '读取短链'],
  ['links:write', '创建/修改短链'],
  ['logs:read', '读取访问记录'],
  ['domains:read', '读取域名'],
  ['notes:read', '读取密信'],
  ['notes:write', '创建密信'],
  ['rooms:read', '读取聊天室'],
  ['rooms:write', '创建聊天室'],
];

const CAP_FIELDS = [
  { section: 'links', title: '短链接', fields: [
    { key: 'create', label: '可以创建短链', type: 'bool' },
    { key: 'max', label: '数量上限', type: 'int', hint: '0 表示不限' },
    { key: 'daily', label: '每天最多创建', type: 'int', hint: '0 表示不限' },
    { key: 'custom_code', label: '可以自定义后缀', type: 'bool', hint: '关闭后只能使用随机后缀，避免冒充 /login 这类地址' },
    { key: 'min_code_len', label: '后缀最短位数', type: 'int', min: 1, max: 10 },
    { key: 'modes', label: '可用跳转方式', type: 'list', options: [['direct', '直接跳转'], ['page', '动画中转页'], ['confirm', '确认页']], hint: '只保留确认页时，访客会先看到真实目的地' },
    { key: 'edit_target', label: '创建后可以修改目标', type: 'bool', hint: '关闭可防止先放正常地址、再换成钓鱼页' },
  ] },
  { section: 'notes', title: '密信', fields: [
    { key: 'create', label: '可以创建密信', type: 'bool' },
    { key: 'max_active', label: '进行中的密信上限', type: 'int', hint: '0 表示不限' },
    { key: 'daily', label: '每天最多创建', type: 'int', hint: '0 表示不限' },
    { key: 'e2e', label: '允许端到端加密', type: 'bool', hint: '关闭后使用服务端加密，被举报时管理员可以查看内容' },
    { key: 'max_opens', label: '打开次数上限', type: 'int', hint: '0 表示不限' },
    { key: 'max_ttl_hours', label: '最长有效期（小时）', type: 'int', hint: '0 表示不限' },
    { key: 'max_kb', label: '内容大小上限（KB）', type: 'int', min: 1, max: 64 },
    { key: 'webhook', label: '允许设置打开通知', type: 'bool', hint: '被打开时向作者填写的 https 地址推送事件；不信任的账号建议关闭' },
  ] },
  { section: 'logs', title: '访问记录', fields: [
    { key: 'view', label: '可以查看自己内容的访问记录', type: 'bool' },
    { key: 'ip', label: '访客 IP', type: 'enum', options: [['full', '完整显示'], ['masked', '打码'], ['none', '不显示']] },
    { key: 'export', label: '可以导出 CSV', type: 'bool' },
  ] },
  { section: 'api', title: 'API', fields: [
    { key: 'use', label: '可以创建 API 密钥', type: 'bool' },
    { key: 'scopes', label: '密钥可用范围', type: 'list', options: SCOPE_OPTIONS },
  ] },
  { section: 'rate', title: '限速', fields: [
    { key: 'per_minute', label: '每分钟最多创建', type: 'int', hint: '短链和密信合计，0 表示不限' },
  ] },
];

function capsFormHtml(caps, base = null) {
  return CAP_FIELDS.map((sec) => `
    <div class="cap-section">
      <div class="cap-title">${sec.title}</div>
      ${sec.fields.map((f) => {
        const v = caps?.[sec.section]?.[f.key];
        const changed = base && JSON.stringify(v) !== JSON.stringify(base?.[sec.section]?.[f.key]);
        const name = `cap.${sec.section}.${f.key}`;
        let ctl = '';
        if (f.type === 'bool') ctl = `<span class="switch"><input type="checkbox" name="${name}" ${v ? 'checked' : ''} aria-label="${esc(f.label)}"><i></i></span>`;
        else if (f.type === 'int') ctl = `<input class="input sm" type="number" name="${name}" value="${Number(v) || 0}" min="${f.min ?? 0}" ${f.max ? `max="${f.max}"` : ''} style="width:110px" aria-label="${esc(f.label)}">`;
        else if (f.type === 'enum') ctl = `<select class="select sm" name="${name}" style="width:auto" aria-label="${esc(f.label)}">${f.options.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        else if (f.type === 'list') ctl = `<div class="cap-chips">${f.options.map(([k, l]) => `<label class="cap-chip"><input type="checkbox" name="${name}" value="${k}" ${(v || []).includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
        return `<div class="cap-row${changed ? ' changed' : ''}${f.type === 'list' ? ' wide' : ''}" data-sec="${sec.section}" data-key="${f.key}">
          <div class="cap-label"><b>${f.label}${base ? ' <span class="badge badge-orange cap-badge">已调整</span>' : ''}</b>${f.hint ? `<span>${f.hint}</span>` : ''}</div>
          <div class="cap-ctl">${ctl}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

function readCapsForm(root) {
  const out = {};
  for (const sec of CAP_FIELDS) {
    out[sec.section] = {};
    for (const f of sec.fields) {
      const name = `cap.${sec.section}.${f.key}`;
      if (f.type === 'bool') out[sec.section][f.key] = !!root.querySelector(`[name="${name}"]`)?.checked;
      else if (f.type === 'int') out[sec.section][f.key] = Number(root.querySelector(`[name="${name}"]`)?.value) || 0;
      else if (f.type === 'enum') out[sec.section][f.key] = root.querySelector(`[name="${name}"]`)?.value;
      else if (f.type === 'list') out[sec.section][f.key] = $$(`[name="${name}"]:checked`, root).map((x) => x.value);
    }
  }
  return out;
}

function capsSummary(c) {
  if (!c) return '';
  const chips = [];
  chips.push(c.links.create ? `短链 ${c.links.max ? c.links.max + ' 条' : '不限'}` : '不能建短链');
  if (!c.links.custom_code) chips.push('仅随机后缀');
  if (c.links.modes.length === 1) chips.push({ direct: '仅直接跳转', page: '仅中转页', confirm: '强制确认页' }[c.links.modes[0]]);
  if (!c.links.edit_target) chips.push('不能改目标');
  chips.push(c.notes.create ? `密信 ${c.notes.max_active ? c.notes.max_active + ' 封' : '不限'}` : '不能建密信');
  if (!c.notes.e2e) chips.push('服务端加密');
  if (c.logs.ip !== 'full') chips.push(c.logs.ip === 'masked' ? 'IP 打码' : '不显示 IP');
  if (!c.api.use) chips.push('无 API');
  if (c.rate.per_minute) chips.push(`${c.rate.per_minute} 次/分钟`);
  return `<div class="chip-row">${chips.map((t) => `<span class="badge badge-gray">${esc(t)}</span>`).join('')}</div>`;
}

/* ---------------- users ---------------- */

function userStatusHtml(u) {
  if (u.frozen) return '<span class="status bad">已冻结</span>';
  if (u.disabled) return '<span class="status">已停用</span>';
  if (u.expires_at && u.expires_at < Date.now()) return '<span class="status warn">已过期</span>';
  if (u.expires_at) return `<span class="status ok">正常</span><div class="cell-sub">${fmtDate(u.expires_at, false)} 到期</div>`;
  return '<span class="status ok">正常</span>';
}

function roleBadge(u) {
  if (u.is_owner) return '<span class="badge badge-blue">所有者</span>';
  if (u.role === 'admin') return '<span class="badge badge-blue">管理员</span>';
  const tweaked = u.caps_override && Object.keys(u.caps_override).length;
  return `<span class="badge badge-gray">${esc(u.group?.name || '成员')}</span>${tweaked ? ' <span class="badge badge-orange" title="有个人权限调整">已调整</span>' : ''}`;
}

routes['/users'] = {
  title: '用户',
  key: 'users',
  need: () => can.users(),
  async render(content, topActions) {
    topActions.innerHTML = `<a class="btn btn-secondary" href="/access" data-nav>${I.ticket} 邀请链接</a><button class="btn btn-primary" id="addUserBtn">${I.plus} 新建用户</button>`;

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
          <thead><tr><th>用户</th><th>角色 / 用户组</th><th class="num">内容</th><th class="hide-md">登录方式</th><th>状态</th><th class="w-actions"></th></tr></thead>
          <tbody>
            ${data.items
              .map((u) => {
                const auth = [u.has_password ? '密码' : null, u.passkey_count ? `通行密钥 ×${u.passkey_count}` : null, u.login_link_count ? `登录链接 ×${u.login_link_count}` : null].filter(Boolean).join(' · ') || '—';
                return `<tr>
                  <td class="cell-main"><div style="display:flex;align-items:center;gap:10px">
                    <div class="avatar sm">${esc((u.display_name || u.username)[0].toUpperCase())}</div>
                    <div style="min-width:0"><b>${esc(u.username)}</b>${u.id === me.id ? ' <span class="badge badge-blue">我</span>' : ''}
                      <div class="cell-sub truncate" style="max-width:220px">${esc([u.display_name !== u.username ? u.display_name : null, u.note || null].filter(Boolean).join(' · ') || ' ')}</div></div>
                  </div></td>
                  <td class="clean">${roleBadge(u)}</td>
                  <td data-th="内容" class="num">${u.role === 'admin' ? '<span class="dim">—</span>' : `${fmtNum(u.link_count)}<div class="cell-sub">密信 ${fmtNum(u.note_count)}</div>`}</td>
                  <td class="dim hide-md">${auth}</td>
                  <td class="clean">${userStatusHtml(u)}</td>
                  <td class="cell-actions"><div class="row-actions">
                    <button class="icon-btn" data-uedit="${u.id}" title="编辑" aria-label="编辑">${I.pencil}</button>
                    ${u.id === me.id || u.is_owner ? '' : `<button class="icon-btn" data-umenu="${u.id}" title="更多" aria-label="更多">${I.dots}</button>`}
                  </div></td>
                </tr>`;
              })
              .join('')}
          </tbody></table></div>
        </div>`;
      const byId = new Map(data.items.map((u) => [String(u.id), u]));
      $$('[data-uedit]', content).forEach((b) => b.addEventListener('click', () => openUserEditor(byId.get(b.dataset.uedit), load)));
      $$('[data-umenu]', content).forEach((b) =>
        b.addEventListener('click', () => {
          const u = byId.get(b.dataset.umenu);
          const adminTarget = u.role === 'admin';
          openMenu(b, [
            ...(!adminTarget && !u.frozen ? [{ label: '创建登录链接', icon: I.ticket, action: () => openLoginLinkModal(u, load) }] : []),
            u.frozen
              ? { label: '解除冻结', icon: I.check, action: () => freezeUser(u, false, load) }
              : { label: '冻结账户', icon: I.snow, danger: true, action: () => freezeUser(u, true, load) },
            '-',
            { label: '删除用户', icon: I.trash, danger: true, action: async () => {
              const ok = await confirmDialog({ title: '删除用户', message: `确定删除用户 <b>${esc(u.username)}</b> 吗？其会话、通行密钥、API 密钥和登录链接都会被清除，创建的内容保留（转为无主）。`, okText: '删除', danger: true });
              if (!ok) return;
              try {
                await api(`/api/users/${u.id}`, { method: 'DELETE' });
                toast('用户已删除');
                load();
              } catch (err) {
                toast(err.message, 'err');
              }
            } },
          ]);
        })
      );
    }
    $('#addUserBtn').addEventListener('click', () => openUserEditor(null, load));
    load();
  },
};

async function freezeUser(u, frozen, onDone) {
  if (frozen) {
    const ok = await confirmDialog({
      title: '冻结账户',
      message: `冻结 <b>${esc(u.username)}</b> 会立即：停用账户、停用他创建的全部短链和密信、注销所有登录设备、撤销他的登录链接。之后可以随时解除冻结并恢复内容。`,
      okText: '冻结',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    const r = await api(`/api/users/${u.id}/freeze`, { method: 'POST', body: { frozen } });
    toast(frozen ? `已冻结，停用了 ${r.disabled_items} 条内容` : `已解除冻结，恢复了 ${r.restored} 条内容`);
    onDone?.();
  } catch (err) {
    toast(err.message, 'err');
  }
}

const EXPIRY_CHOICES = [
  ['', '长期有效'],
  ['7', '7 天后到期'],
  ['30', '30 天后到期'],
  ['90', '90 天后到期'],
  ['date', '指定日期'],
];

async function openUserEditor(user, onSaved) {
  const isNew = !user;
  let groups = [];
  let domains = [];
  try {
    const [g, d] = await Promise.all([api('/api/groups'), api('/api/domains')]);
    groups = g.items;
    domains = d.items.filter((x) => !x.is_admin);
  } catch (err) {
    toast(err.message, 'err');
    return;
  }
  const memberGroup = groups.find((g) => g.builtin === 'member') || groups[0];
  const u = user || { role: 'user', group_id: memberGroup?.id, domain_ids: domains.map((x) => x.id), caps: memberGroup?.caps, caps_override: {}, admin_perms: { users: true, domains: true, settings: true, content: true } };
  const self = !isNew && user.id === me.id;
  const canChangeRole = me.is_owner && !u.is_owner;
  const groupOf = (id) => groups.find((g) => g.id === Number(id));
  const hasOverride = !isNew && Object.keys(user.caps_override || {}).length > 0;

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
          <div class="field"><label>备注 <span class="opt">只有管理员能看到</span></label><input class="input" name="note" value="${esc(u.note || '')}" maxlength="200" placeholder="例如：项目外包，11 月底到期"></div>
        </div>
        <div class="form-section">
          <div class="form-section-title">登录方式<span>${isNew ? '可以不设密码，只通过登录链接登录' : '留空则不修改密码'}</span></div>
          <div class="form-grid">
            <div class="field"><label>${isNew ? '初始密码' : '重置密码'} <span class="opt">可选</span></label>
              <input class="input" type="password" name="password" autocomplete="new-password" placeholder="至少 8 位">
            </div>
          </div>
          <label class="toggle-row"><div class="txt"><b>首次登录时必须修改密码</b><span>设置了密码时生效，对方登录后要先改成自己的密码</span></div><span class="switch"><input type="checkbox" name="must_change_password" ${isNew || u.must_change_password ? 'checked' : ''}><i></i></span></label>
        </div>
        <div class="form-section">
          <div class="form-section-title">角色</div>
          <div class="seg block" style="max-width:360px">
            <button type="button" class="${u.role !== 'admin' ? 'on' : ''}" data-role="user" ${canChangeRole ? '' : 'disabled'}>成员</button>
            <button type="button" class="${u.role === 'admin' ? 'on' : ''}" data-role="admin" ${canChangeRole ? '' : 'disabled'}>管理员</button>
          </div>
          ${!canChangeRole && !u.is_owner ? '<div class="field-hint">只有所有者可以设置管理员</div>' : ''}
          ${u.is_owner ? '<div class="field-hint">所有者拥有全部权限，不能修改角色</div>' : ''}
          <div id="adminBox" ${u.role === 'admin' ? '' : 'hidden'} style="margin-top:14px">
            <div class="check-list">
              ${[['users', '管理用户', '用户、用户组、邀请和登录链接、操作日志'], ['domains', '管理域名', '绑定、修改、删除域名'], ['settings', '管理设置', '站点设置和数据清理'], ['content', '查看全部内容', '所有人的短链、密信和访问记录']]
                .map(([k, l, h]) => `<label class="check-row"><input type="checkbox" name="ap_${k}" ${u.admin_perms?.[k] ? 'checked' : ''} ${me.is_owner && !u.is_owner ? '' : 'disabled'}><span>${l}</span><span class="sub">${h}</span></label>`)
                .join('')}
            </div>
          </div>
        </div>
        <div id="memberBox" ${u.role === 'admin' ? 'hidden' : ''}>
          <div class="form-section">
            <div class="form-section-title">用户组</div>
            <select class="select" name="group_id" style="max-width:360px">
              ${groups.map((g) => `<option value="${g.id}" ${Number(u.group_id) === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
            </select>
            <div class="field-hint" id="groupDesc"></div>
            <div id="groupSummary" style="margin-top:10px"></div>
          </div>
          <div class="form-section">
            <div class="form-section-title">可用域名</div>
            ${domains.length
              ? `<div class="check-list">${domains.map((d) => `<label class="check-row"><input type="checkbox" name="dom_${d.id}" ${(u.domain_ids || []).includes?.(d.id) ? 'checked' : ''}><span>${esc(d.hostname)}</span>${d.remark ? `<span class="sub">${esc(d.remark)}</span>` : ''}</label>`).join('')}</div>`
              : '<p class="field-hint">还没有短链域名</p>'}
          </div>
          <div class="form-section">
            <details class="cap-details" id="capDetails" ${hasOverride ? 'open' : ''}>
              <summary><span>个人权限调整</span><span class="sub">${hasOverride ? '这个账户有单独调整' : '在用户组之上单独放宽或收紧'}</span>${I.chevRight.replace('<svg', '<svg class="chev"')}</summary>
              <div id="capBox"></div>
              ${hasOverride ? '<button type="button" class="btn btn-secondary btn-sm" id="capReset" style="margin-top:12px">恢复为用户组设置</button>' : ''}
            </details>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">账户有效期${u.expires_at ? `<span>当前：${fmtDate(u.expires_at)} 到期</span>` : ''}</div>
          <div class="input-row" style="max-width:420px">
            <select class="select" name="expiry" ${self ? 'disabled' : ''}>
              ${!isNew ? '<option value="keep" selected>保持不变</option>' : ''}
              ${EXPIRY_CHOICES.map(([v, l]) => `<option value="${v}" ${isNew && v === '' ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <input class="input" type="date" name="expiry_date" hidden>
          </div>
          <div class="field-hint">到期后账户自动停用，内容保留</div>
        </div>
        ${!self && !u.is_owner ? `
        <div class="form-section">
          <label class="toggle-row">
            <div class="txt"><b>停用账户</b><span>停用后无法登录，现有会话立即失效。需要同时停用他的内容时，请用「冻结账户」</span></div>
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
  let capsTouched = false;
  let capsReset = false;

  const paintGroup = (resetCaps) => {
    const g = groupOf($('[name="group_id"]', root)?.value);
    $('#groupDesc', root).textContent = g?.description || '';
    $('#groupSummary', root).innerHTML = g ? capsSummary(g.caps) : '';
    const effective = resetCaps || isNew ? g?.caps : user.caps;
    $('#capBox', root).innerHTML = capsFormHtml(effective, g?.caps);
    capsTouched = false;
  };
  if ($('[name="group_id"]', root)) {
    paintGroup(false);
    $('[name="group_id"]', root).addEventListener('change', () => {
      paintGroup(true);
      const g = groupOf($('[name="group_id"]', root).value);
      if (isNew && g?.builtin === 'restricted') $('[name="expiry"]', root).value = '30';
    });
  }
  $('#capBox', root)?.addEventListener('input', (e) => {
    capsTouched = true;
    const row = e.target.closest('.cap-row');
    const g = groupOf($('[name="group_id"]', root).value);
    if (!row || !g) return;
    const now = readCapsForm($('#capBox', root));
    const { sec, key } = row.dataset;
    row.classList.toggle('changed', JSON.stringify(now[sec][key]) !== JSON.stringify(g.caps[sec][key]));
  });
  $('#capReset', root)?.addEventListener('click', () => {
    capsReset = true;
    paintGroup(true);
    toast('保存后恢复为用户组设置');
  });
  $$('[data-role]', root).forEach((b) =>
    b.addEventListener('click', () => {
      role = b.dataset.role;
      $$('[data-role]', root).forEach((x) => x.classList.toggle('on', x === b));
      $('#adminBox', root).hidden = role !== 'admin';
      $('#memberBox', root).hidden = role === 'admin';
    })
  );
  $('[name="expiry"]', root).addEventListener('change', (e) => {
    $('[name="expiry_date"]', root).hidden = e.target.value !== 'date';
  });

  $('#userSave', root).addEventListener('click', async () => {
    const errEl = $('#userErr', root);
    errEl.hidden = true;
    const body = {
      display_name: $('[name="display_name"]', root).value.trim(),
      note: $('[name="note"]', root).value.trim(),
      must_change_password: $('[name="must_change_password"]', root).checked,
    };
    if (canChangeRole) body.role = role;
    if (role === 'admin' && me.is_owner && !u.is_owner) {
      body.admin_perms = Object.fromEntries(['users', 'domains', 'settings', 'content'].map((k) => [k, $(`[name="ap_${k}"]`, root).checked]));
    }
    if (role === 'user') {
      body.group_id = Number($('[name="group_id"]', root).value);
      body.domain_ids = domains.filter((d) => $(`[name="dom_${d.id}"]`, root)?.checked).map((d) => d.id);
      if (capsReset && !capsTouched) body.caps_override = null;
      else if (capsTouched) body.caps_override = readCapsForm($('#capBox', root));
    }
    const pw = $('[name="password"]', root).value;
    if (pw) body.password = pw;
    const exp = $('[name="expiry"]', root).value;
    if (exp === 'date') {
      const v = $('[name="expiry_date"]', root).value;
      if (!v) {
        errEl.textContent = '请选择到期日期';
        errEl.hidden = false;
        return;
      }
      body.expires_at = new Date(v + 'T23:59:59').getTime();
    } else if (exp === '') body.expires_at = null;
    else if (exp !== 'keep') body.expires_in_days = Number(exp);
    const disabledEl = $('[name="disabled"]', root);
    if (disabledEl) body.disabled = disabledEl.checked;
    try {
      if (isNew) {
        const created = await api('/api/users', { method: 'POST', body: { ...body, username: $('[name="username"]', root).value.trim() } });
        m.close();
        toast('用户已创建');
        onSaved?.();
        if (!pw && created.item.role === 'user') {
          const go = await confirmDialog({ title: '还没有登录方式', message: `<b>${esc(created.item.username)}</b> 没有设置密码。要现在给他创建一个登录链接吗？`, okText: '创建登录链接' });
          if (go) openLoginLinkModal(created.item, onSaved);
        }
      } else {
        await api(`/api/users/${user.id}`, { method: 'PATCH', body });
        toast('已保存');
        m.close();
        if (self) await loadMe();
        onSaved?.();
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });
}

/* ---------------- user groups ---------------- */

routes['/groups'] = {
  title: '用户组',
  key: 'groups',
  need: () => can.users(),
  async render(content, topActions) {
    topActions.innerHTML = `<button class="btn btn-primary" id="addGroupBtn">${I.plus} 新建用户组</button>`;
    let data;
    async function load() {
      try {
        data = await api('/api/groups');
      } catch (err) {
        content.innerHTML = errorHtml(err);
        return;
      }
      content.innerHTML = `
        <div class="note" style="margin-bottom:16px"><div class="note-body" style="padding:12px 16px">用户组决定成员能做什么、能用多少。管理员不受用户组限制。修改用户组会立即影响组里的所有成员，个人调整过的项目除外。</div></div>
        <div class="group-grid">
          ${data.items.map((g) => `
            <div class="card group-card">
              <div class="card-head"><h3>${esc(g.name)}</h3>${g.builtin ? '<span class="badge badge-gray">预设</span>' : ''}<div class="right">${fmtNum(g.members)} 位成员</div></div>
              <div class="card-body" style="display:grid;gap:10px;align-content:start">
                <p class="dim" style="font-size:13px;min-height:20px">${esc(g.description || '—')}</p>
                ${capsSummary(g.caps)}
              </div>
              <div class="card-foot">
                <button class="btn btn-secondary btn-sm" data-gcopy="${g.id}">复制</button>
                ${g.members ? '' : `<button class="btn btn-secondary btn-sm" data-gdel="${g.id}">删除</button>`}
                <button class="btn btn-primary btn-sm" data-gedit="${g.id}">编辑</button>
              </div>
            </div>`).join('')}
        </div>`;
      const byId = new Map(data.items.map((g) => [String(g.id), g]));
      $$('[data-gedit]', content).forEach((b) => b.addEventListener('click', () => openGroupEditor(byId.get(b.dataset.gedit), load)));
      $$('[data-gcopy]', content).forEach((b) => b.addEventListener('click', () => {
        const g = byId.get(b.dataset.gcopy);
        openGroupEditor({ name: `${g.name} 副本`, description: g.description, caps: g.caps }, load, true);
      }));
      $$('[data-gdel]', content).forEach((b) => b.addEventListener('click', async () => {
        const g = byId.get(b.dataset.gdel);
        const ok = await confirmDialog({ title: '删除用户组', message: `确定删除 <b>${esc(g.name)}</b> 吗？`, okText: '删除', danger: true });
        if (!ok) return;
        try {
          await api(`/api/groups/${g.id}`, { method: 'DELETE' });
          toast('已删除');
          load();
        } catch (err) {
          toast(err.message, 'err');
        }
      }));
    }
    $('#addGroupBtn').addEventListener('click', () => {
      const base = data?.items.find((g) => g.builtin === 'member');
      openGroupEditor({ name: '', description: '', caps: base?.caps || data?.defaults }, load, true);
    });
    load();
  },
};

function openGroupEditor(group, onSaved, isNew = false) {
  const m = openModal({
    title: isNew ? '新建用户组' : `编辑 ${group.name}`,
    wide: true,
    body: `
      <form novalidate>
        <div class="form-section">
          <div class="form-grid">
            <div class="field"><label>名称</label><input class="input" name="gname" value="${esc(group.name || '')}" maxlength="30"></div>
            <div class="field"><label>说明 <span class="opt">可选</span></label><input class="input" name="gdesc" value="${esc(group.description || '')}" maxlength="200"></div>
          </div>
        </div>
        <div class="form-section"><div id="capBox">${capsFormHtml(group.caps)}</div></div>
        <div class="field-error" id="gErr" hidden></div>
      </form>`,
    footer: `<button class="btn btn-secondary" data-close>取消</button><button class="btn btn-primary" id="gSave">${isNew ? '创建' : '保存'}</button>`,
  });
  $('#gSave', m.root).addEventListener('click', async () => {
    const body = { name: $('[name="gname"]', m.root).value.trim(), description: $('[name="gdesc"]', m.root).value.trim(), caps: readCapsForm($('#capBox', m.root)) };
    try {
      if (isNew) await api('/api/groups', { method: 'POST', body });
      else await api(`/api/groups/${group.id}`, { method: 'PATCH', body });
      toast(isNew ? '用户组已创建' : '已保存');
      m.close();
      onSaved?.();
    } catch (err) {
      $('#gErr', m.root).textContent = err.message;
      $('#gErr', m.root).hidden = false;
    }
  });
}

/* ---------------- invite & login links ---------------- */

const accessState = { kind: 'invite' };

function tokenStatusHtml(t) {
  return {
    active: '<span class="status ok">可用</span>',
    revoked: '<span class="status">已撤销</span>',
    expired: '<span class="status warn">已过期</span>',
    used_up: '<span class="status">次数用完</span>',
  }[t.status];
}

function showTokenUrl(title, url, hint) {
  const r = openModal({
    title,
    body: `
      <div class="alert warn">${I.alert}<div>${hint}</div></div>
      <div class="key-reveal" style="margin-top:14px">${esc(url)}</div>`,
    footer: `<button class="btn btn-secondary" data-close>关闭</button><button class="btn btn-primary" id="copyTk">${I.copy} 复制链接</button>`,
  });
  $('#copyTk', r.root).addEventListener('click', async () => (await copyText(url)) && toast('已复制'));
}

async function openLoginLinkModal(user, onDone) {
  let users = [];
  if (!user) {
    try {
      users = (await api('/api/users')).items.filter((u) => u.role === 'user' && !u.frozen);
    } catch (err) {
      return toast(err.message, 'err');
    }
    if (!users.length) return toast('还没有可以创建登录链接的成员账户', 'err');
  }
  const m = openModal({
    title: user ? `给 ${user.username} 创建登录链接` : '创建登录链接',
    body: `
      <form novalidate>
        ${user ? '' : `<div class="field"><label>账户</label><select class="select" name="uid">${users.map((u) => `<option value="${u.id}">${esc(u.username)}（${esc(u.group?.name || '成员')}）</option>`).join('')}</select></div>`}
        <div class="field"><label>备注 <span class="opt">可选</span></label><input class="input" name="label" maxlength="60" placeholder="例如：发给小王"></div>
        <div class="form-grid">
          <div class="field"><label>可使用次数</label>
            <select class="select" name="uses"><option value="1">1 次</option><option value="5">5 次</option><option value="0" selected>不限</option></select>
          </div>
          <div class="field"><label>有效期</label>
            <select class="select" name="hours"><option value="1">1 小时</option><option value="24">1 天</option><option value="168" selected>7 天</option><option value="720">30 天</option><option value="0">长期</option></select>
          </div>
        </div>
        <p class="field-hint">打开链接的人会直接以这个账户登录，不需要密码。请只发给你信任的那个人，泄露后可以随时撤销。</p>
        <div class="field-error" id="llErr" hidden></div>
      </form>`,
    footer: `<button class="btn btn-secondary" data-close>取消</button><button class="btn btn-primary" id="llSave">创建</button>`,
  });
  $('#llSave', m.root).addEventListener('click', async () => {
    try {
      const r = await api('/api/access-tokens', {
        method: 'POST',
        body: {
          kind: 'login',
          user_id: user ? user.id : Number($('[name="uid"]', m.root).value),
          label: $('[name="label"]', m.root).value.trim(),
          max_uses: Number($('[name="uses"]', m.root).value),
          expires_in_hours: Number($('[name="hours"]', m.root).value),
        },
      });
      m.close();
      showTokenUrl('登录链接已创建', r.url, '链接只显示这一次。拿到链接的人可以直接登录，请通过私密渠道发送。');
      onDone?.();
    } catch (err) {
      $('#llErr', m.root).textContent = err.message;
      $('#llErr', m.root).hidden = false;
    }
  });
}

async function openInviteModal(onDone) {
  let groups = [];
  let domains = [];
  try {
    const [g, d] = await Promise.all([api('/api/groups'), api('/api/domains')]);
    groups = g.items;
    domains = d.items.filter((x) => !x.is_admin);
  } catch (err) {
    return toast(err.message, 'err');
  }
  const m = openModal({
    title: '创建邀请链接',
    wide: true,
    body: `
      <form novalidate>
        <div class="form-section">
          <div class="form-grid">
            <div class="field"><label>备注 <span class="opt">可选</span></label><input class="input" name="label" maxlength="60" placeholder="例如：活动志愿者"></div>
            <div class="field"><label>加入的用户组</label><select class="select" name="gid">${groups.map((g) => `<option value="${g.id}" ${g.builtin === 'member' ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
          </div>
          <div id="invSummary"></div>
        </div>
        <div class="form-section">
          <div class="form-section-title">可用域名</div>
          ${domains.length ? `<div class="check-list">${domains.map((d) => `<label class="check-row"><input type="checkbox" name="dom_${d.id}" checked><span>${esc(d.hostname)}</span>${d.remark ? `<span class="sub">${esc(d.remark)}</span>` : ''}</label>`).join('')}</div>` : '<p class="field-hint">还没有短链域名</p>'}
        </div>
        <div class="form-section">
          <div class="form-grid">
            <div class="field"><label>可注册人数</label><select class="select" name="uses"><option value="1" selected>1 人</option><option value="5">5 人</option><option value="20">20 人</option><option value="0">不限</option></select></div>
            <div class="field"><label>链接有效期</label><select class="select" name="hours"><option value="24">1 天</option><option value="72" selected>3 天</option><option value="168">7 天</option><option value="720">30 天</option><option value="0">长期</option></select></div>
          </div>
          <div class="field"><label>新账户有效期</label><select class="select" name="days" style="max-width:240px"><option value="0">长期</option><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select></div>
        </div>
        <div class="field-error" id="invErr" hidden></div>
      </form>`,
    footer: `<button class="btn btn-secondary" data-close>取消</button><button class="btn btn-primary" id="invSave">创建</button>`,
  });
  const paint = () => {
    const g = groups.find((x) => x.id === Number($('[name="gid"]', m.root).value));
    $('#invSummary', m.root).innerHTML = g ? `<div class="field-hint" style="margin-bottom:6px">${esc(g.description || '')}</div>${capsSummary(g.caps)}` : '';
    if (g?.builtin === 'restricted' && $('[name="days"]', m.root).value === '0') $('[name="days"]', m.root).value = '30';
  };
  paint();
  $('[name="gid"]', m.root).addEventListener('change', paint);
  $('#invSave', m.root).addEventListener('click', async () => {
    try {
      const r = await api('/api/access-tokens', {
        method: 'POST',
        body: {
          kind: 'invite',
          label: $('[name="label"]', m.root).value.trim(),
          group_id: Number($('[name="gid"]', m.root).value),
          domain_ids: domains.filter((d) => $(`[name="dom_${d.id}"]`, m.root)?.checked).map((d) => d.id),
          max_uses: Number($('[name="uses"]', m.root).value),
          expires_in_hours: Number($('[name="hours"]', m.root).value),
          account_days: Number($('[name="days"]', m.root).value),
        },
      });
      m.close();
      showTokenUrl('邀请链接已创建', r.url, '链接只显示这一次。对方打开后自己设置用户名和密码。');
      onDone?.();
    } catch (err) {
      $('#invErr', m.root).textContent = err.message;
      $('#invErr', m.root).hidden = false;
    }
  });
}

routes['/access'] = {
  title: '邀请与登录链接',
  key: 'access',
  need: () => can.users(),
  async render(content, topActions) {
    topActions.innerHTML = `<button class="btn btn-secondary" id="newLogin">${I.ticket} 登录链接</button><button class="btn btn-primary" id="newInvite">${I.plus} 邀请链接</button>`;
    content.innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="seg"><button data-kind="invite" class="${accessState.kind === 'invite' ? 'on' : ''}">邀请链接</button><button data-kind="login" class="${accessState.kind === 'login' ? 'on' : ''}">登录链接</button></div>
          <div class="spacer"></div>
          <span class="dim" style="font-size:12.5px" id="accessHint"></span>
        </div>
        <div id="accessList"></div>
      </div>`;
    async function load() {
      const box = $('#accessList');
      $('#accessHint').textContent = accessState.kind === 'invite' ? '对方用邀请链接自己注册账户' : '打开即以指定账户登录，无需密码';
      box.innerHTML = skeletonHtml(3);
      let data;
      try {
        data = await api(`/api/access-tokens?kind=${accessState.kind}`);
      } catch (err) {
        box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
        return;
      }
      if (!data.items.length) {
        box.innerHTML = emptyHtml('ticket', accessState.kind === 'invite' ? '还没有邀请链接' : '还没有登录链接', accessState.kind === 'invite' ? '创建邀请链接，让别人自己注册到指定用户组' : '给某个成员创建登录链接，对方点开就能登录');
        return;
      }
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>链接</th><th>${accessState.kind === 'invite' ? '用户组' : '账户'}</th><th class="num">已使用</th><th>有效期</th><th>状态</th><th class="w-actions"></th></tr></thead>
          <tbody>${data.items.map((t) => `
            <tr>
              <td class="cell-main"><b>${esc(t.label || '未命名')}</b><div class="cell-sub" style="font-family:var(--mono)">${esc(t.prefix)}…${t.creator ? ` · ${esc(t.creator)} 创建` : ''}</div></td>
              <td class="clean">${accessState.kind === 'invite' ? `<span class="badge badge-gray">${esc(t.group?.name || '—')}</span>${t.account_days ? `<div class="cell-sub">账户 ${t.account_days} 天</div>` : ''}` : esc(t.user?.username || '—')}</td>
              <td data-th="已使用" class="num">${t.uses}${t.max_uses ? ` / ${t.max_uses}` : ''}</td>
              <td data-th="有效期" class="nowrap dim">${t.expires_at ? fmtDate(t.expires_at) : '长期'}</td>
              <td class="clean">${tokenStatusHtml(t)}</td>
              <td class="cell-actions"><div class="row-actions">${t.status === 'active' ? `<button class="btn btn-secondary btn-sm" data-revoke="${t.id}">撤销</button>` : ''}</div></td>
            </tr>`).join('')}
          </tbody></table></div>`;
      $$('[data-revoke]', box).forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: '撤销链接', message: '撤销后这个链接立即失效。已经用它注册或登录的账户不受影响。', okText: '撤销', danger: true });
        if (!ok) return;
        await api(`/api/access-tokens/${b.dataset.revoke}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'err'));
        toast('已撤销');
        load();
      }));
    }
    $$('[data-kind]', content).forEach((b) => b.addEventListener('click', () => {
      accessState.kind = b.dataset.kind;
      $$('[data-kind]', content).forEach((x) => x.classList.toggle('on', x === b));
      load();
    }));
    $('#newInvite').addEventListener('click', () => openInviteModal(() => {
      accessState.kind = 'invite';
      render();
    }));
    $('#newLogin').addEventListener('click', () => openLoginLinkModal(null, () => {
      accessState.kind = 'login';
      render();
    }));
    load();
  },
};

/* ---------------- audit log ---------------- */

const AUDIT_LABELS = {
  'login.password': '密码登录',
  'login.passkey': '通行密钥登录',
  'login.link': '登录链接登录',
  'login.failed': '登录失败',
  'password.change': '修改密码',
  'user.create': '创建用户',
  'user.update': '修改用户',
  'user.delete': '删除用户',
  'user.freeze': '冻结账户',
  'user.unfreeze': '解除冻结',
  'group.create': '创建用户组',
  'group.update': '修改用户组',
  'group.delete': '删除用户组',
  'invite.create': '创建邀请链接',
  'invite.revoke': '撤销邀请链接',
  'invite.use': '通过邀请注册',
  'login_link.create': '创建登录链接',
  'login_link.revoke': '撤销登录链接',
  'domain.create': '绑定域名',
  'domain.update': '修改域名',
  'domain.delete': '删除域名',
  'settings.update': '修改设置',
  'maintenance.run': '立即清理',
  'note.view_content': '查看密信内容',
  'note.burn': '销毁他人密信',
  'note.delete': '删除他人密信',
  'link.delete': '删除他人短链',
  'key.revoke': '吊销他人密钥',
};

routes['/audit'] = {
  title: '操作日志',
  key: 'audit',
  need: () => can.users(),
  async render(content) {
    const state = { page: 1 };
    content.innerHTML = `<div class="card"><div id="auditBox"></div></div>`;
    async function load() {
      const box = $('#auditBox');
      box.innerHTML = skeletonHtml(5);
      let data;
      try {
        data = await api(`/api/audit?page=${state.page}`);
      } catch (err) {
        box.innerHTML = `<div style="padding:16px">${errorHtml(err)}</div>`;
        return;
      }
      if (!data.items.length) {
        box.innerHTML = emptyHtml('scroll', '还没有记录', '登录、账户和管理操作会记录在这里');
        return;
      }
      box.innerHTML = `
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>详情</th><th class="hide-md">IP</th></tr></thead>
          <tbody>${data.items.map((a) => {
            const bad = ['login.failed', 'user.freeze', 'note.view_content'].includes(a.action);
            return `<tr>
              <td class="nowrap dim cell-main">${fmtDate(a.ts)}</td>
              <td class="clean">${esc(a.actor_name || (a.actor_id ? `#${a.actor_id}` : '—'))}</td>
              <td class="clean"><span class="badge ${bad ? 'badge-orange' : 'badge-gray'}">${esc(AUDIT_LABELS[a.action] || a.action)}</span></td>
              <td class="dim cell-block"><div class="truncate" style="max-width:360px" title="${esc(a.detail)}">${esc(a.detail || '')}</div></td>
              <td class="dim hide-md"><span class="mono-num">${esc(a.ip || '')}</span></td>
            </tr>`;
          }).join('')}</tbody></table></div>
        ${pagerHtml(data.page, data.per_page, data.total)}`;
      $$('[data-page]', box).forEach((b) => b.addEventListener('click', () => {
        state.page = Number(b.dataset.page);
        load();
      }));
    }
    load();
  },
};

/* ---------------- api keys ---------------- */

routes['/keys'] = {
  title: 'API 密钥',
  key: 'keys',
  async render(content, topActions) {
    const canApi = !!me.caps?.api?.use;
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
          <thead><tr><th>名称</th><th>权限</th><th>最近使用</th><th>过期</th>${can.users() ? '<th class="hide-md">所有者</th>' : ''}<th class="w-actions"></th></tr></thead>
          <tbody>
            ${data.items
              .map((k) => `
            <tr>
              <td class="cell-main"><b>${esc(k.name)}</b><div class="cell-sub" style="font-family:var(--mono)">${esc(k.prefix)}…</div></td>
              <td class="clean cell-block"><div class="chip-row">${k.scopes.map((s) => `<span class="badge badge-gray">${esc(s)}</span>`).join('')}</div></td>
              <td data-th="最近使用" class="nowrap dim">${k.last_used_at ? fmtRelative(k.last_used_at) : '从未'}</td>
              <td data-th="过期" class="nowrap dim">${k.expires_at ? (k.expires_at < Date.now() ? '<span class="status bad">已过期</span>' : fmtDate(k.expires_at, false)) : '永不过期'}</td>
              ${can.users() ? `<td class="dim hide-md">${esc(k.owner?.username || '—')}${k.mine ? ' <span class="badge badge-blue">我</span>' : ''}</td>` : ''}
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
  { value: 'notes:read', label: '读取密信' },
  { value: 'notes:write', label: '创建 / 删除密信' },
  { value: 'rooms:read', label: '读取聊天室' },
  { value: 'rooms:write', label: '创建 / 删除聊天室' },
];

function openKeyEditor(onSaved) {
  const m = openModal({
    title: '创建 API 密钥',
    body: `
      <form id="keyForm" novalidate>
        <div class="field"><label>名称</label><input class="input" name="name" placeholder="例如：自动化脚本" maxlength="60"></div>
        <div class="field"><label>权限范围</label>
          <div class="check-list">
            ${SCOPES.filter((s) => (me.caps?.api?.scopes || []).includes(s.value)).map((s) => `<label class="check-row"><input type="checkbox" name="sc_${s.value}" ${s.value === 'links:write' ? '' : 'checked'}><span>${s.label}</span><code class="sub">${s.value}</code></label>`).join('')}
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
    const scopes = SCOPES.filter((s) => $(`[name="sc_${s.value}"]`, m.root)?.checked).map((s) => s.value);
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
  need: () => can.settings(),
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
          <div><dt>进行中的密信</dt><dd>${fmtNum(c.notes)}<small>封</small></dd></div>
          <div><dt>API 密钥</dt><dd>${fmtNum(c.keys)}<small>个</small></dd></div>
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
    const adminScopes = [['users', '用户'], ['domains', '域名'], ['settings', '设置'], ['content', '全部内容']].filter(([k]) => me.admin_perms?.[k]).map(([, l]) => l);
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>账户</h3><span class="badge ${admin ? 'badge-blue' : 'badge-gray'}">${esc(roleLabel(me))}</span>${me.expires_at ? `<div class="right">${fmtDate(me.expires_at)} 到期</div>` : ''}</div>
        ${settingRow('用户名', admin ? (me.is_owner ? '拥有全部权限' : `可管理：${adminScopes.join('、') || '无'}`) : `${Array.isArray(me.domain_ids) ? me.domain_ids.length : '全部'} 个可用域名`, `<input class="input" value="${esc(me.username)}" disabled>`)}
        ${settingRow('显示名称', '显示在侧边栏与列表中', `<div class="input-row"><input class="input" id="pfName" value="${esc(me.display_name || '')}" maxlength="60"><button class="btn btn-secondary" id="pfNameSave">保存</button></div>`)}
        ${admin ? '' : `<div class="setting-row"><div class="txt"><b>我的权限</b><span>由管理员设置</span></div><div class="ctl" style="justify-content:flex-start">${capsSummary(me.caps)}</div></div>`}
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
