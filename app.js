'use strict';
// Precise Ruler: patterns are generated in millimetres, then drawn either to a
// canvas sized in exact device pixels (snapping straight lines to the pixel
// grid) or to an SVG in real mm units for printing.

const MM_PER = { in: 25.4, cm: 10, mm: 1 };
const STORE = 'precise-ruler-v1';

const DEFAULTS = {
  mode: 'ruler',
  pxPerMm: null,          // device pixels per mm, from calibration
  calDate: null,
  calMethod: null,
  margin: 4,              // mm inset of the zero line from the screen edge
  theme: 'light',
  w: { l: 1, m: 2, h: 3 }, // device-pixel widths
  ruler: { a: 'in', b: 'cm', inDiv: 16, flip: false, cross: false },
  grid: { spacing: 0.25, unit: 'in', major: 4, mid: 2, origin: 'corner', labels: false },
  angles: { origin: 'bl', step: 5, major: 15, ring: true, labels: true, arcs: 'none' },
};

const THEMES = {
  light: { bg: '#ffffff', fg: '#000000' },
  dark:  { bg: '#000000', fg: '#ffffff' },
  blue:  { bg: '#ffffff', fg: '#0b3d91' },
  red:   { bg: '#000000', fg: '#ff2a2a' },
};

const GRID_PRESETS = [
  ['1 in', 1, 'in', 0, 0], ['½ in', 0.5, 'in', 2, 0], ['¼ in', 0.25, 'in', 4, 2],
  ['⅛ in', 0.125, 'in', 8, 4], ['1 cm', 1, 'cm', 0, 0], ['5 mm', 5, 'mm', 2, 0], ['1 mm', 1, 'mm', 10, 5],
];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s) return deepMerge(structuredClone(DEFAULTS), s);
  } catch (e) {}
  return structuredClone(DEFAULTS);
}
function deepMerge(a, b) {
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}
const S = load();
const save = () => localStorage.setItem(STORE, JSON.stringify(S));
const getK = (path) => path.split('.').reduce((o, k) => o[k], S);
const setK = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S)[last] = v; };

// Fallback guess before calibration: CSS assumes 96 px per inch.
const guessPxPerMm = () => (96 / 25.4) * (window.devicePixelRatio || 1);
const pxPerMm = () => S.pxPerMm || guessPxPerMm();

// ---------------------------------------------------------------- patterns
// A pattern is { lines:[{x1,y1,x2,y2,w}], arcs:[{cx,cy,r,w}], texts:[{x,y,t,size,align,base}] }
// in mm, origin top-left, y down. w is 'l' | 'm' | 'h'.

function buildPattern(mode, W, H, opts) {
  const P = { lines: [], arcs: [], texts: [] };
  if (mode === 'ruler') rulerPattern(P, W, H, opts);
  else if (mode === 'grid') gridPattern(P, W, H, opts);
  else anglePattern(P, W, H, opts);
  return P;
}

function rulerTicks(unit, inDiv) {
  // returns { step mm, level(i) -> 0..4, label(i) -> string|null }
  if (unit === 'in') {
    const d = inDiv;
    if (d === 10) return { step: 2.54, level: i => i % 10 === 0 ? 0 : i % 5 === 0 ? 1 : 3, label: i => i % 10 === 0 ? String(i / 10) : null };
    return {
      step: 25.4 / d,
      level: i => { for (let lv = 0, q = d; q >= 1; lv++, q /= 2) if (i % q === 0) return Math.min(lv, 4); return 4; },
      label: i => i % d === 0 ? String(i / d) : null,
    };
  }
  return { step: 1, level: i => i % 10 === 0 ? 0 : i % 5 === 0 ? 1 : 3, label: i => i % 10 === 0 ? String(i / 10) : null };
}

const TICK_LEN = [9, 7, 5, 3.5, 2.5]; // mm by level
const TICK_W = ['h', 'm', 'm', 'l', 'l'];

function rulerPattern(P, W, H, o) {
  const vertical = H >= W; // run the scale along the long side
  const L = vertical ? H : W, X = vertical ? W : H;
  const m = o.margin, flip = o.ruler.flip;
  const sides = [o.ruler.a, o.ruler.b];
  const put = (a, across1, across2, w) => {
    // a: position along the scale, across: position across it
    const p = flip ? L - a : a;
    if (vertical) P.lines.push({ x1: across1, y1: p, x2: across2, y2: p, w });
    else P.lines.push({ x1: p, y1: across1, x2: p, y2: across2, w });
  };
  const text = (a, across, t, align) => {
    const p = flip ? L - a : a;
    const size = 3.2;
    if (vertical) P.texts.push({ x: across, y: p, t, size, align, base: 'middle' });
    else P.texts.push({ x: p, y: across, t, size, align: 'center', base: align === 'left' ? 'top' : 'bottom' });
  };
  sides.forEach((unit, side) => {
    if (unit === 'none') return;
    const tk = rulerTicks(unit, o.ruler.inDiv);
    const n = Math.floor((L - m) / tk.step + 1e-9);
    for (let i = 0; i <= n; i++) {
      const a = m + i * tk.step, lv = tk.level(i), len = TICK_LEN[lv];
      if (side === 0) put(a, 0, len, TICK_W[lv]); else put(a, X - len, X, TICK_W[lv]);
      const lab = tk.label(i);
      if (lab !== null) {
        // the zero label sits just past the zero line so it doesn't cover it
        const t = i === 0 ? (unit === 'in' ? '0 in' : '0 cm') : lab, at = i === 0 ? a + 2.6 : a;
        if (side === 0) text(at, TICK_LEN[0] + 1.2, t, 'left');
        else text(at, X - TICK_LEN[0] - 1.2, t, 'right');
        if (o.ruler.cross && i > 0) put(a, TICK_LEN[0], X - TICK_LEN[0], 'l');
      }
    }
  });
  // zero line across the whole screen, for butting an object against
  put(m, 0, X, 'h');
}

function gridPattern(P, W, H, o) {
  const g = o.grid;
  const sp = g.spacing * MM_PER[g.unit];
  if (!(sp > 0.05)) return;
  const ox = g.origin === 'center' ? W / 2 : o.margin;
  const oy = g.origin === 'center' ? H / 2 : o.margin;
  const weight = i => (g.major > 0 && i % g.major === 0) ? 'h' : (g.mid > 0 && i % g.mid === 0) ? 'm' : 'l';
  const fmt = i => { const v = +(i * g.spacing).toFixed(4); return String(v); };
  for (let i = Math.ceil(-ox / sp - 1e-9); ox + i * sp <= W + 1e-9; i++) {
    const x = ox + i * sp, w = weight(i);
    P.lines.push({ x1: x, y1: 0, x2: x, y2: H, w });
    if (g.labels && w === 'h' && i !== 0) P.texts.push({ x: x + 0.8, y: oy + 0.8, t: fmt(i), size: 2.6, align: 'left', base: 'top' });
  }
  for (let j = Math.ceil(-oy / sp - 1e-9); oy + j * sp <= H + 1e-9; j++) {
    const y = oy + j * sp, w = weight(j);
    P.lines.push({ x1: 0, y1: y, x2: W, y2: y, w });
    if (g.labels && w === 'h' && j !== 0) P.texts.push({ x: ox + 0.8, y: y + 0.8, t: fmt(j), size: 2.6, align: 'left', base: 'top' });
  }
  if (g.labels) P.texts.push({ x: ox + 0.8, y: oy + 0.8, t: g.unit, size: 2.6, align: 'left', base: 'top' });
}

function anglePattern(P, W, H, o) {
  const a = o.angles, m = o.margin;
  const [cx, cy] = { bl: [m, H - m], bc: [W / 2, H - m], c: [W / 2, H / 2], tl: [m, m] }[a.origin];
  const R = Math.hypot(W, H) * 1.05;
  const near = (v, q) => Math.abs(v / q - Math.round(v / q)) < 1e-6;
  const minDim = Math.min(W, H);
  // ring radius: a comfortable fraction of the room available from the vertex
  const room = a.origin === 'c' ? minDim / 2 : a.origin === 'bc' ? Math.min(W / 2, H - m) : Math.min(W, H) - m;
  const ringR = Math.max(15, room * 0.62);
  const labR = ringR - 9;
  const visible = deg => {
    // skip rays that never enter the screen from this vertex
    const t = deg * Math.PI / 180, ex = cx + Math.cos(t) * R, ey = cy - Math.sin(t) * R;
    return !((ex < 0 && cx <= m + 1e-9 && Math.cos(t) < -1e-9) || (ey > H && cy >= H - m - 1e-9 && Math.sin(t) < -1e-9) || (ey < 0 && cy <= m + 1e-9 && Math.sin(t) > 1e-9));
  };
  for (let k = 0; k * a.step < 360 - 1e-9; k++) {
    const deg = k * a.step;
    if (!visible(deg)) continue;
    const t = deg * Math.PI / 180;
    const w = near(deg, 90) || near(deg, a.major) ? 'h' : near(deg, a.major / 3) && a.major / 3 >= a.step ? 'm' : 'l';
    // finer rays start further out so they don't merge into a blob at the vertex
    const r0 = w === 'h' ? 0 : w === 'm' ? 8 : 16;
    P.lines.push({ x1: cx + Math.cos(t) * r0, y1: cy - Math.sin(t) * r0, x2: cx + Math.cos(t) * R, y2: cy - Math.sin(t) * R, w });
    if (a.labels && w === 'h') {
      const lx = cx + Math.cos(t) * labR, ly = cy - Math.sin(t) * labR;
      if (lx > 2 && lx < W - 2 && ly > 2 && ly < H - 2) P.texts.push({ x: lx, y: ly, t: `${+deg.toFixed(2)}°`, size: 3, align: 'center', base: 'middle', boxed: true });
    }
  }
  if (a.ring) {
    for (let d = 0; d < 360; d++) {
      if (!visible(d)) continue;
      const t = d * Math.PI / 180, len = d % 10 === 0 ? 5 : d % 5 === 0 ? 3.5 : 2;
      const w = d % 10 === 0 ? 'h' : d % 5 === 0 ? 'm' : 'l';
      P.lines.push({ x1: cx + Math.cos(t) * ringR, y1: cy - Math.sin(t) * ringR, x2: cx + Math.cos(t) * (ringR - len), y2: cy - Math.sin(t) * (ringR - len), w });
    }
    P.arcs.push({ cx, cy, r: ringR, w: 'm' });
  }
  if (a.arcs !== 'none') {
    const s = MM_PER[a.arcs];
    for (let r = s; r < R; r += s) P.arcs.push({ cx, cy, r, w: 'l' });
  }
}

// ---------------------------------------------------------------- canvas
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let devW = 0, devH = 0;

function drawPattern(ctx, P, k, widths, fg, bg, Wd, Hd) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wd, Hd);
  ctx.fillStyle = fg; ctx.strokeStyle = fg;
  for (const L of P.lines) {
    const w = widths[L.w];
    if (Math.abs(L.x1 - L.x2) < 1e-9) {
      // vertical: centre lands within half a device pixel of the true position
      const x0 = Math.round(L.x1 * k - w / 2);
      const ya = Math.round(Math.min(L.y1, L.y2) * k), yb = Math.round(Math.max(L.y1, L.y2) * k);
      ctx.fillRect(x0, ya, w, Math.max(1, yb - ya));
    } else if (Math.abs(L.y1 - L.y2) < 1e-9) {
      const y0 = Math.round(L.y1 * k - w / 2);
      const xa = Math.round(Math.min(L.x1, L.x2) * k), xb = Math.round(Math.max(L.x1, L.x2) * k);
      ctx.fillRect(xa, y0, Math.max(1, xb - xa), w);
    } else {
      ctx.lineWidth = w; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(L.x1 * k, L.y1 * k); ctx.lineTo(L.x2 * k, L.y2 * k); ctx.stroke();
    }
  }
  for (const A of P.arcs) {
    ctx.lineWidth = widths[A.w];
    ctx.beginPath(); ctx.arc(A.cx * k, A.cy * k, A.r * k, 0, Math.PI * 2); ctx.stroke();
  }
  for (const T of P.texts) {
    const px = T.size * k;
    ctx.font = `${px}px system-ui, sans-serif`;
    ctx.textAlign = T.align; ctx.textBaseline = T.base;
    if (T.boxed) {
      const tw = ctx.measureText(T.t).width;
      ctx.fillStyle = bg; ctx.fillRect(T.x * k - tw / 2 - px * 0.2, T.y * k - px * 0.6, tw + px * 0.4, px * 1.2);
      ctx.fillStyle = fg;
    }
    ctx.fillText(T.t, T.x * k, T.y * k);
  }
}

function render() {
  if (!devW || !devH) return;
  const k = pxPerMm();
  const P = buildPattern(S.mode, devW / k, devH / k, S);
  const th = THEMES[S.theme] || THEMES.light;
  drawPattern(ctx, P, k, S.w, th.fg, th.bg, devW, devH);
  document.body.style.background = th.bg;
  updateStatus();
}

function sizeCanvas(canvas, entry) {
  // Prefer the exact device-pixel box (Chrome/Android); fall back to CSS px × DPR.
  let w, h;
  const dp = entry && entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
  const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  w = Math.round(r.width * d); h = Math.round(r.height * d);
  // trust the exact box only when it agrees with CSS size × DPR (some emulators report CSS px)
  if (dp && Math.abs(dp.inlineSize - w) <= 2 && Math.abs(dp.blockSize - h) <= 2) { w = dp.inlineSize; h = dp.blockSize; }
  canvas.width = w; canvas.height = h;
  return [w, h];
}

new ResizeObserver(([e]) => { [devW, devH] = sizeCanvas(cv, e); render(); })
  .observe(cv, { box: 'device-pixel-content-box' });

// ---------------------------------------------------------------- status
const statusEl = document.getElementById('status');
let statusTimer;
function updateStatus(flash) {
  if (!S.pxPerMm) {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Not calibrated yet: sizes are a guess. Open ⚙ → Calibrate screen.';
    return;
  }
  statusEl.className = 'status';
  if (flash) {
    statusEl.textContent = flash;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }
}

// ---------------------------------------------------------------- panel
const panel = document.getElementById('panel');
const openPanel = () => { panel.hidden = false; syncPanel(); };
document.getElementById('openPanel').onclick = openPanel;
document.getElementById('closePanel').onclick = () => { panel.hidden = true; };

cv.addEventListener('click', () => {
  if (!panel.hidden) { panel.hidden = true; return; }
  document.body.classList.toggle('ui-hidden');
});

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  S.mode = b.dataset.mode; save(); syncPanel(); render();
});

document.querySelectorAll('[data-k]').forEach(el => {
  const ev = el.type === 'number' ? 'input' : 'change';
  el.addEventListener(ev, () => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if ('num' in el.dataset) { v = parseFloat(el.value); if (!isFinite(v)) return; }
    else if ('bool' in el.dataset) v = el.value === 'true';
    else v = el.value;
    if (el.dataset.k.startsWith('w.')) v = Math.max(1, Math.round(v));
    setK(el.dataset.k, v); save(); render(); syncHints();
  });
});

const presetBox = document.getElementById('gridPresets');
for (const [name, sp, unit, major, mid] of GRID_PRESETS) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => { Object.assign(S.grid, { spacing: sp, unit, major, mid }); save(); syncPanel(); render(); };
  presetBox.appendChild(b);
}

function syncPanel() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('fieldset[data-for]').forEach(f => { f.hidden = f.dataset.for !== S.mode; });
  document.querySelectorAll('[data-k]').forEach(el => {
    const v = getK(el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  });
  syncHints();
}

function syncHints() {
  const k = pxPerMm();
  const f = n => (n / k).toFixed(3);
  document.getElementById('weightHint').textContent =
    `On this screen: light ${f(S.w.l)} mm, medium ${f(S.w.m)} mm, heavy ${f(S.w.h)} mm wide.`;
  const info = document.getElementById('calInfo');
  const pxMm = 1 / k;
  if (S.pxPerMm) {
    info.textContent = `Calibrated ${S.calDate || ''} (${S.calMethod || ''}): ${(k * 25.4).toFixed(1)} pixels per inch. ` +
      `One pixel is ${(pxMm * 1000).toFixed(0)} µm, so straight lines sit within ±${(pxMm * 500).toFixed(0)} µm ` +
      `(±${(pxMm / 2 / 25.4 * 1000).toFixed(2)} thou) of their true position; errors don't add up along the scale. ` +
      `Overall scale accuracy depends on how carefully you calibrated.`;
  } else {
    info.textContent = 'Not calibrated. Browsers do not know the physical size of the screen, so until you calibrate, an "inch" here is only the browser\'s guess and is often 10–40% off on phones.';
  }
}

// ---------------------------------------------------------------- fullscreen / wake lock
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock) keepAwake(); });
document.getElementById('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (e) {}
  keepAwake(); panel.hidden = true;
};

// ---------------------------------------------------------------- calibration
const cal = document.getElementById('cal');
const calCv = document.getElementById('calCanvas');
const calCtx = calCv.getContext('2d');
const calRef = document.getElementById('calRef');
let calW = 0, calH = 0, calLenPx = 0;
const CAL_START_MM_GUESS = 6;

function calRefMm() {
  const v = calRef.value;
  if (v === 'ruler') return (parseFloat(document.getElementById('rulerLen').value) || 0) * MM_PER[document.getElementById('rulerUnit').value];
  if (v === 'ppi') return 25.4;
  return parseFloat(v);
}
function calStart() { return Math.round(CAL_START_MM_GUESS * guessPxPerMm()); }
function calVertical() { return calH >= calW; }

function calSyncUI() {
  const v = calRef.value;
  document.getElementById('rulerLenRow').hidden = v !== 'ruler';
  document.getElementById('ppiRow').hidden = v !== 'ppi';
  document.getElementById('nudge').hidden = v === 'ppi';
  const help = document.getElementById('calHelp');
  const dir = calVertical() ? 'top' : 'left';
  const far = calVertical() ? 'bottom' : 'right';
  if (v === 'ppi') help.textContent = 'Enter the pixel density from the phone maker\'s spec sheet. Spec figures are often rounded, so matching a real object is usually more accurate.';
  else if (v === 'ruler') help.textContent = `Lay a ruler on the screen with its 0 mark on the ${dir} line. Drag anywhere (or use the buttons) until the ${far} line sits exactly on your chosen mark. Longer lengths give better accuracy.`;
  else help.textContent = `Hold the object flat on the screen with one edge exactly on the ${dir} line. Drag anywhere (or use the buttons) until the ${far} line just touches the opposite edge. Look straight down to avoid parallax.`;
  const mm = calRefMm();
  document.getElementById('calPx').textContent = `${calLenPx} px · ${(calLenPx / mm * 25.4).toFixed(1)} ppi`;
}

function calRender() {
  if (!calW) return;
  const c = calCtx, vert = calVertical(), s = calStart(), e = s + calLenPx;
  c.fillStyle = '#fff'; c.fillRect(0, 0, calW, calH);
  // shaded band between the lines so the target is easy to see
  c.fillStyle = '#dbeafe';
  if (vert) c.fillRect(0, s, calW, calLenPx); else c.fillRect(s, 0, calLenPx, calH);
  c.fillStyle = '#000';
  // 1-px reference lines exactly at the start and end pixel boundaries (drawn as 1px wide inside)
  const line = (p, col) => { c.fillStyle = col; if (vert) c.fillRect(0, p, calW, 1); else c.fillRect(p, 0, 1, calH); };
  line(s, '#000'); line(e - 1, '#c00');
  // short thick tabs outside the band mark where the thin lines are
  const tab = Math.round(1.5 * guessPxPerMm()), tl = Math.round(12 * guessPxPerMm());
  c.fillStyle = '#c00';
  if (vert) c.fillRect(calW - tl, e, tl, tab); else c.fillRect(e, calH - tl, tab, tl);
  c.fillStyle = '#000';
  if (vert) c.fillRect(calW - tl, s - tab, tl, tab); else c.fillRect(s - tab, calH - tl, tab, tl);
  // little arrows for visibility
  c.font = `${Math.round(4 * guessPxPerMm())}px system-ui`; c.fillStyle = '#c00'; c.textBaseline = 'bottom';
  if (vert) c.fillText('▲ end', 8, e - 4); else c.fillText('◀ end', e + 4, calH / 3);
  c.fillStyle = '#000'; c.textBaseline = 'top';
  if (vert) c.fillText('▼ start', 8, s + 4); else c.fillText('start ▶', 4, calH / 4);
}

new ResizeObserver(([e]) => { [calW, calH] = sizeCanvas(calCv, e); cal.classList.toggle('wide', !calVertical()); calSyncUI(); calRender(); })
  .observe(calCv, { box: 'device-pixel-content-box' });

function openCal() {
  panel.hidden = true; cal.hidden = false;
  document.getElementById('calDetails').open = !S.pxPerMm;
  const k = pxPerMm();
  calLenPx = Math.round(calRefMm() * k);
  if (S.pxPerMm) document.getElementById('ppiVal').value = (S.pxPerMm * 25.4).toFixed(1);
  calSyncUI(); calRender();
}
document.getElementById('calibrate').onclick = openCal;
document.getElementById('calCancel').onclick = () => { cal.hidden = true; };
const calReset = () => { calLenPx = Math.round(calRefMm() * pxPerMm()); calSyncUI(); calRender(); };
calRef.onchange = calReset;
document.getElementById('rulerLen').oninput = calReset;
document.getElementById('rulerUnit').onchange = calReset;
document.querySelectorAll('#nudge button').forEach(b => b.onclick = () => {
  calLenPx = Math.max(20, calLenPx + +b.dataset.d); calSyncUI(); calRender();
});

let drag = null;
calCv.addEventListener('pointerdown', e => {
  drag = { p: calVertical() ? e.clientY : e.clientX, len: calLenPx };
  calCv.setPointerCapture(e.pointerId);
  document.getElementById('calDetails').open = false;
});
calCv.addEventListener('pointermove', e => {
  if (!drag) return;
  const dpr = window.devicePixelRatio || 1;
  const d = ((calVertical() ? e.clientY : e.clientX) - drag.p) * dpr;
  // drag at 1/4 speed for fine control
  calLenPx = Math.max(20, Math.round(drag.len + d / 4)); calSyncUI(); calRender();
});
calCv.addEventListener('pointerup', () => { drag = null; });
calCv.addEventListener('pointercancel', () => { drag = null; });

document.getElementById('calSave').onclick = () => {
  if (calRef.value === 'ppi') {
    const ppi = parseFloat(document.getElementById('ppiVal').value);
    if (!(ppi > 50)) return;
    S.pxPerMm = ppi / 25.4; S.calMethod = 'entered ppi';
  } else {
    const mm = calRefMm();
    if (!(mm > 5)) return;
    S.pxPerMm = calLenPx / mm;
    S.calMethod = `${calRef.options[calRef.selectedIndex].text.split('(')[0].trim()}${calRef.value === 'ruler' ? `, ${mm.toFixed(1)} mm` : ''}`;
  }
  S.calDate = new Date().toISOString().slice(0, 10);
  save(); cal.hidden = true; render(); updateStatus(`Saved: ${(S.pxPerMm * 25.4).toFixed(1)} pixels per inch`);
};

// ---------------------------------------------------------------- print / SVG
const PAPER = { letter: [215.9, 279.4], a4: [210, 297], legal: [215.9, 355.6], tabloid: [279.4, 431.8], a3: [297, 420] };
const printDlg = document.getElementById('printDlg');
document.getElementById('print').onclick = () => { panel.hidden = true; printDlg.hidden = false; };
document.getElementById('printCancel').onclick = () => { printDlg.hidden = true; };

function buildSvg() {
  let [W, H] = PAPER[document.getElementById('paper').value];
  if (document.getElementById('orient').value === 'l') [W, H] = [H, W];
  const pw = { l: +document.getElementById('pw_l').value || 0.1, m: +document.getElementById('pw_m').value || 0.2, h: +document.getElementById('pw_h').value || 0.4 };
  // printers can't reach the paper edge; keep everything 6 mm in
  const inset = 6, IW = W - 2 * inset, IH = H - 2 * inset;
  const P = buildPattern(S.mode, IW, IH - 14, { ...S, margin: Math.max(S.margin, 2) });
  const r = n => +n.toFixed(4);
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  out.push(`<defs><clipPath id="clip"><rect x="0" y="0" width="${IW}" height="${IH - 14}"/></clipPath></defs>`);
  out.push(`<g transform="translate(${inset} ${inset})"><g clip-path="url(#clip)" stroke="#000" fill="none" stroke-linecap="butt">`);
  for (const L of P.lines) out.push(`<line x1="${r(L.x1)}" y1="${r(L.y1)}" x2="${r(L.x2)}" y2="${r(L.y2)}" stroke-width="${pw[L.w]}"/>`);
  for (const A of P.arcs) out.push(`<circle cx="${r(A.cx)}" cy="${r(A.cy)}" r="${r(A.r)}" stroke-width="${pw[A.w]}"/>`);
  out.push(`</g><g fill="#000" font-family="sans-serif">`);
  for (const T of P.texts) {
    const anchor = { left: 'start', center: 'middle', right: 'end' }[T.align];
    const base = { top: 'hanging', middle: 'central', bottom: 'auto' }[T.base];
    if (T.boxed) out.push(`<rect x="${r(T.x - T.size * 1.3)}" y="${r(T.y - T.size * 0.6)}" width="${r(T.size * 2.6)}" height="${r(T.size * 1.2)}" fill="#fff"/>`);
    out.push(`<text x="${r(T.x)}" y="${r(T.y)}" font-size="${T.size}" text-anchor="${anchor}" dominant-baseline="${base}">${esc(T.t)}</text>`);
  }
  out.push('</g>');
  // 100 mm check bar so the printed scale can be verified
  const by = IH - 6;
  out.push(`<g stroke="#000" stroke-width="0.2"><line x1="0" y1="${by}" x2="100" y2="${by}"/>`);
  for (let i = 0; i <= 10; i++) out.push(`<line x1="${i * 10}" y1="${by - (i % 5 ? 2 : 4)}" x2="${i * 10}" y2="${by}"/>`);
  out.push(`</g><text x="102" y="${by}" font-size="3" font-family="sans-serif" dominant-baseline="central">← this bar should measure exactly 100 mm (3.937 in)</text></g></svg>`);
  return { svg: out.join('\n'), W, H };
}

document.getElementById('doSvg').onclick = () => {
  const { svg } = buildSvg();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `precise-${S.mode}.svg`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
document.getElementById('doPrint').onclick = () => {
  const { svg, W, H } = buildSvg();
  let st = document.getElementById('pageSize');
  if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${W}mm ${H}mm; margin: 0; }`;
  document.getElementById('printArea').innerHTML = svg;
  window.print();
};

// ---------------------------------------------------------------- boot
syncPanel();
updateStatus();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// test hook
window.__pr = { S, buildPattern, pxPerMm, render, dev: () => [devW, devH] };
