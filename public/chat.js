// Chat room client — join screen, live WebSocket, message rendering.
// Messages are end-to-end encrypted with the room key from the link's #fragment;
// the server only relays ciphertext. Bodies are drawn with SecureText (canvas),
// so they are never selectable DOM text. Rendered to Apple-HIG-ish standards
// with connection-state, scroll, grouping and member-panel edge cases handled.

import { SecureText } from './secure-render.js';
import { b64u, unb64u, decryptNote, displayParams } from './note.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const TYPE_LABEL = { dm: '单聊', group: '群聊', burn: '焰信' };

const ICON = {
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 20c0-2.6-1.2-4.4-3-5.2"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 20 4l-6 16-3-7z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10l6 6 6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.4 3 7.4 7 9 4-1.6 7-4.6 7-9V6z"/><path d="M9.2 12.2 11 14l4-4.2"/></svg>',
};
const endMark = () => '<div class="rm-end-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 11 15l4.5-5"/></svg></div>';

async function encryptWith(keyB64, payload) {
  const key = await crypto.subtle.importKey('raw', unb64u(keyB64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64u(out);
}

const COLORS = ['#6b7cff', '#e0609a', '#2bb673', '#e8913a', '#8a5cf6', '#2ab6d9'];
function loadProfile() { try { return JSON.parse(localStorage.getItem('sl-chat') || '{}'); } catch { return {}; } }
function saveProfile(p) { try { localStorage.setItem('sl-chat', JSON.stringify({ nick: p.nick, color: p.color })); } catch {} }

export function mountRoom(root, data) {
  const key = new URLSearchParams((location.hash || '').slice(1)).get('k');

  const end = (title, sub, retry) => {
    root.innerHTML = `<div class="rm-center"><div class="rm-end">${endMark()}<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${retry ? `<button class="rm-btn primary" id="rmRetry">重试</button>` : ''}</div></div>`;
    if (retry) root.querySelector('#rmRetry').addEventListener('click', retry);
  };

  if (data.status === 'destroyed') return end('这个聊天室已经结束');
  if (data.status === 'closed') return end('这个聊天室暂时关闭');
  if (!key) return end('链接不完整', '请向邀请你的人确认，复制包含 # 在内的完整链接。');

  function join(errMsg) {
    const saved = loadProfile();
    const vis = data.policy.visible || {};
    const seeList = [vis.device && '设备', vis.geo && '所在地区', vis.ip && 'IP 地址', vis.local_time && '当地时区', vis.typing !== false && '正在输入'].filter(Boolean);
    root.innerHTML = `
      <div class="rm-center">
        <form class="rm-join" id="joinForm" novalidate>
          <div class="rm-join-head">
            <div class="rm-badge">${esc(TYPE_LABEL[data.type] || '聊天室')}</div>
            <h1>加入聊天</h1>
            <p>${esc(data.site || '')} · 端到端加密</p>
          </div>
          <label class="rm-field"><span>昵称</span><input class="rm-input" name="nick" maxlength="24" value="${esc(saved.nick || '')}" placeholder="别人看到的名字" autocomplete="off" required></label>
          <div class="rm-field"><span>头像颜色</span><div class="rm-colors" id="colors"></div></div>
          ${data.needs_password ? `<label class="rm-field"><span>房间密码</span><input class="rm-input" name="pw" type="password" autocomplete="off"></label>` : ''}
          <div class="rm-note">进入后，其他人会看到你的：${seeList.length ? esc(seeList.join('、')) : '仅昵称和头像'}。</div>
          <div class="rm-err" id="joinErr"${errMsg ? '' : ' hidden'}>${esc(errMsg || '')}</div>
          <button class="rm-btn primary" id="joinSubmit" type="submit">进入聊天室</button>
        </form>
      </div>`;
    let color = saved.color && COLORS.includes(saved.color) ? saved.color : COLORS[0];
    const cwrap = root.querySelector('#colors');
    cwrap.innerHTML = COLORS.map((c) => `<button type="button" class="rm-color${c === color ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="颜色 ${c}"></button>`).join('');
    cwrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      color = b.dataset.c;
      [...cwrap.children].forEach((x) => x.classList.toggle('on', x === b));
    });
    root.querySelector('#joinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const nick = fd.get('nick').trim();
      if (!nick) { root.querySelector('[name=nick]').focus(); return; }
      const profile = { nick, color, pw: fd.get('pw') || '' };
      saveProfile(profile);
      room(profile);
    });
    setTimeout(() => root.querySelector('[name=nick]')?.focus(), 60);
  }

  function room(profile) {
    runRoom(root, data, key, profile, { join, end });
  }

  join();
}

function runRoom(root, data, key, profile, nav) {
  const disappear = data.policy.disappear || 0;
  const display = data.policy.display || { mode: 'motion' };
  const hold = !!data.policy.hold;
  const hideOnBlur = !!data.policy.hide_on_blur;
  const vis = data.policy.visible || {};
  const members = new Map();
  const viewers = new Set();
  const seenIds = new Set();
  let me = null;
  let iAmOwner = false;
  let locked = false;
  let last = { from: null, ts: 0 };
  let ws = null;
  let retry = 0;
  let everConnected = false;
  let closedByUs = false;
  let typingTimer = 0;

  const chips = ['🔒 端到端加密'];
  if (data.policy.display?.mode === 'motion') chips.push('运动噪点');
  else if (data.policy.display?.mode === 'comp') chips.push('互补帧');
  if (hold) chips.push('按住查看');
  if (disappear) chips.push(`阅后 ${disappear}s 消失`);
  if (!data.policy.features || data.policy.features.image === false) {} // reserved

  root.innerHTML = `
    <div class="rm-shell">
      <header class="rm-top">
        <button class="rm-icon rm-people" id="rmBack" hidden></button>
        <div class="rm-top-main"><b id="rmTitle">${esc(TYPE_LABEL[data.type] || '聊天室')}</b><span id="rmOnline" class="rm-online off">连接中…</span></div>
        <button class="rm-icon rm-people" id="rmPeople" aria-label="成员" title="成员">${ICON.people}</button>
      </header>
      <div class="rm-policy">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      <div class="rm-banner" id="rmBanner" role="status" aria-live="polite"><div></div></div>
      <div class="rm-scroll">
        <div class="rm-msgs" id="rmMsgs"></div>
        <button class="rm-jump" id="rmJump" aria-label="回到最新">${ICON.down}<span>新消息</span></button>
      </div>
      <div class="rm-typing" id="rmTyping" aria-live="polite"></div>
      <form class="rm-compose" id="rmCompose">
        <textarea id="rmInput" rows="1" maxlength="4000" placeholder="输入消息" autocomplete="off" aria-label="输入消息" disabled></textarea>
        <button class="rm-send" id="rmSend" type="submit" aria-label="发送" disabled>${ICON.send}</button>
      </form>
    </div>
    <aside class="rm-panel" id="rmPanel" aria-label="成员列表">
      <div class="rm-panel-head"><b>成员 · <span id="rmCount">0</span></b><button class="rm-icon" id="rmLock" aria-label="锁定房间" title="锁定房间" hidden>${ICON.lock}</button><button class="rm-icon" id="rmClose" aria-label="关闭">${ICON.x}</button></div>
      <div class="rm-locknote" id="rmLockNote" hidden></div>
      <div class="rm-panel-list" id="rmMembers"></div>
    </aside>
    <div class="rm-backdrop" id="rmBackdrop"></div>`;

  const $ = (s) => root.querySelector(s);
  const msgsEl = $('#rmMsgs'), scrollEl = msgsEl, jumpEl = $('#rmJump');
  const inputEl = $('#rmInput'), sendEl = $('#rmSend'), onlineEl = $('#rmOnline');
  const bannerEl = $('#rmBanner'), bannerInner = bannerEl.firstElementChild, typingEl = $('#rmTyping');

  renderEmpty();

  // ---- member panel ----
  $('#rmPeople').addEventListener('click', () => root.classList.add('rm-show-panel'));
  $('#rmClose').addEventListener('click', () => root.classList.remove('rm-show-panel'));
  $('#rmBackdrop').addEventListener('click', () => root.classList.remove('rm-show-panel'));
  $('#rmLock').addEventListener('click', () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'lock', on: !locked }));
  });
  $('#rmMembers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kick]');
    if (b && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'kick', id: b.dataset.kick }));
  });

  function renderEmpty() {
    if (members.size === 0 || !me) return;
    if (msgsEl.querySelector('.rm-msg')) return;
    msgsEl.innerHTML = `<div class="rm-empty">${endMark().replace('rm-end-mark', 'rm-end-mark')}<b>还没有人说话</b><span>发送的消息${disappear ? '会在对方看过后消失' : '端到端加密，只有房里的人能看到'}。</span></div>`;
  }
  function clearEmpty() {
    const e = msgsEl.querySelector('.rm-empty');
    if (e) e.remove();
  }

  function renderMembers() {
    const list = [...members.values()];
    $('#rmCount').textContent = list.length;
    onlineEl.textContent = list.length ? `${list.length} 人在线` : '连接中…';
    onlineEl.classList.toggle('off', list.length === 0);
    $('#rmMembers').innerHTML = list
      .map((m) => {
        const rows = [];
        if (vis.device && m.device) rows.push(['设备', m.device]);
        if (vis.geo && m.geo) rows.push(['位置', m.geo]);
        if (vis.local_time && m.tz) rows.push(['时区', m.tz]);
        if (vis.ip && m.ip) rows.push(['IP', m.ip]);
        const tags = `${m.owner ? '<span class="rm-tag">房主</span>' : ''}${me && m.id === me.id ? '<span class="rm-tag">我</span>' : ''}`;
        const canKick = iAmOwner && !m.owner && (!me || m.id !== me.id);
        return `<div class="rm-member">
          <div class="rm-mhead"><span class="rm-dot" style="--c:${esc(m.color || '#6b7cff')}"></span><b>${esc(m.nick)}</b>${tags}${canKick ? `<button class="rm-kick" data-kick="${esc(m.id)}" aria-label="移出">移出</button>` : ''}</div>
          ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        </div>`;
      })
      .join('');
  }

  function updateOwnerUI() {
    const lockBtn = $('#rmLock');
    lockBtn.hidden = !iAmOwner;
    lockBtn.classList.toggle('on', locked);
    lockBtn.title = locked ? '已锁定，点此解锁' : '锁定房间（不再放新人进入）';
    const note = $('#rmLockNote');
    note.hidden = !locked;
    note.textContent = '房间已锁定，新成员无法加入';
  }

  // ---- scrolling ----
  const nearBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 48;
  const toBottom = () => { scrollEl.scrollTop = scrollEl.scrollHeight; jumpEl.classList.remove('show'); };
  scrollEl.addEventListener('scroll', () => { if (nearBottom()) jumpEl.classList.remove('show'); });
  jumpEl.addEventListener('click', toBottom);

  // ---- messages ----
  function addBubble(msg) {
    if (msg.id && seenIds.has(msg.id)) return;
    if (msg.id) seenIds.add(msg.id);
    clearEmpty();
    const mine = me && msg.from === me.id;
    const grouped = msg.from === last.from && msg.ts - last.ts < 5 * 60 * 1000;
    last = { from: msg.from, ts: msg.ts };
    const stick = mine || nearBottom();

    const wrap = document.createElement('div');
    wrap.className = 'rm-msg' + (mine ? ' me' : '') + (grouped ? ' grouped' : '');
    const avatar = mine ? '' : grouped ? '<span class="rm-av blank"></span>' : `<span class="rm-av" style="--c:${esc(msg.color || '#6b7cff')}">${esc((msg.nick || '?').trim().charAt(0).toUpperCase())}</span>`;
    wrap.innerHTML = `${avatar}<div class="rm-col"><div class="rm-bubble">${mine || grouped ? '' : `<div class="rm-who">${esc(msg.nick || '')}</div>`}<div class="rm-body"></div></div><div class="rm-time">${hhmm(msg.ts)}</div></div>`;
    msgsEl.appendChild(wrap);

    const body = wrap.querySelector('.rm-body');
    const st = new SecureText(body, { mode: display.mode, params: displayParams(display), hold, hideOnBlur, accent: msg.color });
    viewers.add(st);
    decryptNote(msg.cipher, key).then((p) => st.setText(String(p.text || ''))).catch(() => st.setText('⚠ 无法解密'));
    if (hold) {
      body.classList.add('nt-holdable');
      const dn = (e) => { e.preventDefault(); st.press(); };
      const up = () => st.release();
      body.addEventListener('pointerdown', dn);
      body.addEventListener('pointerup', up);
      body.addEventListener('pointerleave', up);
      body.setAttribute('role', 'button');
      body.setAttribute('aria-label', '按住查看');
    }
    if (disappear) {
      setTimeout(() => {
        st.destroy();
        viewers.delete(st);
        wrap.classList.add('going');
        setTimeout(() => { if (wrap.isConnected) { const h = wrap.offsetHeight; wrap.style.height = h + 'px'; requestAnimationFrame(() => { wrap.style.height = '0'; wrap.style.margin = '0'; }); setTimeout(() => wrap.remove(), 350); } }, 380);
      }, disappear * 1000 + 300);
    }

    if (stick) toBottom();
    else jumpEl.classList.add('show');
  }

  function clearMessages() {
    for (const v of viewers) v.destroy();
    viewers.clear();
    seenIds.clear();
    last = { from: null, ts: 0 };
    msgsEl.innerHTML = '';
  }

  // ---- connection banner ----
  function banner(html, spin) {
    if (!html) { bannerEl.classList.remove('show'); return; }
    bannerInner.innerHTML = (spin ? '<span class="rm-spin"></span>' : '') + html;
    bannerEl.classList.add('show');
  }

  function setLive(on) {
    inputEl.disabled = !on;
    sendEl.disabled = !on || !inputEl.value.trim();
    if (on) banner('');
  }

  // ---- websocket ----
  const wsParams = new URLSearchParams({ nick: profile.nick, color: profile.color, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' });
  if (profile.pw) wsParams.set('pw', profile.pw);
  const ownerTok = new URLSearchParams(location.search).get('o');
  if (ownerTok) wsParams.set('o', ownerTok);

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      ws = new WebSocket(`${proto}://${location.host}/_ws/${encodeURIComponent(data.code)}?${wsParams}`);
    } catch {
      return classifyFailure();
    }
    ws.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      onFrame(m);
    });
    ws.addEventListener('close', () => {
      if (closedByUs) return;
      if (!everConnected) return classifyFailure();
      setLive(false);
      if (retry < 6) {
        banner('正在重新连接…', true);
        setTimeout(connect, Math.min(1000 * 2 ** retry, 8000));
        retry++;
      } else {
        banner('连接已断开 · <button id="rmReconnect" style="all:unset;cursor:pointer;text-decoration:underline">重新连接</button>');
        const b = $('#rmReconnect');
        if (b) b.addEventListener('click', () => { retry = 0; banner('正在重新连接…', true); connect(); });
      }
    });
    if (!everConnected) banner('连接中…', true);
  }

  function onFrame(m) {
    if (m.t === 'welcome') {
      everConnected = true;
      retry = 0;
      me = { id: m.you };
      iAmOwner = !!m.owner;
      locked = !!m.locked;
      members.clear();
      for (const mem of m.members) members.set(mem.id, mem);
      renderMembers();
      updateOwnerUI();
      clearMessages();
      for (const h of m.history || []) addBubble(h);
      renderEmpty();
      setLive(true);
      toBottom();
      inputEl.focus();
    } else if (m.t === 'join') {
      members.set(m.member.id, m.member);
      renderMembers();
    } else if (m.t === 'leave') {
      members.delete(m.id);
      renderMembers();
    } else if (m.t === 'msg') {
      addBubble(m);
    } else if (m.t === 'typing') {
      if (vis.typing !== false) showTyping(m.nick);
    } else if (m.t === 'destroyed') {
      closedByUs = true;
      try { ws.close(); } catch {}
      teardown();
      nav.end('聊天室已结束', '房主结束了这个聊天室。');
    } else if (m.t === 'kicked') {
      closedByUs = true;
      try { ws.close(); } catch {}
      teardown();
      nav.end('你已离开这个聊天室', '');
    } else if (m.t === 'lock') {
      locked = !!m.on;
      updateOwnerUI();
      if (iAmOwner) flash(locked ? '已锁定，新成员无法加入' : '已解锁');
    } else if (m.t === 'error') {
      flash(m.message);
    }
  }

  async function classifyFailure() {
    setLive(false);
    let meta = null;
    try { meta = (await (await fetch(`/api/room/${encodeURIComponent(data.code)}/meta`)).json()).data; } catch {}
    teardown();
    if (meta) {
      if (meta.status === 'destroyed') return nav.end('这个聊天室已经结束');
      if (meta.status === 'closed') return nav.end('这个聊天室暂时关闭');
      if (meta.locked) return nav.join('房间已锁定，暂时无法加入');
      if (meta.online >= meta.max_members) return nav.join('房间已满，稍后再试');
      if (data.needs_password) return nav.join('密码不正确，请重试');
    }
    nav.join('暂时无法进入，请重试');
  }

  function showTyping(nick) {
    typingEl.textContent = `${nick} 正在输入…`;
    clearTimeout(typingEl._t);
    typingEl._t = setTimeout(() => (typingEl.textContent = ''), 2500);
  }
  function flash(msg) {
    typingEl.textContent = msg;
    clearTimeout(typingEl._t);
    typingEl._t = setTimeout(() => (typingEl.textContent = ''), 2500);
  }

  // ---- compose ----
  const autoGrow = () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(128, inputEl.scrollHeight) + 'px'; };
  inputEl.addEventListener('input', () => {
    autoGrow();
    sendEl.disabled = !inputEl.value.trim() || !ws || ws.readyState !== 1;
    if (ws && ws.readyState === 1 && vis.typing !== false) {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { try { ws.send(JSON.stringify({ t: 'typing' })); } catch {} }, 400);
    }
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#rmCompose').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  async function send() {
    const text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    inputEl.value = '';
    autoGrow();
    sendEl.disabled = true;
    try {
      const cipher = await encryptWith(key, { text });
      ws.send(JSON.stringify({ t: 'msg', cipher }));
    } catch {
      flash('发送失败');
    }
  }

  function teardown() {
    for (const v of viewers) v.destroy();
    viewers.clear();
  }
  window.addEventListener('pagehide', () => { closedByUs = true; try { ws && ws.close(); } catch {} teardown(); }, { once: true });

  connect();
}

// ---- boot ----
const el = typeof document !== 'undefined' ? document.getElementById('room-data') : null;
if (el) {
  try {
    const data = JSON.parse(el.textContent);
    el.remove();
    mountRoom(document.getElementById('room-root'), data);
  } catch (e) {
    console.error(e);
  }
}
