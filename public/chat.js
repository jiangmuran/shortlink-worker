// Chat room client: join screen, live WebSocket, and message rendering.
// Messages are end-to-end encrypted with the room key from the link's # fragment;
// the server only relays ciphertext. Message bodies are drawn with SecureText
// (canvas) using the room's display mode, so they are never selectable DOM text.

import { SecureText } from './secure-render.js';
import { b64u, unb64u, decryptNote, displayParams } from './note.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function encryptWith(keyB64, payload) {
  const key = await crypto.subtle.importKey('raw', unb64u(keyB64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64u(out);
}

const TYPE_LABEL = { dm: '单聊', group: '群聊', burn: '焰信' };

function endCard(root, title, sub) {
  root.innerHTML = `<div class="rm-center"><div class="rm-end"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div></div>`;
}

export function mountRoom(root, data) {
  const key = new URLSearchParams((location.hash || '').slice(1)).get('k');
  if (data.status === 'destroyed') return endCard(root, '这个聊天室已经结束', '');
  if (data.status === 'closed') return endCard(root, '这个聊天室暂时关闭', '');
  if (!key) return endCard(root, '链接不完整', '请向邀请你的人确认，复制包含 # 在内的完整链接。');

  const saved = loadProfile();
  joinScreen(root, data, saved, (profile) => {
    saveProfile(profile);
    runRoom(root, data, key, profile);
  });
}

function joinScreen(root, data, saved, onJoin) {
  const vis = data.policy.visible || {};
  const seeList = [vis.device && '设备', vis.geo && '所在地区', vis.ip && 'IP 地址', vis.local_time && '当地时间', vis.typing && '正在输入', vis.read && '已读'].filter(Boolean);
  root.innerHTML = `
    <div class="rm-center">
      <div class="rm-join">
        <div class="rm-join-head">
          <div class="rm-badge">${esc(TYPE_LABEL[data.type] || '聊天室')}</div>
          <h1>加入聊天</h1>
          <p>${esc(data.site || '')} · 端到端加密</p>
        </div>
        <form id="joinForm">
          <label class="rm-field"><span>昵称</span><input name="nick" maxlength="24" value="${esc(saved.nick || '')}" placeholder="别人看到的名字" autocomplete="off" required></label>
          <div class="rm-colors" id="colors"></div>
          ${data.needs_password ? `<label class="rm-field"><span>房间密码</span><input name="pw" type="password" autocomplete="off"></label>` : ''}
          <div class="rm-note">进入后，其他人会看到你的：${seeList.length ? esc(seeList.join('、')) : '仅昵称和头像'}。</div>
          <div class="rm-err" id="joinErr" hidden></div>
          <button class="rm-btn primary" type="submit">进入聊天室</button>
        </form>
      </div>
    </div>`;
  const colors = ['#6b7cff', '#e0609a', '#2bb673', '#e8913a', '#8a5cf6', '#2ab6d9'];
  let color = saved.color && colors.includes(saved.color) ? saved.color : colors[0];
  const cwrap = $('#colors', root);
  cwrap.innerHTML = colors.map((c) => `<button type="button" class="rm-color${c === color ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="颜色"></button>`).join('');
  cwrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    color = b.dataset.c;
    [...cwrap.children].forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#joinForm', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nick = fd.get('nick').trim();
    if (!nick) return;
    onJoin({ nick, color, pw: fd.get('pw') || '' });
  });
}

function runRoom(root, data, key, profile) {
  const disappear = data.policy.disappear || 0;
  const display = data.policy.display || { mode: 'motion' };
  const hold = !!data.policy.hold;
  const hideOnBlur = !!data.policy.hide_on_blur;
  const vis = data.policy.visible || {};
  let me = null;
  const members = new Map();
  const viewers = new Set();
  let typingTimer = 0;
  const seen = new Set();

  root.innerHTML = `
    <div class="rm-shell">
      <header class="rm-top">
        <div class="rm-top-main"><b id="rmTitle">${esc(TYPE_LABEL[data.type] || '聊天室')}</b><span id="rmOnline" class="rm-online">连接中…</span></div>
        <button class="rm-icon" id="rmPeople" aria-label="成员" title="成员">${ICON.people}</button>
      </header>
      <div class="rm-policy" id="rmPolicy"></div>
      <div class="rm-msgs" id="rmMsgs"></div>
      <div class="rm-typing" id="rmTyping"></div>
      <form class="rm-compose" id="rmCompose">
        <textarea id="rmInput" rows="1" maxlength="4000" placeholder="输入消息" autocomplete="off"></textarea>
        <button class="rm-send" id="rmSend" type="submit" aria-label="发送">${ICON.send}</button>
      </form>
    </div>
    <aside class="rm-panel" id="rmPanel" hidden>
      <div class="rm-panel-head"><b>成员</b><button class="rm-icon" id="rmClose" aria-label="关闭">${ICON.x}</button></div>
      <div class="rm-panel-list" id="rmMembers"></div>
    </aside>
    <div class="rm-backdrop" id="rmBackdrop" hidden></div>`;

  const msgsEl = $('#rmMsgs', root);
  const policyEl = $('#rmPolicy', root);
  const chips = [];
  chips.push('🔒 端到端加密');
  if (disappear) chips.push(`阅后 ${disappear}s 消失`);
  if (data.policy.display?.mode === 'motion') chips.push('运动噪点');
  else if (data.policy.display?.mode === 'comp') chips.push('互补帧');
  if (hold) chips.push('按住查看');
  policyEl.innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join('');

  // ---- panel ----
  const panel = $('#rmPanel', root), backdrop = $('#rmBackdrop', root);
  const openPanel = () => {
    panel.hidden = false;
    backdrop.hidden = false;
  };
  const closePanel = () => {
    panel.hidden = true;
    backdrop.hidden = true;
  };
  $('#rmPeople', root).addEventListener('click', openPanel);
  $('#rmClose', root).addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  function renderMembers() {
    const list = [...members.values()];
    $('#rmOnline', root).textContent = `${list.length} 人在线`;
    $('#rmMembers', root).innerHTML = list
      .map((m) => {
        const rows = [];
        if (vis.device && m.device) rows.push(['设备', m.device]);
        if (vis.geo && m.geo) rows.push(['位置', m.geo]);
        if (vis.local_time && m.tz) rows.push(['时区', m.tz]);
        if (vis.ip && m.ip) rows.push(['IP', m.ip]);
        return `<div class="rm-member">
          <div class="rm-mhead"><span class="rm-dot" style="--c:${esc(m.color || '#6b7cff')}"></span><b>${esc(m.nick)}</b>${m.owner ? '<span class="rm-tag">房主</span>' : ''}${m.id === (me && me.id) ? '<span class="rm-tag">我</span>' : ''}</div>
          ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        </div>`;
      })
      .join('');
  }

  // ---- messages ----
  function addBubble(msg, mine) {
    const wrap = document.createElement('div');
    wrap.className = 'rm-msg' + (mine ? ' me' : '');
    wrap.innerHTML = `
      ${mine ? '' : `<span class="rm-av" style="--c:${esc(msg.color || '#6b7cff')}">${esc((msg.nick || '?').charAt(0).toUpperCase())}</span>`}
      <div class="rm-bubble">
        ${mine ? '' : `<div class="rm-who">${esc(msg.nick || '')}</div>`}
        <div class="rm-body"></div>
        <div class="rm-time">${hhmm(msg.ts)}</div>
      </div>`;
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    const body = $('.rm-body', wrap);
    const st = new SecureText(body, { mode: display.mode, params: displayParams(display), hold, hideOnBlur, accent: msg.color });
    viewers.add(st);
    decryptNote(msg.cipher, key)
      .then((p) => st.setText(String(p.text || '')))
      .catch(() => st.setText('⚠ 无法解密'));
    if (hold) {
      body.classList.add('nt-holdable');
      const dn = (e) => {
        e.preventDefault();
        st.press();
      };
      const up = () => st.release();
      body.addEventListener('pointerdown', dn);
      body.addEventListener('pointerup', up);
      body.addEventListener('pointerleave', up);
    }
    if (disappear) {
      setTimeout(() => {
        st.destroy();
        viewers.delete(st);
        wrap.classList.add('rm-faded');
        body.innerHTML = '<span class="rm-vanished">· · ·</span>';
      }, disappear * 1000 + 400);
    }
  }

  // ---- websocket ----
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ nick: profile.nick, color: profile.color, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' });
  if (profile.pw) params.set('pw', profile.pw);
  let ws, retry = 0;
  function connect() {
    ws = new WebSocket(`${proto}://${location.host}/_ws/${encodeURIComponent(data.code)}?${params}`);
    ws.addEventListener('open', () => {
      retry = 0;
    });
    ws.addEventListener('message', (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        me = { id: m.you };
        members.clear();
        for (const mem of m.members) members.set(mem.id, mem);
        renderMembers();
        for (const h of m.history || []) addBubble(h, h.from === me.id);
      } else if (m.t === 'join') {
        members.set(m.member.id, m.member);
        renderMembers();
      } else if (m.t === 'leave') {
        members.delete(m.id);
        renderMembers();
      } else if (m.t === 'msg') {
        addBubble(m, me && m.from === me.id);
      } else if (m.t === 'typing') {
        showTyping(m.nick);
      } else if (m.t === 'destroyed') {
        ws.close();
        endCard(root, '聊天室已结束', '房主结束了这个聊天室。');
      } else if (m.t === 'error') {
        flash(m.message);
      }
    });
    ws.addEventListener('close', (e) => {
      if (e.code === 1000) return;
      if (retry++ < 5) setTimeout(connect, 1000 * retry);
      else $('#rmOnline', root).textContent = '连接已断开';
    });
  }
  connect();

  function showTyping(nick) {
    const el = $('#rmTyping', root);
    el.textContent = `${nick} 正在输入…`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ''), 2500);
  }
  function flash(msg) {
    const el = $('#rmTyping', root);
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.textContent = ''), 2500);
  }

  // ---- compose ----
  const input = $('#rmInput', root);
  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  };
  input.addEventListener('input', () => {
    autoGrow();
    if (ws && ws.readyState === 1 && vis.typing !== false) {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => ws.send(JSON.stringify({ t: 'typing' })), 10);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $('#rmCompose', root).addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  async function send() {
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    input.value = '';
    autoGrow();
    const cipher = await encryptWith(key, { text });
    ws.send(JSON.stringify({ t: 'msg', cipher }));
  }
}

// per-browser nickname/color memory (convenience only)
function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('sl-chat') || '{}');
  } catch {
    return {};
  }
}
function saveProfile(p) {
  try {
    localStorage.setItem('sl-chat', JSON.stringify({ nick: p.nick, color: p.color }));
  } catch {}
}

const ICON = {
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 20c0-2.6-1.2-4.4-3-5.2"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 20 4l-6 16-3-7z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// boot
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
