'use strict';
// True-size ruler, grid, angles and measuring tool.
// Patterns are generated in millimetres, then drawn either to a canvas sized in
// exact device pixels (snapping straight lines to the pixel grid) or to an SVG
// in real mm units for printing. The mm→pixel scale comes from the phone's
// published screen specs (devices.js) or from a calibration.

const MM_PER = { in: 25.4, cm: 10, mm: 1 };
const STORE = 'precise-ruler-v1';

const DEFAULTS = {
  mode: 'ruler',
  scale: null,            // see pxPerMm()
  margin: 4,              // mm inset of the zero line from the screen edge
  theme: 'light',
  units: 'in',
  frac: 16,
  autoFull: true,
  w: { l: 1, m: 2, h: 3 }, // device-pixel widths
  ruler: { a: 'in', b: 'cm', inDiv: 16, flip: false, cross: false },
  grid: { spacing: 0.25, unit: 'in', major: 4, mid: 2, origin: 'corner', labels: false, dx: 0, dy: 0 },
  angles: { origin: 'bl', step: 5, major: 15, ring: true, labels: true, arcs: 'none', dx: 0, dy: 0, rot: 0 },
  measure: { snap: true, backdrop: false, shape: 'line' },
};

const THEMES = {
  light: { bg: '#ffffff', fg: '#000000', accent: '#1d4ed8' },
  dark:  { bg: '#000000', fg: '#ffffff', accent: '#60a5fa' },
  blue:  { bg: '#ffffff', fg: '#0b3d91', accent: '#c2410c' },
  red:   { bg: '#000000', fg: '#ff2a2a', accent: '#ffb000' },
};

const GRID_PRESETS = [
  ['1 in', 1, 'in', 0, 0], ['½ in', 0.5, 'in', 2, 0], ['¼ in', 0.25, 'in', 4, 2],
  ['⅛ in', 0.125, 'in', 8, 4], ['1 cm', 1, 'cm', 0, 0], ['5 mm', 5, 'mm', 2, 0], ['1 mm', 1, 'mm', 10, 5],
];

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE)); } catch (e) {}
  const out = deepMerge(structuredClone(DEFAULTS), s || {});
  if (out.pxPerMm && !out.scale) { // settings from the first version
    out.scale = { source: 'calibration', pxPerMm: out.pxPerMm, refShortPx: null, label: 'your calibration', unc: 0.002 };
  }
  delete out.pxPerMm;
  return out;
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
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- scale
// Device pixels across the screen's short side, as the browser renders it.
const dpr = () => window.devicePixelRatio || 1;
const screenShortPx = () => Math.min(screen.width, screen.height) * dpr();
const screenLongPx = () => Math.max(screen.width, screen.height) * dpr();

// Phones often render below panel resolution (Samsung FHD+ mode, Pixel "High
// resolution"). screen.width × DPR is only approximate, so snap to the common
// scale ratios when close.
const RENDER_RATIOS = [1, 3 / 4, 2 / 3, 1 / 2];
function renderRatio(nativeShort) {
  const r = screenShortPx() / nativeShort;
  for (const R of RENDER_RATIOS) if (Math.abs(r / R - 1) < 0.012) return R;
  return r;
}

const guessPxPerMm = () => (96 / 25.4) * dpr();
function pxPerMm() {
  const sc = S.scale;
  if (!sc) return guessPxPerMm();
  if (sc.source === 'device') return sc.nativeShort * renderRatio(sc.nativeShort) / sc.shortMm;
  // calibrated: follow later changes to the phone's rendering resolution
  const now = screenShortPx();
  if (sc.refShortPx && Math.abs(now / sc.refShortPx - 1) > 0.02) return sc.pxPerMm * now / sc.refShortPx;
  return sc.pxPerMm;
}

// ---------------------------------------------------------------- devices
const DEVS = (window.DEVICES || []).filter(d => d.r && (d.ppi || d.d || d.dmm));
const devId = d => `${d.b} ${d.n}${d.s && d.s !== 'main' ? ` (${d.s} screen)` : ''}`;
function devShortMm(d) {
  if (d.ppi) return d.r[0] / d.ppi * 25.4;
  const diag = d.dmm || d.d * 25.4;
  return diag * d.r[0] / Math.hypot(d.r[0], d.r[1]);
}
// Relative uncertainty of the published figure (rounding only).
function devUnc(d) {
  if (d.ppi && d.by === 'm') return 0.5 / d.ppi;
  if (d.dmm) return 0.05 / d.dmm;
  if (d.d) { const dec = (String(d.d).split('.')[1] || '').length; return 0.5 * 10 ** -dec / d.d; }
  return 0.5 / d.ppi;
}
function screenFits(d) {
  const aspect = screenLongPx() / screenShortPx(), dAspect = d.r[1] / d.r[0];
  if (Math.abs(aspect / dAspect - 1) > 0.025) return false;
  const r = screenShortPx() / d.r[0];
  return RENDER_RATIOS.some(R => Math.abs(r / R - 1) < 0.012);
}
function modelFits(d, model) {
  const m = model.toLowerCase().trim();
  return (d.ua || []).some(u => {
    u = u.toLowerCase();
    return m === u || (/^(sm-|cph|xt)/.test(u) && m.startsWith(u));
  });
}
let detectedModel = '';
async function detectModel() {
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const v = await navigator.userAgentData.getHighEntropyValues(['model']);
      if (v.model) return v.model;
    }
  } catch (e) {}
  const m = navigator.userAgent.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/);
  return m && m[1] !== 'K' ? m[1].trim() : '';
}
// Phones that could be this one: by reported model, else by screen resolution.
function candidates() {
  if (detectedModel) {
    const byModel = DEVS.filter(d => modelFits(d, detectedModel));
    if (byModel.length) {
      const fit = byModel.filter(screenFits);
      return { how: 'model', list: fit.length ? fit : byModel };
    }
  }
  return { how: 'screen', list: DEVS.filter(screenFits) };
}
// One answer if all candidates have practically the same physical width.
function confidentPick(list) {
  if (!list.length) return null;
  const ws = list.map(devShortMm), lo = Math.min(...ws), hi = Math.max(...ws);
  if (hi / lo - 1 > 0.003) return null;
  return [...list].sort((a, b) => devUnc(a) - devUnc(b))[0];
}
function useDevice(d, quiet) {
  S.scale = { source: 'device', id: devId(d), label: devId(d), shortMm: devShortMm(d), nativeShort: d.r[0], unc: devUnc(d) };
  save(); render(); syncPanel();
  if (!quiet) toast(`Using ${devId(d)} screen specs`);
}
// Foldables: switch between inner and cover screen entries automatically.
function followFoldScreen() {
  const sc = S.scale;
  if (!sc || sc.source !== 'device') return;
  const cur = DEVS.find(d => devId(d) === sc.id);
  if (!cur || screenFits(cur)) return;
  const sib = DEVS.find(d => d.b === cur.b && d.n === cur.n && d !== cur && screenFits(d));
  if (sib) { useDevice(sib, true); toast(`Switched to ${devId(sib)}`); }
}

// ---------------------------------------------------------------- patterns
// A pattern is { lines:[{x1,y1,x2,y2,w,faint}], arcs:[{cx,cy,r,w}], texts:[{x,y,t,size,align,base,boxed}] }
// in mm, origin top-left, y down. w is 'l' | 'm' | 'h'.

function buildPattern(mode, W, H, opts) {
  const P = { lines: [], arcs: [], texts: [] };
  if (mode === 'ruler') rulerPattern(P, W, H, opts);
  else if (mode === 'grid') gridPattern(P, W, H, opts);
  else if (mode === 'angles') anglePattern(P, W, H, opts);
  else if (mode === 'measure' && opts.measure.backdrop) {
    gridPattern(P, W, H, { ...opts, grid: { spacing: 1, unit: 'cm', major: 0, mid: 0, origin: 'corner', dx: 0, dy: 0 } });
    P.lines.forEach(l => { l.faint = true; });
  }
  return P;
}

function rulerTicks(unit, inDiv) {
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

// The ruler runs along the long side; returns helpers shared with the reading line.
function rulerGeom(W, H, o) {
  const vertical = H >= W;
  const L = vertical ? H : W, X = vertical ? W : H;
  return { vertical, L, X, m: o.margin, flip: o.ruler.flip };
}

function rulerPattern(P, W, H, o) {
  const { vertical, L, X, m, flip } = rulerGeom(W, H, o);
  const put = (a, c1, c2, w) => {
    const p = flip ? L - a : a;
    if (vertical) P.lines.push({ x1: c1, y1: p, x2: c2, y2: p, w });
    else P.lines.push({ x1: p, y1: c1, x2: p, y2: c2, w });
  };
  const text = (a, across, t, align) => {
    const p = flip ? L - a : a, size = 3.2;
    if (vertical) P.texts.push({ x: across, y: p, t, size, align, base: 'middle' });
    else P.texts.push({ x: p, y: across, t, size, align: 'center', base: align === 'left' ? 'top' : 'bottom' });
  };
  [o.ruler.a, o.ruler.b].forEach((unit, side) => {
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
  put(m, 0, X, 'h'); // zero line across the whole screen, to butt an object against
}

function gridPattern(P, W, H, o) {
  const g = o.grid;
  const sp = g.spacing * MM_PER[g.unit];
  if (!(sp > 0.05)) return;
  const ox = (g.origin === 'center' ? W / 2 : o.margin) + (g.dx || 0);
  const oy = (g.origin === 'center' ? H / 2 : o.margin) + (g.dy || 0);
  const weight = i => (g.major > 0 && i % g.major === 0) ? 'h' : (g.mid > 0 && i % g.mid === 0) ? 'm' : 'l';
  const fmt = i => String(+(i * g.spacing).toFixed(4));
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

function angleVertex(W, H, o) {
  const a = o.angles, m = o.margin;
  const [cx, cy] = { bl: [m, H - m], bc: [W / 2, H - m], c: [W / 2, H / 2], tl: [m, m] }[a.origin];
  const minDim = Math.min(W, H);
  const room = a.origin === 'c' ? minDim / 2 : a.origin === 'bc' ? Math.min(W / 2, H - m) : minDim - m;
  return { cx: cx + (a.dx || 0), cy: cy + (a.dy || 0), ringR: Math.max(15, room * 0.62) };
}

function anglePattern(P, W, H, o) {
  const a = o.angles;
  const { cx, cy, ringR } = angleVertex(W, H, o);
  const R = Math.hypot(W, H) * 2;
  const rot = a.rot || 0;
  const near = (v, q) => Math.abs(v / q - Math.round(v / q)) < 1e-6;
  const labR = ringR - 9;
  const dir = deg => { const t = (deg + rot) * Math.PI / 180; return [Math.cos(t), -Math.sin(t)]; };
  for (let k = 0; k * a.step < 360 - 1e-9; k++) {
    const deg = k * a.step, [ux, uy] = dir(deg);
    const w = near(deg, 90) || near(deg, a.major) ? 'h' : near(deg, a.major / 3) && a.major / 3 >= a.step ? 'm' : 'l';
    // finer rays start further out so they don't merge into a blob at the vertex
    const r0 = w === 'h' ? 0 : w === 'm' ? 8 : 16;
    P.lines.push({ x1: cx + ux * r0, y1: cy + uy * r0, x2: cx + ux * R, y2: cy + uy * R, w });
    if (a.labels && w === 'h') {
      const lx = cx + ux * labR, ly = cy + uy * labR;
      const lab = deg > 180 ? deg - 360 : deg;
      if (lx > 2 && lx < W - 2 && ly > 2 && ly < H - 2) P.texts.push({ x: lx, y: ly, t: `${+lab.toFixed(2)}°`, size: 3, align: 'center', base: 'middle', boxed: true });
    }
  }
  if (a.ring) {
    for (let d = 0; d < 360; d++) {
      const [ux, uy] = dir(d), len = d % 10 === 0 ? 5 : d % 5 === 0 ? 3.5 : 2;
      const w = d % 10 === 0 ? 'h' : d % 5 === 0 ? 'm' : 'l';
      P.lines.push({ x1: cx + ux * ringR, y1: cy + uy * ringR, x2: cx + ux * (ringR - len), y2: cy + uy * (ringR - len), w });
    }
    P.arcs.push({ cx, cy, r: ringR, w: 'm' });
  }
  if (a.arcs !== 'none') {
    const s = MM_PER[a.arcs];
    for (let r = s; r < Math.hypot(W, H); r += s) P.arcs.push({ cx, cy, r, w: 'l' });
  }
}

// ---------------------------------------------------------------- canvas
const cv = $('c');
const ctx = cv.getContext('2d');
let devW = 0, devH = 0;

function drawPattern(ctx, P, k, widths, fg, bg, Wd, Hd) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wd, Hd);
  ctx.fillStyle = fg; ctx.strokeStyle = fg;
  for (const L of P.lines) {
    const w = widths[L.w];
    ctx.globalAlpha = L.faint ? 0.22 : 1;
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
  ctx.globalAlpha = 1;
  for (const A of P.arcs) {
    ctx.lineWidth = widths[A.w];
    ctx.beginPath(); ctx.arc(A.cx * k, A.cy * k, A.r * k, 0, Math.PI * 2); ctx.stroke();
  }
  for (const T of P.texts) drawText(ctx, T, k, fg, bg);
}

function drawText(ctx, T, k, fg, bg) {
  const px = T.size * k;
  ctx.font = `${T.bold ? '600 ' : ''}${px}px system-ui, sans-serif`;
  ctx.textAlign = T.align; ctx.textBaseline = T.base;
  if (T.boxed) {
    const tw = ctx.measureText(T.t).width;
    const x0 = T.align === 'center' ? T.x * k - tw / 2 : T.align === 'right' ? T.x * k - tw : T.x * k;
    const y0 = T.base === 'middle' ? T.y * k - px * 0.6 : T.base === 'top' ? T.y * k - px * 0.1 : T.y * k - px * 1.1;
    ctx.fillStyle = bg; ctx.fillRect(x0 - px * 0.25, y0, tw + px * 0.5, px * 1.2);
  }
  ctx.fillStyle = T.color || fg;
  ctx.fillText(T.t, T.x * k, T.y * k);
}

const sizeMm = () => { const k = pxPerMm(); return [devW / k, devH / k]; };

function render() {
  if (!devW || !devH) return;
  const k = pxPerMm();
  const [W, H] = sizeMm();
  const th = THEMES[S.theme] || THEMES.light;
  drawPattern(ctx, buildPattern(S.mode, W, H, S), k, S.w, th.fg, th.bg, devW, devH);
  drawOverlay(k, W, H, th);
  document.body.style.background = th.bg;
  updateHud();
}

function sizeCanvas(canvas, entry) {
  // Prefer the exact device-pixel box (Chrome/Android); fall back to CSS px × DPR.
  const dp = entry && entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
  const r = canvas.getBoundingClientRect(), d = dpr();
  let w = Math.round(r.width * d), h = Math.round(r.height * d);
  // trust the exact box only when it agrees with CSS size × DPR (some emulators report CSS px)
  if (dp && Math.abs(dp.inlineSize - w) <= 2 && Math.abs(dp.blockSize - h) <= 2) { w = dp.inlineSize; h = dp.blockSize; }
  canvas.width = w; canvas.height = h;
  return [w, h];
}

new ResizeObserver(([e]) => { [devW, devH] = sizeCanvas(cv, e); followFoldScreen(); render(); })
  .observe(cv, { box: 'device-pixel-content-box' });

// ---------------------------------------------------------------- live state
// Things you place with your fingers; not saved between visits.
const V = {
  cursor: null,                 // ruler reading line: mm along the ruler
  m: null,                      // measurement { a:{x,y}, b:{x,y} } in mm
  active: null,                 // 'a' | 'b' — the end arrow keys move
};

// ---------------------------------------------------------------- readings
function fracIn(inches) {
  const den = S.frac;
  if (!den) return null;
  const n = Math.round(Math.abs(inches) * den);
  const whole = Math.floor(n / den);
  let num = n % den, d = den;
  while (num && num % 2 === 0) { num /= 2; d /= 2; }
  const s = num ? (whole ? `${whole} ${num}/${d}` : `${num}/${d}`) : String(whole);
  return (inches < 0 ? '−' : '') + s;
}
function fmtIn(mm, decimals = 2) {
  const inches = mm / 25.4, dec = inches.toFixed(decimals);
  const f = fracIn(inches);
  if (f === null) return `${dec} in`;
  const exact = Math.abs(inches * S.frac - Math.round(inches * S.frac)) < 0.02;
  return exact ? `${f} in` : `${dec} in ≈ ${f}`;
}
const fmtMm = mm => `${mm.toFixed(1)} mm`;
function fmtLen(mm) { return S.units === 'mm' ? `${fmtMm(mm)} · ${fmtIn(mm)}` : `${fmtIn(mm)} · ${fmtMm(mm)}`; }
// Plain one-line text for the clipboard, e.g. "2.37 in (≈ 2 3/8 in, 60.1 mm)".
function copyLen(mm) {
  const inches = mm / 25.4, dec = inches.toFixed(2), f = fracIn(inches);
  const exact = f !== null && Math.abs(inches * S.frac - Math.round(inches * S.frac)) < 0.02;
  if (S.units === 'mm') return `${mm.toFixed(1)} mm (${exact ? f : dec} in)`;
  if (f === null) return `${dec} in (${mm.toFixed(1)} mm)`;
  return exact ? `${f} in (${mm.toFixed(1)} mm)` : `${dec} in (≈ ${f} in, ${mm.toFixed(1)} mm)`;
}
function fmtPair(w, h) {
  const mmS = `${w.toFixed(1)} × ${h.toFixed(1)} mm`, inS = `${(w / 25.4).toFixed(2)} × ${(h / 25.4).toFixed(2)} in`;
  return S.units === 'mm' ? `${mmS} · ${inS}` : `${inS} · ${mmS}`;
}

function measureInfo() {
  const { a, b } = V.m;
  const dx = b.x - a.x, dy = b.y - a.y;
  let deg = Math.atan2(-dy, dx) * 180 / Math.PI;
  if (deg < 0) deg += 180;
  if (deg >= 180) deg -= 180;
  return { dx, dy, len: Math.hypot(dx, dy), deg };
}

// { text: shown, copy: plain text for clipboard } or null
function reading() {
  const [W, H] = sizeMm();
  if (S.mode === 'ruler' && V.cursor !== null) {
    const g = rulerGeom(W, H, S);
    const v = (g.flip ? g.L - V.cursor : V.cursor) - g.m;
    const s = fmtLen(v);
    return { text: s, copy: copyLen(v) };
  }
  if (S.mode === 'measure' && V.m) {
    const i = measureInfo();
    if (S.measure.shape === 'box') {
      const s = fmtPair(Math.abs(i.dx), Math.abs(i.dy));
      const w = Math.abs(i.dx), h = Math.abs(i.dy);
      const copy = S.units === 'mm' ? `${w.toFixed(1)} × ${h.toFixed(1)} mm (${(w / 25.4).toFixed(2)} × ${(h / 25.4).toFixed(2)} in)`
        : `${(w / 25.4).toFixed(2)} × ${(h / 25.4).toFixed(2)} in (${w.toFixed(1)} × ${h.toFixed(1)} mm)`;
      return { text: s, sub: `diagonal ${fmtLen(i.len)}`, copy };
    }
    const s = fmtLen(i.len);
    return { text: s, sub: `at ${i.deg.toFixed(1)}° from level`, copy: `${copyLen(i.len)} at ${i.deg.toFixed(1)}°` };
  }
  if (S.mode === 'angles' && Math.abs(S.angles.rot) > 0.05) {
    const r = ((S.angles.rot % 360) + 540) % 360 - 180;
    return { text: `Rotated ${r.toFixed(1)}°`, copy: `${r.toFixed(1)}°` };
  }
  if (S.mode === 'grid' && (S.grid.dx || S.grid.dy)) {
    return { text: `Grid moved ${S.grid.dx.toFixed(1)}, ${S.grid.dy.toFixed(1)} mm`, copy: null };
  }
  return null;
}

const hud = $('hud'), hudText = $('hudText'), shapeBtn = $('shapeBtn');
function updateHud() {
  const r = reading();
  const measuring = S.mode === 'measure';
  hud.hidden = !r && !measuring;
  shapeBtn.hidden = !measuring;
  shapeBtn.textContent = S.measure.shape === 'box' ? '▭ Box' : '⟷ Line';
  $('copyBtn').hidden = !r || !r.copy;
  $('shareBtn').hidden = !r || !r.copy || !navigator.share;
  $('clearBtn').hidden = !r;
  if (r) hudText.innerHTML = esc(r.text) + (r.sub ? `<small>${esc(r.sub)}</small>` : '');
  else hudText.innerHTML = 'Drag across what you want to measure';
}
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

$('copyBtn').onclick = async () => {
  const r = reading(); if (!r || !r.copy) return;
  try { await navigator.clipboard.writeText(r.copy); toast(`Copied: ${r.copy}`); }
  catch (e) { fallbackCopy(r.copy); }
};
function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast(`Copied: ${t}`); } catch (e) { toast(t); }
  ta.remove();
}
$('shareBtn').onclick = () => { const r = reading(); if (r && r.copy) navigator.share({ text: r.copy }).catch(() => {}); };
$('clearBtn').onclick = () => resetView();
shapeBtn.onclick = () => { S.measure.shape = S.measure.shape === 'box' ? 'line' : 'box'; save(); render(); };

// ---------------------------------------------------------------- overlay (reading line, measurement)
function drawOverlay(k, W, H, th) {
  const c = ctx, acc = th.accent;
  const T = (x, y, t, align = 'center', base = 'middle', size = 3.4) =>
    drawText(c, { x, y, t, size, align, base, boxed: true, bold: true, color: acc }, k, th.fg, th.bg);
  const snapLine = (x1, y1, x2, y2, w) => drawPattern.lineOnly(c, { x1, y1, x2, y2 }, k, w);
  c.fillStyle = acc; c.strokeStyle = acc;

  if (S.mode === 'ruler' && V.cursor !== null) {
    const g = rulerGeom(W, H, S), p = V.cursor;
    if (g.vertical) snapLine(0, p, W, p, S.w.m); else snapLine(p, 0, p, H, S.w.m);
    const r = reading();
    if (r) { if (g.vertical) T(W / 2, p - 4, r.text.split(' · ')[0]); else T(p, H / 2, r.text.split(' · ')[0]); }
  }

  if (S.mode === 'measure' && V.m) {
    const { a, b } = V.m, i = measureInfo();
    c.lineWidth = S.w.m;
    if (S.measure.shape === 'box') {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      snapLine(x0, y0, x1, y0, S.w.m); snapLine(x0, y1, x1, y1, S.w.m);
      snapLine(x0, y0, x0, y1, S.w.m); snapLine(x1, y0, x1, y1, S.w.m);
      // corner handles
      for (const p of [a, b]) { c.beginPath(); c.arc(p.x * k, p.y * k, 2.5 * k, 0, 7); c.stroke(); }
      T((x0 + x1) / 2, y0 - 3, `${(x1 - x0).toFixed(1)} mm`, 'center', 'middle', 3);
      T(x1 + 2, (y0 + y1) / 2, `${(y1 - y0).toFixed(1)} mm`, 'left', 'middle', 3);
    } else {
      snapLine(a.x, a.y, b.x, b.y, S.w.m);
      // caliper-style bars across each end: line these up with the object's edges
      if (i.len > 0.01) {
        const nx = -(b.y - a.y) / i.len, ny = (b.x - a.x) / i.len;
        for (const p of [a, b]) {
          snapLine(p.x - nx * 6, p.y - ny * 6, p.x + nx * 6, p.y + ny * 6, S.w.m);
          c.beginPath(); c.arc(p.x * k, p.y * k, 2.5 * k, 0, 7); c.lineWidth = S.w.l; c.stroke();
        }
        const mx = (a.x + b.x) / 2 + nx * 6, my = (a.y + b.y) / 2 + ny * 6;
        T(mx, my, reading().text.split(' · ')[0], 'center', 'middle', 3.2);
      }
    }
  }
}
// Straight segment, pixel-snapped when level or plumb.
drawPattern.lineOnly = (c, L, k, w) => {
  if (Math.abs(L.x1 - L.x2) < 1e-9) {
    const x0 = Math.round(L.x1 * k - w / 2), ya = Math.round(Math.min(L.y1, L.y2) * k), yb = Math.round(Math.max(L.y1, L.y2) * k);
    c.fillRect(x0, ya, w, Math.max(1, yb - ya));
  } else if (Math.abs(L.y1 - L.y2) < 1e-9) {
    const y0 = Math.round(L.y1 * k - w / 2), xa = Math.round(Math.min(L.x1, L.x2) * k), xb = Math.round(Math.max(L.x1, L.x2) * k);
    c.fillRect(xa, y0, Math.max(1, xb - xa), w);
  } else {
    c.lineWidth = w; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(L.x1 * k, L.y1 * k); c.lineTo(L.x2 * k, L.y2 * k); c.stroke();
  }
};

// ---------------------------------------------------------------- gestures
// One finger: tap toggles the buttons; double-tap resets; drag does the mode's thing.
// Two fingers: twist rotates the angle fan.
const ptrs = new Map();
let gest = null;
let lastTap = { t: 0, x: 0, y: 0 };
const SLOP = 8; // CSS px a finger may wander before a touch counts as a drag

function toMm(cx, cy) {
  const r = cv.getBoundingClientRect(), k = pxPerMm();
  return { x: (cx - r.left) * (devW / r.width) / k, y: (cy - r.top) * (devH / r.height) / k };
}

cv.addEventListener('pointerdown', e => {
  goFullscreen(false);
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
  if (ptrs.size === 1) gest = { kind: 'pending' };
  else if (ptrs.size === 2) { if (gest && gest.end) gest.end(); gest = startTwo(); }
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (!gest) return;
  if (ptrs.size === 1) {
    if (gest.kind === 'pending' && Math.hypot(p.x - p.x0, p.y - p.y0) > SLOP) gest = startDrag(toMm(p.x0, p.y0)) || { kind: 'none' };
    if (gest.move) { gest.move(toMm(p.x, p.y)); render(); }
  } else if (gest.move2) { gest.move2([...ptrs.values()]); render(); }
});
function endPointer(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  if (gest && gest.kind === 'pending' && ptrs.size === 0 && e.type === 'pointerup') tap(p, e.timeStamp);
  if (ptrs.size === 0) { if (gest && gest.end) gest.end(); gest = null; save(); render(); }
  else if (ptrs.size === 1) { if (gest && gest.end) gest.end(); gest = { kind: 'none' }; } // ignore the finger left behind
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('contextmenu', e => e.preventDefault());

function tap(p, t) {
  if (t - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
    lastTap = { t: 0, x: 0, y: 0 };
    document.body.classList.remove('chrome-hidden');
    resetView(true);
    return;
  }
  lastTap = { t, x: p.x, y: p.y };
  if (closeSheets()) return;
  document.body.classList.toggle('chrome-hidden');
}

function resetView(fromGesture) {
  if (S.mode === 'ruler') V.cursor = null;
  else if (S.mode === 'grid') { S.grid.dx = 0; S.grid.dy = 0; }
  else if (S.mode === 'angles') { S.angles.dx = 0; S.angles.dy = 0; S.angles.rot = 0; }
  else if (S.mode === 'measure') { V.m = null; V.active = null; }
  save(); render();
  if (fromGesture) toast('Reset');
}

function startDrag(p0) {
  const [W, H] = sizeMm();
  if (S.mode === 'ruler') {
    const g = rulerGeom(W, H, S);
    const along = p => Math.max(0, Math.min(g.L, g.vertical ? p.y : p.x));
    V.cursor = along(p0);
    return { move: p => { V.cursor = along(p); } };
  }
  if (S.mode === 'grid') {
    const bx = S.grid.dx, by = S.grid.dy;
    return { move: p => { S.grid.dx = bx + p.x - p0.x; S.grid.dy = by + p.y - p0.y; } };
  }
  if (S.mode === 'angles') {
    const bx = S.angles.dx, by = S.angles.dy;
    return { move: p => { S.angles.dx = bx + p.x - p0.x; S.angles.dy = by + p.y - p0.y; } };
  }
  if (S.mode === 'measure') return startMeasureDrag(p0, W, H);
  return null;
}

function startTwo() {
  if (S.mode !== 'angles') return { kind: 'none' };
  const pts = [...ptrs.values()];
  const ang = ps => Math.atan2(-(ps[1].y - ps[0].y), ps[1].x - ps[0].x) * 180 / Math.PI;
  const a0 = ang(pts), base = S.angles.rot;
  return {
    move2: ps => {
      let r = base + ang(ps) - a0;
      // gentle detent at whole multiples of 15°
      const s = Math.round(r / 15) * 15;
      if (Math.abs(r - s) < 0.8) r = s;
      S.angles.rot = r;
    },
  };
}

// Measuring: grab an end (or the middle) near where the finger lands and move it
// by the finger's motion, so the finger never has to cover the point. Elsewhere,
// start a new measurement.
function startMeasureDrag(p0) {
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  if (V.m) {
    const { a, b } = V.m;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const da = d(p0, a), db = d(p0, b), dm = d(p0, mid);
    const grab = 11; // mm: roughly a fingertip and a bit
    let which = null;
    if (Math.min(da, db) < grab) which = da <= db ? 'a' : 'b';
    else if (dm < grab && d(a, b) > 20) which = 'mid';
    if (which) {
      const base = { a: { ...a }, b: { ...b } };
      if (which !== 'mid') V.active = which;
      return {
        move: p => {
          const ddx = p.x - p0.x, ddy = p.y - p0.y;
          if (which === 'mid') {
            V.m.a = { x: base.a.x + ddx, y: base.a.y + ddy };
            V.m.b = { x: base.b.x + ddx, y: base.b.y + ddy };
          } else {
            const other = which === 'a' ? V.m.b : V.m.a;
            V.m[which] = snapEnd(other, { x: base[which].x + ddx, y: base[which].y + ddy });
          }
        },
      };
    }
  }
  V.m = { a: { ...p0 }, b: { ...p0 } };
  V.active = 'b';
  return { move: p => { V.m.b = snapEnd(V.m.a, p); } };
}
function snapEnd(from, p) {
  if (!S.measure.snap || S.measure.shape === 'box') return p;
  const dx = p.x - from.x, dy = p.y - from.y, len = Math.hypot(dx, dy);
  if (len < 3) return p;
  const ang = Math.atan2(dy, dx) * 180 / Math.PI, s = Math.round(ang / 45) * 45;
  if (Math.abs(ang - s) > 1.5) return p;
  const t = s * Math.PI / 180;
  return { x: from.x + Math.cos(t) * len, y: from.y + Math.sin(t) * len };
}

// Arrow keys nudge the active measuring end by one device pixel (Shift: ten).
document.addEventListener('keydown', e => {
  if (S.mode !== 'measure' || !V.m || !V.active || e.target.closest('input,select')) return;
  const step = (e.shiftKey ? 10 : 1) / pxPerMm();
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  V.m[V.active] = { x: V.m[V.active].x + d[0], y: V.m[V.active].y + d[1] };
  render();
});

// ---------------------------------------------------------------- toast
const toastEl = $('toast');
let toastTimer;
function toast(msg, ms = 2600, warn = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('warn', warn);
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { toastEl.textContent = ''; }, ms);
}

// ---------------------------------------------------------------- sheets & settings
const sheets = ['panel', 'devices', 'printDlg'].map($);
function closeSheets() { let any = false; for (const s of sheets) if (!s.hidden) { s.hidden = true; any = true; } return any; }
function openSheet(id) { closeSheets(); $(id).hidden = false; document.body.classList.remove('chrome-hidden'); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { $(b.dataset.close).hidden = true; });

$('openPanel').onclick = () => { if (!$('panel').hidden) { closeSheets(); return; } openSheet('panel'); syncPanel(); };
document.querySelectorAll('.bar button[data-mode]').forEach(b => b.onclick = () => {
  S.mode = b.dataset.mode; save(); closeSheets(); syncPanel(); render();
  const tips = {
    ruler: 'Drag to slide a reading line', grid: 'Drag to slide the grid onto an edge',
    angles: 'Drag to move the vertex · twist two fingers to rotate', measure: 'Drag across what you want to measure',
  };
  toast(tips[S.mode]);
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

for (const [name, sp, unit, major, mid] of GRID_PRESETS) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => { Object.assign(S.grid, { spacing: sp, unit, major, mid }); save(); syncPanel(); render(); };
  $('gridPresets').appendChild(b);
}

function syncPanel() {
  document.querySelectorAll('.bar button[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('fieldset[data-for]').forEach(f => { f.hidden = f.dataset.for !== S.mode; });
  document.querySelectorAll('[data-k]').forEach(el => {
    const v = getK(el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  });
  syncHints();
}

function syncHints() {
  const k = pxPerMm(), f = n => (n / k).toFixed(3);
  $('weightHint').textContent = `On this screen: light ${f(S.w.l)} mm, medium ${f(S.w.m)} mm, heavy ${f(S.w.h)} mm wide.`;
  const sc = S.scale, pxUm = 1000 / k;
  const pixelNote = `One screen pixel is ${pxUm.toFixed(0)} µm, so straight lines sit within ±${(pxUm / 2).toFixed(0)} µm of their true position.`;
  let t;
  if (!sc) t = 'Screen size unknown. Choose your phone, or calibrate with a card. Until then sizes are only the browser\'s guess, often 10–40% off.';
  else if (sc.source === 'device') {
    const ratio = renderRatio(sc.nativeShort);
    t = `Using published specs for ${sc.label}: ${(k * 25.4).toFixed(1)} pixels per inch` +
      (Math.abs(ratio - 1) > 0.001 ? ` (the phone is drawing at ${Math.round(ratio * 100)}% of full resolution; allowed for)` : '') +
      `. Spec rounding allows about ±${(sc.unc * 100).toFixed(2)}%, i.e. ±${(sc.unc * 100).toFixed(2)} mm over 100 mm. ${pixelNote}`;
  } else {
    t = `Using ${sc.label}: ${(k * 25.4).toFixed(1)} pixels per inch. ${pixelNote}`;
  }
  $('scaleInfo').textContent = t;
}

// ---------------------------------------------------------------- device picker
function devLabelRight(d) {
  return `${Math.round(d.ppi || (d.r[0] / devShortMm(d) * 25.4))} ppi · ±${(devUnc(d) * 100).toFixed(2)}%`;
}
function devButton(d) {
  const b = document.createElement('button');
  b.className = 'dev' + (S.scale && S.scale.id === devId(d) ? ' sel' : '');
  b.innerHTML = `<span>${esc(devId(d))}</span><small>${esc(devLabelRight(d))}</small>`;
  b.onclick = () => { useDevice(d); closeSheets(); };
  return b;
}
function renderDeviceList() {
  const q = $('devSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = d => { const hay = `${d.b} ${d.n} ${d.s || ''} ${(d.ua || []).join(' ')}`.toLowerCase(); return q.every(w => hay.includes(w)); };
  const box = $('devMatches'); box.innerHTML = '';
  const c = candidates();
  if (!q.length && c.list.length) {
    const h = document.createElement('h3');
    h.textContent = c.how === 'model' ? `This phone (${detectedModel})` : 'Phones with this screen resolution';
    box.appendChild(h);
    c.list.forEach(d => box.appendChild(devButton(d)));
  }
  const list = $('devList'); list.innerHTML = '';
  let brand = null;
  for (const d of DEVS.filter(hit)) {
    if (d.b !== brand) { brand = d.b; const h = document.createElement('h3'); h.textContent = brand; list.appendChild(h); }
    list.appendChild(devButton(d));
  }
  if (!list.children.length) list.innerHTML = '<p class="hint">No match. You can calibrate with a card instead.</p>';
}
$('devSearch').oninput = renderDeviceList;
$('pickDevice').onclick = () => { openSheet('devices'); renderDeviceList(); };
$('devCal').onclick = () => { closeSheets(); openCal(); };

// ---------------------------------------------------------------- full screen, wake lock, install
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => { wakeLock = null; }; } } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
function goFullscreen(force) {
  keepAwake();
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  if (!force && (!S.autoFull || standalone())) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
$('fullscreen').onclick = () => { closeSheets(); goFullscreen(true); };

let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('install').hidden = false; });
$('install').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('install').hidden = true; };

// ---------------------------------------------------------------- calibration
const cal = $('cal');
const calCv = $('calCanvas');
const calCtx = calCv.getContext('2d');
const calRef = $('calRef');
let calW = 0, calH = 0, calLenPx = 0;
const CAL_START_MM_GUESS = 6;

function calRefMm() {
  const v = calRef.value;
  if (v === 'ruler') return (parseFloat($('rulerLen').value) || 0) * MM_PER[$('rulerUnit').value];
  if (v === 'ppi') return 25.4;
  return parseFloat(v);
}
const calStart = () => Math.round(CAL_START_MM_GUESS * guessPxPerMm());
const calVertical = () => calH >= calW;

function calSyncUI() {
  const v = calRef.value;
  $('rulerLenRow').hidden = v !== 'ruler';
  $('ppiRow').hidden = v !== 'ppi';
  $('nudge').hidden = v === 'ppi';
  const dir = calVertical() ? 'top' : 'left', far = calVertical() ? 'bottom' : 'right';
  const pre = S.scale ? 'The lines are already placed from the current setting, so if they match your object there is nothing to change. ' : '';
  let help;
  if (v === 'ppi') help = 'Enter the pixel density from the maker\'s spec sheet.';
  else if (v === 'ruler') help = `${pre}Lay a ruler on the screen with its 0 mark on the ${dir} line. Drag anywhere (or use the buttons) until the ${far} line sits exactly on your chosen mark. Longer lengths are more accurate.`;
  else help = `${pre}Hold the object flat on the screen with one edge on the ${dir} line. Drag anywhere (or use the buttons) until the ${far} line just touches the opposite edge. Look straight down.`;
  $('calHelp').textContent = help;
  $('calPx').textContent = `${calLenPx} px · ${(calLenPx / calRefMm() * 25.4).toFixed(1)} ppi`;
}

function calRender() {
  if (!calW) return;
  const c = calCtx, vert = calVertical(), s = calStart(), e = s + calLenPx, g = guessPxPerMm();
  c.fillStyle = '#fff'; c.fillRect(0, 0, calW, calH);
  c.fillStyle = '#dbeafe';
  if (vert) c.fillRect(0, s, calW, calLenPx); else c.fillRect(s, 0, calLenPx, calH);
  const line = (p, col) => { c.fillStyle = col; if (vert) c.fillRect(0, p, calW, 1); else c.fillRect(p, 0, 1, calH); };
  line(s, '#000'); line(e - 1, '#c00');
  // short thick tabs outside the band mark where the thin lines are
  const tab = Math.round(1.5 * g), tl = Math.round(12 * g);
  c.fillStyle = '#c00';
  if (vert) c.fillRect(calW - tl, e, tl, tab); else c.fillRect(e, calH - tl, tab, tl);
  c.fillStyle = '#000';
  if (vert) c.fillRect(calW - tl, s - tab, tl, tab); else c.fillRect(s - tab, calH - tl, tab, tl);
  c.font = `${Math.round(4 * g)}px system-ui`; c.fillStyle = '#c00'; c.textBaseline = 'bottom';
  if (vert) c.fillText('▲ end', 8, e - 4); else c.fillText('◀ end', e + 4, calH / 3);
  c.fillStyle = '#000'; c.textBaseline = 'top';
  if (vert) c.fillText('▼ start', 8, s + 4); else c.fillText('start ▶', 4, calH / 4);
}

new ResizeObserver(([e]) => { [calW, calH] = sizeCanvas(calCv, e); cal.classList.toggle('wide', !calVertical()); calSyncUI(); calRender(); })
  .observe(calCv, { box: 'device-pixel-content-box' });

function openCal() {
  closeSheets(); cal.hidden = false;
  $('calDetails').open = true;
  calLenPx = Math.round(calRefMm() * pxPerMm());
  if (S.scale) $('ppiVal').value = (pxPerMm() * 25.4).toFixed(1);
  calSyncUI(); calRender();
}
$('calibrate').onclick = openCal;
$('calCancel').onclick = () => { cal.hidden = true; };
const calReset = () => { calLenPx = Math.round(calRefMm() * pxPerMm()); calSyncUI(); calRender(); };
calRef.onchange = calReset;
$('rulerLen').oninput = calReset;
$('rulerUnit').onchange = calReset;
document.querySelectorAll('#nudge button').forEach(b => b.onclick = () => {
  calLenPx = Math.max(20, calLenPx + +b.dataset.d); calSyncUI(); calRender();
});

let calDrag = null;
calCv.addEventListener('pointerdown', e => {
  calDrag = { p: calVertical() ? e.clientY : e.clientX, len: calLenPx };
  calCv.setPointerCapture(e.pointerId);
  $('calDetails').open = false;
});
calCv.addEventListener('pointermove', e => {
  if (!calDrag) return;
  const d = ((calVertical() ? e.clientY : e.clientX) - calDrag.p) * dpr();
  calLenPx = Math.max(20, Math.round(calDrag.len + d / 4)); // quarter speed for fine control
  calSyncUI(); calRender();
});
calCv.addEventListener('pointerup', () => { calDrag = null; });
calCv.addEventListener('pointercancel', () => { calDrag = null; });

$('calSave').onclick = () => {
  let pxmm, label, unc;
  if (calRef.value === 'ppi') {
    const ppi = parseFloat($('ppiVal').value);
    if (!(ppi > 50)) return;
    pxmm = ppi / 25.4; label = `${ppi} ppi (entered)`; unc = 0.5 / ppi;
  } else {
    const mm = calRefMm();
    if (!(mm > 5)) return;
    pxmm = calLenPx / mm; unc = 1 / calLenPx;
    label = `your calibration (${calRef.options[calRef.selectedIndex].text.split('(')[0].trim().toLowerCase()})`;
  }
  S.scale = { source: 'calibration', pxPerMm: pxmm, refShortPx: screenShortPx(), label, unc, date: new Date().toISOString().slice(0, 10) };
  save(); cal.hidden = true; render(); syncPanel();
  toast(`Saved: ${(pxmm * 25.4).toFixed(1)} pixels per inch`);
};

// ---------------------------------------------------------------- print / SVG
const PAPER = { letter: [215.9, 279.4], a4: [210, 297], legal: [215.9, 355.6], tabloid: [279.4, 431.8], a3: [297, 420] };
$('print').onclick = () => {
  if (S.mode === 'measure') { toast('Switch to Ruler, Grid or Angles to print that pattern'); return; }
  openSheet('printDlg');
};

function buildSvg() {
  let [W, H] = PAPER[$('paper').value];
  if ($('orient').value === 'l') [W, H] = [H, W];
  const pw = { l: +$('pw_l').value || 0.1, m: +$('pw_m').value || 0.2, h: +$('pw_h').value || 0.4 };
  // printers can't reach the paper edge; keep everything 6 mm in
  const inset = 6, IW = W - 2 * inset, IH = H - 2 * inset;
  const opts = { ...S, margin: Math.max(S.margin, 2), grid: { ...S.grid, dx: 0, dy: 0 }, angles: { ...S.angles, dx: 0, dy: 0 } };
  const P = buildPattern(S.mode, IW, IH - 14, opts);
  const r = n => +n.toFixed(4);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  out.push(`<defs><clipPath id="clip"><rect x="0" y="0" width="${r(IW)}" height="${r(IH - 14)}"/></clipPath></defs>`);
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
  out.push(`<g stroke="#000" stroke-width="0.2"><line x1="0" y1="${r(by)}" x2="100" y2="${r(by)}"/>`);
  for (let i = 0; i <= 10; i++) out.push(`<line x1="${i * 10}" y1="${r(by - (i % 5 ? 2 : 4))}" x2="${i * 10}" y2="${r(by)}"/>`);
  out.push(`</g><text x="102" y="${r(by)}" font-size="3" font-family="sans-serif" dominant-baseline="central">← this bar should measure exactly 100 mm (3.937 in)</text></g></svg>`);
  return { svg: out.join('\n'), W, H };
}

$('doSvg').onclick = () => {
  const { svg } = buildSvg();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `true-size-${S.mode}.svg`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('doPrint').onclick = () => {
  const { svg, W, H } = buildSvg();
  let st = $('pageSize');
  if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${W}mm ${H}mm; margin: 0; }`;
  $('printArea').innerHTML = svg;
  window.print();
};

// ---------------------------------------------------------------- boot
syncPanel();
(async () => {
  detectedModel = await detectModel();
  if (S.scale) { followFoldScreen(); return; }
  const c = candidates();
  const pick = c.how === 'model' ? (c.list.length === 1 || confidentPick(c.list) ? confidentPick(c.list) || c.list[0] : null) : confidentPick(c.list);
  if (pick) {
    useDevice(pick, true);
    const same = c.list.length > 1 ? ' (same screen as ' + c.list.filter(d => d !== pick).map(d => d.n).slice(0, 3).join(', ') + ')' : '';
    toast(`Sized for ${devId(pick)}${same}. Not your phone? Settings → Choose phone.`, 6000);
  } else {
    openSheet('devices'); renderDeviceList();
  }
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// test hook
window.__pr = { S, V, buildPattern, pxPerMm, render, dev: () => [devW, devH], candidates, DEVS, reading, setModel: m => { detectedModel = m; } };
