// Burn-after-reading note: browser-side crypto + the visitor viewer.
// Content is decrypted in the browser and drawn with SecureText (canvas), so it
// is never selectable DOM text, never in innerHTML/textContent/"view source",
// and a single screenshot of the anti-capture looks carries only noise.
// Imported by the console for encryption and the live preview, so composer and
// visitor render identically.

import { SecureText, SECURE_MODES, modeInfo } from './secure-render.js';

export { SECURE_MODES } from './secure-render.js';

export const NOTE_THEMES = [
  { id: 'min', label: '极简', swatch: 'linear-gradient(135deg,#ffffff,#e8efff)' },
  { id: 'letter', label: '信笺', swatch: '#f3ead8' },
  { id: 'term', label: '终端', swatch: '#0b0f0c' },
  { id: 'noir', label: '暗夜', swatch: 'linear-gradient(135deg,#121215 55%,#c29a5f 55%)' },
];

// ---------- encoding & crypto ----------

const te = new TextEncoder();
const td = new TextDecoder();

export function b64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export async function keyCheck(keyB64) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64u(keyB64)));
  return b64u(h.subarray(0, 12));
}
export async function encryptNote(payload) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ v: 1, ...payload }))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  const k = b64u(keyBytes);
  return { cipher: b64u(out), key: k, kcv: await keyCheck(k) };
}
export async function decryptNote(cipherB64, keyB64) {
  const bytes = unb64u(cipherB64);
  const key = await crypto.subtle.importKey('raw', unb64u(keyB64), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(td.decode(pt));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtDuration(sec) {
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  if (sec < 86400) return `${Math.round(sec / 3600)} 小时`;
  return `${Math.round(sec / 86400)} 天`;
}

// quiet, non-alarming end states (no "焚毁/销毁/截图" wording)
const END = {
  used: ['这条消息已经看过了', '内容只保留到被看过为止。'],
  expired: ['这条消息已经结束', '它只在有限的时间里存在。'],
  disabled: ['这条消息暂时无法打开', ''],
  gone: ['这条消息已经结束', ''],
};

function endMark() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5 11 15l4.5-5"/></svg>';
}

// ---------- viewer ----------

// data: cover info rendered by the server (see redirect.js#notePage)
// opts.preview: { text } to show locally instead of calling the server (console preview)
export function mountNote(root, data, opts = {}) {
  const preview = opts.preview || null;
  const display = { mode: 'motion', hold: false, hide_on_blur: false, after: 'quiet', ...(data.display || {}) };
  const meta = data.meta || {};
  const key = preview ? null : new URLSearchParams((location.hash || '').slice(1)).get('k');
  let attemptsLeft = data.attempts_left ?? null;
  let secure = null;
  const timers = [];
  const clear = () => {
    while (timers.length) clearTimeout(timers.pop());
    if (secure) {
      secure.destroy();
      secure = null;
    }
  };

  const from = meta.from || '';
  const accent = data.theme && data.theme.accent ? data.theme.accent : null;
  const accentStyle = accent ? ` style="--nt-accent:${esc(accent)}"` : '';
  const avatar = from ? esc(from.trim().charAt(0).toUpperCase()) : '✦';

  root.classList.add('nt-noselect');
  root.innerHTML = `
    <div class="nt-card"${accentStyle}>
      <div class="nt-head">
        <div class="nt-av">${avatar}</div>
        <div style="min-width:0">
          <div class="nt-title">${esc(meta.title || '一条私密消息')}</div>
          <div class="nt-sub">${esc(from ? `来自 ${from}` : '端到端加密')}</div>
        </div>
      </div>
      <div class="nt-stage"></div>
    </div>`;
  const stage = root.querySelector('.nt-stage');

  function endState(kind, overrideTitle, overrideSub) {
    clear();
    const [title, sub] = END[kind] || END.gone;
    stage.innerHTML = `<div class="nt-end"><div class="nt-end-mark">${endMark()}</div><b>${esc(overrideTitle || title)}</b>${overrideSub || sub ? `<span>${esc(overrideSub || sub)}</span>` : ''}</div>`;
  }

  function cover(error) {
    clear();
    const rem = data.max_opens > 0 ? Math.max(0, data.max_opens - data.opens) : null;
    const facts = [];
    if (data.max_opens === 0) facts.push('可反复查看');
    else facts.push(data.opens ? `还能看 ${rem} 次` : data.max_opens === 1 ? '只能看一次' : `可查看 ${data.max_opens} 次`);
    if (data.open_ttl) facts.push(data.first_open_at ? `${fmtTime(data.first_open_at + data.open_ttl * 1000)} 前有效` : `打开后 ${fmtDuration(data.open_ttl)} 内`);
    else if (data.expires_at) facts.push(`${fmtTime(data.expires_at)} 前有效`);
    const info = modeInfo(display.mode);
    if (info.anti) facts.push(info.label);
    if (data.needs_password) facts.push('需要密码');
    stage.innerHTML = `
      ${meta.hint ? `<p class="nt-hint">${esc(meta.hint)}</p>` : ''}
      <div class="nt-facts">${facts.map((f) => `<span class="nt-fact">${esc(f)}</span>`).join('')}</div>
      ${error ? `<div class="nt-error" role="alert">${esc(error)}</div>` : ''}
      <form class="nt-form" novalidate>
        ${data.needs_password ? `<input class="nt-input" type="password" name="pw" placeholder="访问密码" autocomplete="off" aria-label="访问密码">${attemptsLeft !== null ? `<div class="nt-hint" style="font-size:12.5px">还可以尝试 ${attemptsLeft} 次</div>` : ''}` : ''}
        <button class="nt-btn" type="submit">${rem === 1 ? '打开（仅此一次）' : '打开'}</button>
      </form>`;
    const form = stage.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      reveal(form.pw ? form.pw.value : '');
    });
    if (form.pw && !preview) setTimeout(() => form.pw.focus(), 50);
  }

  async function reveal(password) {
    const btn = stage.querySelector('.nt-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="nt-spin"></span> 打开中';
    }
    let res, payload;
    try {
      if (preview) {
        res = { remaining: data.max_opens > 0 ? data.max_opens - 1 : null };
        payload = preview;
      } else {
        const body = { password };
        if (data.enc === 'e2e') body.kcv = await keyCheck(key);
        const r = await fetch(`/api/n/${encodeURIComponent(data.code)}/open`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.ok) {
          const err = (j && j.error) || {};
          if (err.code === 'burned' || err.code === 'exhausted') return endState('used');
          if (err.code === 'expired') return endState('expired');
          if (err.code === 'disabled') return endState('disabled');
          if (typeof err.attempts_left === 'number') attemptsLeft = err.attempts_left;
          return cover(err.message || '打开失败，请稍后再试');
        }
        res = j.data;
        if (res.enc === 'server') payload = res.payload;
        else {
          try {
            payload = await decryptNote(res.cipher, key);
          } catch {
            return endState('gone', '无法解密', '链接里的密钥与内容不匹配。');
          }
        }
        if (res.burned && history.replaceState) history.replaceState(null, '', location.pathname);
      }
    } catch {
      return cover('网络不太顺，请稍后再试');
    }
    read(payload, res);
  }

  function read(payload, res) {
    clear();
    const text = String((payload && payload.text) || '');
    stage.innerHTML = `<div class="nt-view"></div><div class="nt-veil"><span>移开后内容已暂时隐藏</span></div><div class="nt-extra"></div>`;
    const viewHost = stage.querySelector('.nt-view');
    const extra = stage.querySelector('.nt-extra');
    const autoFinish = display.mode === 'window' || display.mode === 'countdown';
    secure = new SecureText(viewHost, {
      mode: display.mode,
      hold: display.hold,
      hideOnBlur: display.hide_on_blur,
      accent,
      params: displayParams(display),
      onDone: autoFinish ? () => finish(res) : null,
    });
    secure.setText(text);

    if (display.hold) {
      viewHost.classList.add('nt-holdable');
      const down = (e) => {
        e.preventDefault();
        secure.press();
      };
      const up = () => secure.release();
      viewHost.addEventListener('pointerdown', down);
      viewHost.addEventListener('pointerup', up);
      viewHost.addEventListener('pointerleave', up);
      viewHost.addEventListener('pointercancel', up);
      viewHost.setAttribute('role', 'button');
      viewHost.setAttribute('aria-label', '按住查看');
    }

    if (!autoFinish) {
      extra.innerHTML = `<button class="nt-btn ghost" type="button">看完了</button>`;
      extra.querySelector('button').addEventListener('click', () => finish(res));
    }
  }

  function finish(res) {
    clear();
    const after = display.after;
    if (after === 'message' && display.after_text) {
      stage.innerHTML = `<div class="nt-end"><div class="nt-end-mark">${endMark()}</div><b>${esc(display.after_text)}</b></div>`;
      return;
    }
    if (after === 'redirect' && display.after_url) {
      stage.innerHTML = `<div class="nt-end"><div class="nt-end-mark">${endMark()}</div><b>即将前往</b><a class="nt-btn" style="text-decoration:none;max-width:240px;margin-top:4px" href="${esc(display.after_url)}" rel="noopener noreferrer">继续</a></div>`;
      if (!preview) timers.push(setTimeout(() => location.replace(display.after_url), 2200));
      return;
    }
    if (res && res.remaining) endState('gone', '看完了', `你还可以再打开 ${res.remaining} 次。`);
    else endState('gone', '看完了', '');
  }

  // initial state
  if (data.status === 'burned') endState('used');
  else if (data.status === 'expired') endState('expired');
  else if (data.status === 'disabled') endState('disabled');
  else if (!preview && data.enc === 'e2e' && !key) endState('gone', '链接不完整', '请向发送者确认，复制包含 # 在内的完整链接。');
  else cover();

  return {
    destroy: () => {
      clear();
      root.innerHTML = '';
    },
    replay: () => cover(),
  };
}

function displayParams(d) {
  const p = {};
  if (d.mode === 'motion') {
    if (d.mspeed) p.speed = d.mspeed / 10;
    for (const k of ['cell', 'contrast', 'density']) if (d[k] != null) p[k] = d[k];
  } else if (d.mode === 'comp') {
    for (const k of ['cell', 'contrast', 'interval', 'refresh']) if (d[k] != null) p[k] = d[k];
  } else if (d.mode === 'type') {
    for (const k of ['chunk', 'speed']) if (d[k] != null) p[k] = d[k];
  } else if (d.mode === 'window') {
    for (const k of ['window', 'speed']) if (d[k] != null) p[k] = d[k];
  } else if (d.mode === 'countdown') {
    if (d.seconds != null) p.seconds = d.seconds;
  }
  return p;
}

// ---------- public page boot ----------

const dataEl = typeof document !== 'undefined' ? document.getElementById('note-data') : null;
if (dataEl) {
  try {
    const parsed = JSON.parse(dataEl.textContent);
    dataEl.remove();
    mountNote(document.getElementById('note-root'), parsed);
  } catch (e) {
    console.error(e);
  }
}
