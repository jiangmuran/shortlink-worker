// Server-rendered HTML pages for the short-link side: interstitial ("page"),
// confirmation, error and landing pages. These load instantly with zero assets
// and follow the same Apple-ish visual language as the management UI.

import { escapeHtml } from './util.js';

const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a84ff"/><path d="M27 37a10 10 0 0 1 0-14l4-4a10 10 0 0 1 14 14l-2 2-4-4 2-2a5 5 0 0 0-7-7l-4 4a5 5 0 0 0 0 7z" fill="#fff"/><path d="M37 27a10 10 0 0 1 0 14l-4 4a10 10 0 0 1-14-14l2-2 4 4-2 2a5 5 0 0 0 7 7l4-4a5 5 0 0 0 0-7z" fill="#fff" opacity=".85"/></svg>`
  );

const BASE_CSS = `
:root{--accent:#0a84ff;--bg:#f5f5f7;--card:rgba(255,255,255,.82);--text:#1d1d1f;--muted:#6e6e73;--hair:rgba(0,0,0,.1)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:rgba(28,28,30,.82);--text:#f5f5f7;--muted:#98989d;--hair:rgba(255,255,255,.14)}}
*{margin:0;padding:0;box-sizing:border-box}
html,body{min-height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','PingFang SC','Helvetica Neue','Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.card{background:var(--card);-webkit-backdrop-filter:saturate(180%) blur(30px);backdrop-filter:saturate(180%) blur(30px);border:1px solid var(--hair);border-radius:24px;padding:40px 36px;max-width:440px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.1)}
.glyph{width:72px;height:72px;border-radius:18px;background:var(--accent);display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px;box-shadow:0 8px 24px color-mix(in srgb,var(--accent) 40%,transparent)}
.glyph svg{width:40px;height:40px}
h1{font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px}
p{font-size:15px;line-height:1.5;color:var(--muted)}
.url-box{margin:20px 0;padding:12px 16px;background:color-mix(in srgb,var(--text) 5%,transparent);border-radius:12px;font-size:13px;word-break:break-all}
.url-box b{display:block;font-size:15px;color:var(--text);margin-bottom:2px;font-weight:600}
a.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 28px;border-radius:12px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;text-decoration:none;border:none;cursor:pointer;font-family:inherit;transition:transform .15s ease,filter .15s ease}
a.btn:active{transform:scale(.97);filter:brightness(.92)}
a.subtle{display:inline-block;margin-top:16px;font-size:14px;color:var(--muted);text-decoration:none}
a.subtle:hover{color:var(--text)}
.foot{margin-top:28px;font-size:12px;color:var(--muted);opacity:.7}
`;

function shell({ title, body, extraCss = '', extraHead = '' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${FAVICON}">
<meta name="robots" content="noindex">
<style>${BASE_CSS}${extraCss}</style>
${extraHead}
</head>
<body>${body}</body>
</html>`;
}

const LINK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function renderPageRedirect({ target, style, siteName, backUrl }) {
  const accent = style.color || '#0a84ff';
  const duration = Math.min(5000, Math.max(500, style.duration || 1200));
  const animation = style.animation || 'orbit';
  const title = style.title || '即将跳转';
  const desc = style.desc || '';
  const css = `
  :root{--accent:${accent}}
  .anim{position:relative;width:96px;height:96px;margin:0 auto 22px;display:flex;align-items:center;justify-content:center}
  .anim .mark{position:relative;z-index:1;width:52px;height:52px;border-radius:14px;background:var(--accent);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px color-mix(in srgb,var(--accent) 45%,transparent);animation:markPulse ${duration}ms ease-in-out infinite}
  .anim .mark svg{width:30px;height:30px}
  ${ANIM_CSS[animation] || ''}
  .track{width:200px;height:8px;margin:2px auto 22px;border-radius:99px;background:color-mix(in srgb,var(--accent) 18%,transparent);overflow:hidden}
  .track i{display:block;height:100%;border-radius:99px;background:var(--accent);animation:fill ${duration}ms ease-in-out forwards}
  @keyframes fill{from{width:0}to{width:100%}}
  @keyframes markPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
  @media (prefers-reduced-motion:reduce){.anim .mark,.track i,.anim .orbit,.anim .wave{animation:none!important}}
  `;
  const body = `
  <main class="card">
    <div class="anim" aria-hidden="true">${animDecor(animation)}<div class="mark">${LINK_ICON}</div></div>
    ${animation === 'progress' ? '<div class="track" aria-hidden="true"><i></i></div>' : ''}
    <h1>${escapeHtml(title)}</h1>
    ${desc ? `<p>${escapeHtml(desc)}</p>` : ''}
    <div class="url-box"><b>${escapeHtml(hostOf(target))}</b>${escapeHtml(target)}</div>
    <a class="btn" href="${escapeHtml(target)}" rel="noopener">立即前往</a><br>
    <a class="subtle" href="${escapeHtml(backUrl)}">取消并返回</a>
    <div class="foot">${escapeHtml(siteName)}</div>
  </main>
  <script>
  (function(){
    var t=setTimeout(function(){location.replace(${JSON.stringify(target)})},${duration});
    document.addEventListener('click',function(e){if(e.target.closest('a'))clearTimeout(t)});
  })();
  </script>`;
  return shell({
    title: `${title} · ${hostOf(target)}`,
    body,
    extraCss: css,
    extraHead: `<noscript><meta http-equiv="refresh" content="${(duration + 500) / 1000};url=${escapeHtml(target)}"></noscript>`,
  });
}

export function renderConfirmPage({ target, style, siteName, backUrl }) {
  const accent = style.color || '#0a84ff';
  const title = style.title || '即将离开本站';
  const desc = style.desc || '您将前往以下外部链接，请确认目的地后继续。';
  const button = style.button || '继续访问';
  const css = `:root{--accent:${accent}}`;
  const body = `
  <main class="card">
    <div class="glyph">${LINK_ICON}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(desc)}</p>
    <div class="url-box"><b>${escapeHtml(hostOf(target))}</b>${escapeHtml(target)}</div>
    <a class="btn" href="${escapeHtml(target)}" rel="noopener">${escapeHtml(button)}</a><br>
    <a class="subtle" href="${escapeHtml(backUrl)}">取消并返回</a>
    <div class="foot">${escapeHtml(siteName)}</div>
  </main>`;
  return shell({ title: `${title} · ${hostOf(target)}`, body, extraCss: css });
}

export function renderStatusPage({ heading, message, siteName, backUrl }) {
  const body = `
  <main class="card">
    <div class="glyph" style="background:#8e8e93">${LINK_ICON}</div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    <a class="subtle" href="${escapeHtml(backUrl)}">返回首页</a>
    <div class="foot">${escapeHtml(siteName)}</div>
  </main>`;
  return shell({ title: heading, body });
}

export function renderLanding({ siteName, hostname, remark }) {
  const body = `
  <main class="card">
    <div class="glyph">${LINK_ICON}</div>
    <h1>${escapeHtml(siteName)}</h1>
    <p>${escapeHtml(remark || `此域名（${hostname}）已启用短链接服务。`)}</p>
    <div class="foot">Powered by Cloudflare Workers</div>
  </main>`;
  return shell({ title: siteName, body });
}

// ---------- animation decorations ----------

const ANIM_CSS = {
  orbit: `
  .anim .ring{position:absolute;inset:0;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) 25%,transparent)}
  .anim .orbit{position:absolute;inset:0;animation:spin 1.6s linear infinite}
  .anim .orbit i{position:absolute;top:-3px;left:50%;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:var(--accent)}
  .anim .orbit i:nth-child(2){transform:rotate(120deg);transform-origin:50% 51px}
  .anim .orbit i:nth-child(3){transform:rotate(240deg);transform-origin:50% 51px}
  @keyframes spin{to{transform:rotate(360deg)}}
  `,
  pulse: `
  .anim .wave{position:absolute;inset:10px;border-radius:50%;border:2px solid var(--accent);opacity:0;animation:wave 1.8s ease-out infinite}
  .anim .wave:nth-child(2){animation-delay:.6s}
  .anim .wave:nth-child(3){animation-delay:1.2s}
  @keyframes wave{0%{transform:scale(.45);opacity:.8}100%{transform:scale(1.1);opacity:0}}
  `,
  fade: '',
  progress: '',
};

function animDecor(animation) {
  switch (animation) {
    case 'orbit':
      return '<span class="ring"></span><span class="orbit"><i></i><i></i><i></i></span>';
    case 'pulse':
      return '<span class="wave"></span><span class="wave"></span><span class="wave"></span>';
    default:
      return '';
  }
}

// Burn-after-reading note viewer. The server only renders the public cover;
// /_sl/note.js fetches and decrypts the content after the visitor taps "view".
export function renderNotePage(data) {
  const meta = data.meta || {};
  const title = meta.title || '一条私密消息';
  const theme = data.theme?.name || 'min';
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const desc = meta.hint || '打开后才能看到内容';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="${FAVICON}">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<link rel="stylesheet" href="/_sl/note.css">
</head>
<body class="nt-body nt-${escapeHtml(theme)}">
<main id="note-root" class="nt-wrap">
  <div class="nt-card">
    <div class="nt-head"><div class="nt-title">${escapeHtml(title)}</div></div>
    <p class="nt-hint">${escapeHtml(desc)}</p>
    <noscript><p class="nt-hint">查看这条消息需要启用 JavaScript。</p></noscript>
  </div>
</main>
<script type="application/json" id="note-data">${json}</script>
<script>(function(){var b=function(e){e.preventDefault()};document.addEventListener('contextmenu',b);document.addEventListener('copy',b);document.addEventListener('cut',b);document.addEventListener('selectstart',b);document.addEventListener('dragstart',b)})();</script>
<script type="module" src="/_sl/note.js"></script>
</body>
</html>`;
}
