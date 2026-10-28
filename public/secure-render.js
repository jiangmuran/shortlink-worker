// Secure text renderer.
//
// Draws text onto a <canvas> so it is never DOM text: not selectable, not in
// innerHTML/textContent, not in "view source". Two anti-capture looks make a
// single still frame carry only noise, while the eye integrates successive
// frames into readable text:
//   motion — the text is a window into a scrolling noise field (one still = noise)
//   comp   — complementary frames whose background pixels flip each frame
// Plus crisp canvas looks (plain / type / window / countdown) that are still
// un-selectable and un-copyable; flicker modes fall back to these under
// prefers-reduced-motion.
//
// The decrypted string becomes a bitmap mask (for anti modes) or is drawn and
// never stored on the DOM. Callers drop their own reference afterwards.

const FONT = '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const gray = (l) => (0xff000000 | (l << 16) | (l << 8) | l) >>> 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const modp = (a, n) => ((a % n) + n) % n;

let _seed = ((Math.random() * 0xffffffff) >>> 0) || 0x2545f491;
function rnd() {
  _seed ^= _seed << 13;
  _seed ^= _seed >>> 17;
  _seed ^= _seed << 5;
  return _seed >>> 0;
}

export const SECURE_MODES = [
  { id: 'motion', label: '运动噪点', tag: '推荐', anti: true, desc: '文字藏在滚动的噪点里，单张截图只能拍到噪点，人眼能连续看清。' },
  { id: 'comp', label: '互补帧', tag: '会闪烁', anti: true, flicker: true, desc: '相邻两帧互补，叠起来才是文字，截一帧只是噪点。对闪光敏感时请改用其他方式。' },
  { id: 'plain', label: '直接显示', desc: '打开即显示全文，画布绘制，依然不可选中、不可复制。' },
  { id: 'type', label: '逐字显示', desc: '文字逐字浮现，前面的保留。' },
  { id: 'window', label: '滑动窗口', desc: '文字逐个出现，前面的随之消失，屏幕上始终只有几个字。' },
  { id: 'countdown', label: '倒计时', desc: '显示全文，倒计时结束后从画面清除。' },
];
export const modeInfo = (id) => SECURE_MODES.find((m) => m.id === id) || SECURE_MODES[0];

const DEFAULTS = {
  // cell 1 = finest noise (more noise cells per stroke = far more legible);
  // large font + generous area make the moving text read clearly.
  motion: { speed: 1.4, cell: 1, contrast: 100, density: 'bin' },
  comp: { contrast: 82, interval: 1, refresh: 10, cell: 1 },
  plain: {},
  type: { chunk: 2, speed: 120 },
  window: { window: 6, speed: 220 },
  countdown: { seconds: 30 },
};

// shared offscreen canvas for mask building
const _mc = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const _mg = _mc && _mc.getContext('2d', { willReadFrequently: true });

function wrapLines(g, text, maxW) {
  const out = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    if (!para) {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      if (line && g.measureText(line + ch).width > maxW) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

export class SecureText {
  // host: element to fill. opts: { mode, params, accent, fontScale, hold, hideOnBlur, onDone }
  constructor(host, opts = {}) {
    this.host = host;
    host.classList.add('sx-host');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sx-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.text = '';
    this.raf = 0;
    this.running = false;
    this.opts = {};
    this._boundLoop = (t) => this._loop(t);
    this._ro = new ResizeObserver(() => this._needLayout());
    this._ro.observe(host);
    this._onVis = () => this._applyBlur();
    this._onBlur = () => this._applyBlur(true);
    this._onFocus = () => this._applyBlur(false);
    document.addEventListener('visibilitychange', this._onVis);
    addEventListener('blur', this._onBlur);
    addEventListener('focus', this._onFocus);
    this.update(opts);
  }

  update(opts) {
    this.opts = { fontScale: 1, accent: null, hold: false, hideOnBlur: false, ...this.opts, ...opts };
    let mode = this.opts.mode || 'motion';
    if (reduceMotion && modeInfo(mode).flicker) mode = 'plain';
    this.mode = mode;
    this.anti = mode === 'motion' || mode === 'comp';
    this.params = { ...DEFAULTS[mode], ...(this.opts.params || {}) };
    this._restart();
  }

  setText(text) {
    this.text = String(text ?? '');
    this._chars = null;
    this._restart();
  }

  _isDark() {
    return getComputedStyle(this.host).getPropertyValue('--sx-dark').trim() === '1';
  }
  _ink() {
    return this._isDark() ? '#ececec' : '#17181c';
  }
  _paper() {
    return this._isDark() ? '#0a0a0a' : '#f7f7f8';
  }

  _needLayout() {
    this._dirtyLayout = true;
    this.needsPaint = true;
  }

  _fontPx(cssW) {
    // anti-capture looks need big, bold glyphs so each stroke spans many noise
    // cells and reads clearly while moving; crisp looks can be smaller.
    const base = this.anti ? clamp(cssW / 9, 26, 56) : clamp(cssW / 15, 17, 38);
    return Math.round(base * (this.opts.fontScale || 1));
  }

  // anti modes: low-res pixel grid canvas (1 canvas px per cell, scaled up by CSS)
  _layoutAnti() {
    const cssW = this.host.clientWidth;
    if (!cssW) return false;
    const cell = this.params.cell || 1;
    const cols = Math.max(60, Math.floor(cssW / cell));
    const fontCell = Math.max(10, Math.round(this._fontPx(cssW) / cell));
    const gapCell = Math.round(fontCell * 0.42);
    const padCell = Math.round(fontCell * 0.7);
    _mc.width = cols;
    _mc.height = 8;
    _mg.font = `800 ${fontCell}px ${FONT}`;
    const lines = wrapLines(_mg, this.text || ' ', cols - padCell * 2);
    const lineH = fontCell + gapCell;
    const blockH = lines.length * lineH - gapCell;
    const minRows = Math.round(150 / cell);
    const rows = Math.max(minRows, blockH + padCell * 2);
    this.cols = cols;
    this.rows = rows;
    this.canvas.width = cols;
    this.canvas.height = rows;
    this.canvas.style.width = cols * cell + 'px';
    this.canvas.style.height = rows * cell + 'px';
    this.img = this.ctx.createImageData(cols, rows);
    this.out = new Uint32Array(this.img.data.buffer);
    // build mask (text block vertically centered for a generous, balanced area)
    _mc.width = cols;
    _mc.height = rows;
    _mg.clearRect(0, 0, cols, rows);
    _mg.font = `800 ${fontCell}px ${FONT}`;
    _mg.fillStyle = '#fff';
    _mg.textAlign = 'center';
    _mg.textBaseline = 'top';
    let y = Math.max(padCell, Math.round((rows - blockH) / 2));
    for (const ln of lines) {
      if (ln) _mg.fillText(ln, cols / 2, y);
      y += lineH;
    }
    const d = _mg.getImageData(0, 0, cols, rows).data;
    this.mask = new Uint8Array(cols * rows);
    for (let i = 0, j = 3; i < this.mask.length; i++, j += 4) this.mask[i] = d[j] > 100 ? 1 : 0;
    this._allocAnti();
    return true;
  }
  _allocAnti() {
    const n = this.cols * this.rows;
    if (this.mode === 'motion') {
      this.fg = new Uint8Array(n);
      this.bg = new Uint8Array(n);
      this._fillNoise(this.fg);
      this._fillNoise(this.bg);
      this.off = 0;
      this.acc = 0;
    } else {
      this.noise = new Uint8Array(n);
      for (let i = 0; i < n; i++) this.noise[i] = (rnd() >>> 8) & 1;
      this.phase = 0;
      this.tick = 0;
      this.cycles = 0;
    }
  }
  _fillNoise(a) {
    if (this.params.density === 'gray') for (let i = 0; i < a.length; i++) a[i] = rnd() >>> 24;
    else for (let i = 0; i < a.length; i++) a[i] = rnd() & 0x100 ? 255 : 0;
  }

  // plain modes: crisp high-DPI canvas; height from wrapped text
  _layoutCrisp() {
    const cssW = this.host.clientWidth;
    if (!cssW) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fontPx = this._fontPx(cssW);
    const gap = Math.round(fontPx * 0.5);
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.font = `600 ${fontPx}px ${FONT}`;
    const lines = this.mode === 'window' ? [''] : wrapLines(g, this.text || ' ', cssW - 16);
    const cssH = Math.max(this.mode === 'window' ? Math.round(fontPx * 2.6) : 0, lines.length * (fontPx + gap) + 10);
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.fontPx = fontPx;
    this.gap = gap;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    return true;
  }

  _restart() {
    cancelAnimationFrame(this.raf);
    this.start = performance.now();
    this.finished = false;
    this.revealChars = 0;
    this.winIndex = 0;
    this._lastLeft = null;
    this._held = !this.opts.hold;
    this._blurred = false;
    this._dirtyLayout = false;
    const ok = this.anti ? this._layoutAnti() : this._layoutCrisp();
    if (!ok) {
      this.raf = requestAnimationFrame(() => this._restart());
      return;
    }
    this.needsPaint = true;
    this.running = true;
    this.raf = requestAnimationFrame(this._boundLoop);
  }

  _applyBlur(force) {
    if (!this.opts.hideOnBlur) return;
    this._blurred = force === undefined ? document.hidden : force;
    this.host.classList.toggle('sx-veiled', this._blurred);
    this.needsPaint = true;
  }

  press() {
    if (!this.opts.hold) return;
    this._held = true;
    this.host.classList.add('sx-holding');
    this.needsPaint = true;
  }
  release() {
    if (!this.opts.hold) return;
    this._held = false;
    this.host.classList.remove('sx-holding');
    this.needsPaint = true;
  }
  _visible() {
    return this._held && !this._blurred;
  }

  _loop(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._boundLoop);
    if (this._dirtyLayout) {
      this._dirtyLayout = false;
      (this.anti ? this._layoutAnti() : this._layoutCrisp());
      this.needsPaint = true;
    }
    if (!this._visible()) {
      if (this.needsPaint) {
        this._blank();
        this.needsPaint = false;
      }
      return;
    }
    if (this.anti) this._renderAnti();
    else this._renderCrisp(now);
  }

  _blank() {
    if (this.anti) {
      this.out.fill(this._isDark() ? gray(10) : gray(247));
      this.ctx.putImageData(this.img, 0, 0);
    } else {
      const g = this.ctx;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = this._paper();
      g.fillRect(0, 0, this.cssW, this.cssH);
    }
  }

  _renderAnti() {
    if (this.mode === 'motion') {
      this.acc += this.params.speed;
      const s = Math.floor(this.acc);
      if (s > 0) {
        this.acc -= s;
        this.off += s;
      }
      const { cols, rows, out, mask, fg, bg } = this;
      const c = this.params.contrast / 100;
      const lut = (this._lut ||= new Uint32Array(256));
      for (let v = 0; v < 256; v++) lut[v] = gray(clamp(Math.round(128 + (v - 127.5) / 127.5 * c * 127), 0, 255));
      // fg and bg scroll in opposite directions → strong relative motion makes
      // the text boundary pop out to the eye while a still frame stays noise
      const oF = modp(-this.off, rows);
      const oB = modp(this.off, rows);
      for (let y = 0; y < rows; y++) {
        let yf = y + oF;
        if (yf >= rows) yf -= rows;
        let yb = y + oB;
        if (yb >= rows) yb -= rows;
        const r = y * cols, rf = yf * cols, rb = yb * cols;
        for (let x = 0; x < cols; x++) {
          const i = r + x;
          out[i] = mask[i] ? lut[fg[rf + x]] : lut[bg[rb + x]];
        }
      }
    } else {
      if (++this.tick >= this.params.interval) {
        this.tick = 0;
        this.phase ^= 1;
        if (this.phase === 0 && this.params.refresh > 0 && ++this.cycles % this.params.refresh === 0) {
          for (let i = 0; i < this.noise.length; i++) this.noise[i] = (rnd() >>> 8) & 1;
        }
      }
      const d = Math.round((this.params.contrast / 100) * 127);
      const hi = gray(128 + d), lo = gray(128 - d);
      const { out, mask, noise, phase } = this;
      for (let i = 0; i < out.length; i++) {
        let s = noise[i];
        if (phase && !mask[i]) s ^= 1;
        out[i] = s ? hi : lo;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  _chArr() {
    return (this._chars ||= Array.from(this.text));
  }

  _renderCrisp(now) {
    const el = now - this.start;
    let changed = this.needsPaint;
    this.needsPaint = false;
    if (this.mode === 'type') {
      const want = Math.min(this._chArr().length, Math.floor(el / this.params.speed) * this.params.chunk);
      if (want !== this.revealChars) {
        this.revealChars = want;
        changed = true;
      }
      if (want >= this._chArr().length && !this.finished) this._finish(1400);
    } else if (this.mode === 'window') {
      const want = Math.floor(el / this.params.speed);
      if (want !== this.winIndex) {
        this.winIndex = want;
        changed = true;
      }
      if (want >= this._chArr().length + this.params.window && !this.finished) this._finish(0);
    } else if (this.mode === 'countdown') {
      const left = Math.ceil(this.params.seconds - el / 1000);
      if (left !== this._lastLeft) {
        this._lastLeft = left;
        changed = true;
      }
      if (left <= 0 && !this.finished) this._finish(0);
    }
    if (!changed) return;
    this._draw();
  }

  _draw() {
    const g = this.ctx;
    const { cssW, cssH, dpr, fontPx, gap } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = this._paper();
    g.fillRect(0, 0, cssW, cssH);
    g.fillStyle = this._ink();
    const chars = this._chArr();
    if (this.mode === 'window') {
      const seg = chars
        .slice(Math.max(0, this.winIndex - this.params.window), this.winIndex)
        .join('')
        .replace(/\n/g, ' ');
      g.font = `600 ${Math.round(fontPx * 1.5)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (this.opts.accent) g.fillStyle = this.opts.accent;
      g.fillText(seg, cssW / 2, cssH / 2);
      return;
    }
    const shown = this.mode === 'type' ? chars.slice(0, this.revealChars).join('') : this.text;
    g.font = `600 ${fontPx}px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const lines = wrapLines(g, shown || ' ', cssW - 16);
    let y = 5;
    for (const ln of lines) {
      if (ln) g.fillText(ln, 8, y);
      y += fontPx + gap;
    }
    if (this.mode === 'countdown' && this._lastLeft > 0) {
      g.font = `600 13px ${FONT}`;
      g.fillStyle = this.opts.accent || (this._isDark() ? '#f2b552' : '#8c5400');
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText(`${this._lastLeft}s`, cssW - 8, cssH - 6);
    }
  }

  _finish(delay) {
    this.finished = true;
    this._finTimer = setTimeout(() => {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this._blank();
      this.opts.onDone && this.opts.onDone();
    }, delay);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this._finTimer);
    this._ro.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    removeEventListener('blur', this._onBlur);
    removeEventListener('focus', this._onFocus);
    this.host.innerHTML = '';
    this.mask = this.fg = this.bg = this.noise = this.text = this._chars = null;
  }
}

// SecureImage: draws a decoded image onto a canvas. The bytes are turned into a
// transient Blob only to decode (createImageBitmap); no <img>, no object URL,
// nothing extractable is left in the DOM. Right-click and drag are blocked, so
// an attached image is no easier to lift than the drawn text.
export class SecureImage {
  constructor(host) {
    this.host = host;
    host.classList.add('sx-host');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sx-canvas sx-img';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._block = (e) => e.preventDefault();
    this.canvas.addEventListener('contextmenu', this._block);
    this.canvas.addEventListener('dragstart', this._block);
  }
  async render(bytes, mime) {
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }));
      const maxW = this.host.clientWidth || 320;
      const scale = Math.min(1, maxW / bmp.width);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, w, h);
      this.ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      return true;
    } catch (e) {
      return false;
    }
  }
  destroy() {
    this.canvas.removeEventListener('contextmenu', this._block);
    this.canvas.removeEventListener('dragstart', this._block);
    this.canvas.remove();
  }
}
