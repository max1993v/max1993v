import { FONT } from './config.js';

// Deterministic PRNG (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (...n) => {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v | 0), 16777619);
  return h >>> 0;
};

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const prog = (t, start, dur) => clamp((t - start) / dur);
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeInCubic = (x) => x * x * x;
export const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOutBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
export const easeOutElastic = (x) =>
  x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
export const smooth = (x) => x * x * (3 - 2 * x);

export const font = (weight, size) => `${weight} ${size}px ${FONT}`;

// Text with manual tracking (letterSpacing is not available everywhere).
export function trackedWidth(ctx, text, tracking) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}
export function fillTracked(ctx, text, x, y, tracking, align = 'left') {
  const w = trackedWidth(ctx, text, tracking);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prev;
  return w;
}

// Largest font size (<= max) at which every line fits the given width.
export function fitSize(ctx, lines, weight, maxSize, maxWidth, tracking = 0) {
  let size = maxSize;
  for (const line of lines) {
    ctx.font = font(weight, 100);
    const w = trackedWidth(ctx, line, tracking * 100) / 100;
    size = Math.min(size, maxWidth / w);
  }
  return Math.floor(size);
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Soft studio contact shadow.
export function softShadow(ctx, x, y, rx, ry, alpha = 0.35) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(140, 92, 108, ${alpha})`);
  g.addColorStop(0.55, `rgba(150, 100, 116, ${alpha * 0.45})`);
  g.addColorStop(1, 'rgba(160, 110, 125, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Cache Path2D objects built from SVG path strings.
const pathCache = new Map();
export function path2d(d) {
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
}
