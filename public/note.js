// Burn-after-reading note: browser-side crypto, safe Markdown, and the viewer.
// Used by the public note page (auto-mounts from #note-data) and imported by the
// console for encryption and the live preview, so both render identically.

export const NOTE_THEMES = [
  { id: 'min', label: '极简', swatch: 'linear-gradient(135deg,#ffffff,#e8efff)' },
  { id: 'letter', label: '信笺', swatch: '#f3ead8' },
  { id: 'term', label: '终端', swatch: '#0b0f0c' },
  { id: 'noir', label: '暗夜', swatch: 'linear-gradient(135deg,#121215 55%,#c29a5f 55%)' },
];

export const NOTE_MODES = [
  { id: 'click', label: '点击揭示', desc: '先显示封面，访客点击后才取回内容并计入一次查看。链接预览不会消耗次数。' },
  { id: 'direct', label: '直接显示', desc: '打开页面就自动显示内容。部分聊天软件的预览程序可能执行脚本而消耗次数，建议配合「点击揭示」。' },
  { id: 'type', label: '逐 N 字', desc: '内容按设定速度逐段出现，前面的字保留。按纯文本显示。' },
  { id: 'window', label: '滑动窗口', desc: '文字逐个出现，前面的字跟着消失，屏幕上始终只有设定数量的字，无法一屏截下全文。按纯文本显示。' },
  { id: 'countdown', label: '倒计时焚毁', desc: '显示全文，倒计时结束后自动从屏幕清除。' },
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

// payload: { format: 'text' | 'markdown', text }
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

// ---------- safe Markdown (headings, lists, quotes, code, links, emphasis) ----------

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return String(s)
    .split(/(`[^`\n]+`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${esc(part.slice(1, -1))}</code>`;
      let h = esc(part);
      h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${t}</a>`);
      h = h.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`);
      h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      h = h.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
      return h;
    })
    .join('');
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((t) => `<li>${inline(t)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      flushList();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
      i++;
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      const buf = [m[1]];
      i++;
      while (i < lines.length && (m = lines[i].match(/^>\s?(.*)$/))) {
        buf.push(m[1]);
        i++;
      }
      out.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }
    if ((m = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/))) {
      flushPara();
      const type = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(m[2]);
      i++;
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      i++;
      continue;
    }
    flushList();
    para.push(line);
    i++;
  }
  flushPara();
  flushList();
  return out.join('');
}

// ---------- formatting ----------

function pad(n) {
  return String(n).padStart(2, '0');
}
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

const GONE_TEXT = {
  exhausted: '查看次数已用完，内容已从服务器删除。',
  password: '密码错误次数过多，内容已被销毁。',
  manual: '发送者已经销毁了这封密信。',
  expired: '这封密信已过期，内容已销毁。',
};

// ---------- viewer ----------

// data: cover info rendered by the server (see redirect.js#notePage)
// opts.preview: payload to show locally instead of calling the server (console preview)
export function mountNote(root, data, opts = {}) {
  const preview = opts.preview || null;
  const display = { mode: 'click', chunk: 2, window: 6, speed: 120, seconds: 30, ...(data.display || {}) };
  const meta = data.meta || {};
  const timers = [];
  const cleanups = [];
  const key = preview ? null : new URLSearchParams((location.hash || '').slice(1)).get('k');
  let attemptsLeft = data.attempts_left ?? null;

  const from = meta.from || '';
  const avatar = from ? from.trim().charAt(0).toUpperCase() : '✉';
  const accent = data.theme?.accent ? ` style="--nt-accent:${esc(data.theme.accent)}"` : '';
  root.innerHTML = `
    <div class="nt-card"${accent}>
      <div class="nt-head">
        <div class="nt-av">${esc(avatar)}</div>
        <div style="min-width:0">
          <div class="nt-title">${esc(meta.title || '你收到一封密信')}</div>
          <div class="nt-sub">${esc([from ? `来自 ${from}` : null, data.enc === 'server' ? '服务端加密' : '端到端加密'].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
      <div class="nt-stage"></div>
      <div class="nt-foot"><span class="nt-foot-l"></span><span>对方仍可能截图或拍照</span></div>
    </div>
    <p class="nt-brand">${esc(data.site || 'ShortLink')} · 阅后即焚</p>`;
  const card = root.querySelector('.nt-card');
  const stage = root.querySelector('.nt-stage');
  const footL = root.querySelector('.nt-foot-l');

  function clearTimers() {
    while (timers.length) clearInterval(timers.pop());
  }

  function stop() {
    clearTimers();
    while (cleanups.length) cleanups.pop()();
    card.classList.remove('nt-hidden');
  }

  function remainingBefore() {
    return data.max_opens > 0 ? Math.max(0, data.max_opens - data.opens) : null;
  }

  function gone(text, glyph = '🔥', title = '这封密信已焚毁') {
    stop();
    stage.innerHTML = `<div class="nt-gone"><div class="nt-glyph">${glyph}</div><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  }

  function cover(error) {
    stop();
    const rem = remainingBefore();
    const facts = [];
    if (data.max_opens === 0) facts.push('不限查看次数');
    else facts.push(data.opens ? `还能查看 ${rem} 次` : `可查看 ${data.max_opens} 次`);
    if (data.open_ttl) {
      facts.push(data.first_open_at ? `${fmtTime(data.first_open_at + data.open_ttl * 1000)} 前可查看` : `打开后 ${fmtDuration(data.open_ttl)} 内有效`);
    }
    if (data.expires_at) facts.push(`${fmtTime(data.expires_at)} 前有效`);
    if (display.mode === 'countdown') facts.push(`显示 ${display.seconds} 秒后清除`);
    if (display.mode === 'window') facts.push('逐字显示，看过的字会消失');
    if (data.needs_password) facts.push('需要访问密码');
    const lastChance = rem === 1;
    stage.innerHTML = `
      ${meta.hint ? `<p class="nt-hint">${esc(meta.hint)}</p>` : ''}
      <div class="nt-facts">${facts.map((f) => `<span class="nt-fact">${esc(f)}</span>`).join('')}</div>
      ${lastChance ? '<div class="nt-warn">这是唯一一次查看机会，打开后内容会从服务器删除。请确认现在方便阅读。</div>' : ''}
      ${error ? `<div class="nt-error" role="alert">${esc(error)}</div>` : ''}
      <form class="nt-form" novalidate>
        ${data.needs_password ? `<input class="nt-input" type="password" name="pw" placeholder="访问密码" autocomplete="off" aria-label="访问密码">${attemptsLeft !== null ? `<div class="nt-hint" style="font-size:12.5px">还可以尝试 ${attemptsLeft} 次，全部错误后密信会被销毁。</div>` : ''}` : ''}
        <button class="nt-btn" type="submit">查看密信</button>
      </form>`;
    footL.textContent = data.enc === 'server' ? '管理员可查看内容' : '内容只在你的浏览器里解密';
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
      btn.innerHTML = '<span class="nt-spin"></span> 正在打开';
    }
    let res;
    try {
      if (preview) {
        res = { payload: preview, remaining: data.max_opens > 0 ? data.max_opens - 1 : null, burned: data.max_opens === 1, readable_until: null };
      } else {
        const body = { password };
        if (data.enc === 'e2e') body.kcv = await keyCheck(key);
        const r = await fetch(`/api/n/${encodeURIComponent(data.code)}/open`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          const err = j?.error || {};
          if (['burned', 'expired', 'disabled'].includes(err.code)) {
            return gone(err.message || '这封密信已不可用', err.code === 'disabled' ? '⛔' : '🔥', err.code === 'disabled' ? '这封密信已被停用' : '这封密信已焚毁');
          }
          if (typeof err.attempts_left === 'number') attemptsLeft = err.attempts_left;
          return cover(err.message || '打开失败，请稍后重试');
        }
        res = j.data;
        if (res.enc === 'server') {
          res.payload = res.payload;
        } else {
          try {
            res.payload = await decryptNote(res.cipher, key);
          } catch {
            return gone('链接里的密钥与内容不匹配，无法解密。', '⚠️', '内容无法解密');
          }
        }
        if (res.burned && history.replaceState) history.replaceState(null, '', location.pathname);
      }
    } catch (e) {
      return cover('网络异常，请稍后重试');
    }
    read(res);
  }

  function footerAfterOpen(res) {
    if (res.burned) return '已焚毁 · 关闭页面后无法再看';
    const parts = [];
    if (res.remaining !== null && res.remaining !== undefined) parts.push(`还能查看 ${res.remaining} 次`);
    if (res.readable_until) parts.push(`${fmtTime(res.readable_until)} 前可再次打开`);
    return parts.join(' · ') || '可以再次打开';
  }

  function finish(res) {
    stop();
    const after = display.after || 'burned';
    if (after === 'message' && display.after_text) return gone(display.after_text, '✉️', '读完了');
    if (after === 'redirect' && display.after_url) {
      gone('即将前往发送者指定的页面。', '↗', '读完了');
      stage.querySelector('.nt-gone').insertAdjacentHTML(
        'beforeend',
        `<a class="nt-btn" style="text-decoration:none;max-width:240px" href="${esc(display.after_url)}" rel="noopener noreferrer">继续</a>`
      );
      if (!preview) timers.push(setTimeout(() => location.replace(display.after_url), 2500));
      return;
    }
    gone(res.burned ? '内容已从屏幕清除，服务器上的内容也已删除。' : `内容已从屏幕清除。${res.remaining ? `你还可以再打开 ${res.remaining} 次。` : ''}`, '🔥', res.burned ? '这封密信已焚毁' : '已清除');
  }

  function read(res) {
    stop();
    const payload = res.payload || {};
    const text = String(payload.text || '');
    const md = payload.format === 'markdown';
    footL.textContent = footerAfterOpen(res);
    stage.innerHTML = `<div class="nt-content"></div><div class="nt-veil">内容已隐藏。回到这个页面后继续显示。</div><div class="nt-extra"></div>`;
    const box = stage.querySelector('.nt-content');
    const extra = stage.querySelector('.nt-extra');
    const doneBtn = () => {
      extra.innerHTML = `<div class="nt-actions"><button class="nt-btn ghost" type="button">看完了，清除内容</button></div>`;
      extra.querySelector('button').addEventListener('click', () => finish(res));
    };

    if (display.hide_on_blur) {
      const hide = () => card.classList.add('nt-hidden');
      const show = () => card.classList.remove('nt-hidden');
      const vis = () => (document.hidden ? hide() : show());
      document.addEventListener('visibilitychange', vis);
      window.addEventListener('blur', hide);
      window.addEventListener('focus', show);
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', vis);
        window.removeEventListener('blur', hide);
        window.removeEventListener('focus', show);
      });
    }

    const mode = display.mode;
    if (mode === 'type') {
      const chars = Array.from(text);
      let i = 0;
      box.classList.add('plain', 'nt-caret');
      const showAll = () => {
        i = chars.length;
      };
      if (display.skip) box.addEventListener('click', showAll);
      timers.push(
        setInterval(() => {
          i = Math.min(chars.length, i + display.chunk);
          box.textContent = chars.slice(0, i).join('');
          if (i >= chars.length) {
            clearTimers();
            box.classList.remove('nt-caret');
            doneBtn();
          }
        }, display.speed)
      );
      return;
    }
    if (mode === 'window') {
      const chars = Array.from(text.replace(/\s*\n\s*/g, ' '));
      let i = 0;
      box.classList.add('nt-window');
      extra.innerHTML = '<div class="nt-progress"><i></i></div>';
      const bar = extra.querySelector('i');
      timers.push(
        setInterval(() => {
          i += 1;
          box.textContent = chars.slice(Math.max(0, i - display.window), i).join('');
          bar.style.width = `${Math.min(100, (i / (chars.length + display.window)) * 100)}%`;
          if (i >= chars.length + display.window) finish(res);
        }, Math.max(display.speed, 60))
      );
      return;
    }
    if (md) box.innerHTML = renderMarkdown(text);
    else {
      box.classList.add('plain');
      box.textContent = text;
    }
    if (mode === 'countdown') {
      let left = display.seconds;
      extra.innerHTML = `<span class="nt-timer"><span class="nt-ring"></span><span class="nt-left"></span></span>`;
      const ring = extra.querySelector('.nt-ring');
      const label = extra.querySelector('.nt-left');
      const paint = () => {
        label.textContent = `${left} 秒后清除`;
        ring.style.background = `conic-gradient(currentColor ${(left / display.seconds) * 100}%, transparent 0)`;
      };
      paint();
      timers.push(
        setInterval(() => {
          left -= 1;
          if (left <= 0) return finish(res);
          paint();
        }, 1000)
      );
      return;
    }
    doneBtn();
  }

  // initial state
  if (data.status === 'burned') gone(GONE_TEXT[data.burn_reason] || '这封密信已焚毁，内容已从服务器删除。');
  else if (data.status === 'expired') gone(GONE_TEXT.expired);
  else if (data.status === 'disabled') gone('发送者或管理员停用了这封密信。', '⛔', '这封密信已被停用');
  else if (!preview && data.enc === 'e2e' && !key) gone('链接不完整：缺少解密密钥。请向发送者确认，并复制包括 # 后面在内的完整链接。', '⚠️', '链接不完整');
  else if (display.mode === 'direct' && !data.needs_password && !data.is_bot) reveal('');
  else cover();

  return {
    destroy() {
      stop();
      root.innerHTML = '';
    },
    replay() {
      cover();
    },
  };
}

// ---------- public page boot ----------

const dataEl = typeof document !== 'undefined' ? document.getElementById('note-data') : null;
if (dataEl) {
  try {
    mountNote(document.getElementById('note-root'), JSON.parse(dataEl.textContent));
  } catch (e) {
    console.error(e);
  }
}
