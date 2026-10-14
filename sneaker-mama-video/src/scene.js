// Frame renderer: render(ctx, t) draws the frame at time t (seconds).
// Pure function of t — every random value comes from a fixed seed.
import { W, H, FPS, DURATION, CUTS, WIPE, C } from './config.js';
import {
  rng, hash, clamp, lerp, prog, easeOutCubic, easeInOutCubic, easeOutBack, smooth,
  font, fillTracked, trackedWidth, fitSize, roundRect, softShadow, path2d,
} from './util.js';
import { LOGO_FIGURE, WORDMARK_GLYPHS } from './logo-paths.js';
import { IMG } from './assets.js';
import { FOAM, BRUSH, brushState, SPRAY, WATER, OUTRO, T_FOAM, T_BRUSH, T_GERM, T_WATER, T_OUTRO } from './timeline.js';

const STAGGER = 0.08;
const REVEAL = 0.7;
const MARGIN = 80;

// ---------------------------------------------------------------- helpers

function sceneAt(t) {
  let i = 0;
  while (i < CUTS.length && t >= CUTS[i]) i++;
  return i; // 0 intro, 1..4 products, 5 outro
}

// Line of text sliding up out of a mask (easeOutCubic).
function revealLine(ctx, text, x, y, size, start, t, opts = {}) {
  const p = easeOutCubic(prog(t, start, opts.dur ?? REVEAL));
  if (p <= 0) return;
  const { weight = 800, color = C.ink, align = 'left', tracking = 0 } = opts;
  ctx.save();
  ctx.font = font(weight, size);
  const w = trackedWidth(ctx, text, tracking);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.beginPath();
  ctx.rect(x0 - 20, y - size * 1.08, w + 40, size * 1.4);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  fillTracked(ctx, text, x0, y + (1 - p) * size * 1.35, tracking, 'left');
  ctx.restore();
}

function revealOutlineLine(ctx, text, x, y, size, start, t, color) {
  const p = easeOutCubic(prog(t, start, REVEAL + 0.1));
  if (p <= 0) return;
  ctx.save();
  ctx.font = font(900, size);
  const w = ctx.measureText(text).width;
  ctx.beginPath();
  ctx.rect(x - 20, y - size * 0.85, w + 40, size * 0.95);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + (1 - p) * size);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y + (1 - p) * size);
  ctx.restore();
}

// Brand wordmark from traced glyphs. `reveal` = {start, t, stagger} or null.
function drawWordmark(ctx, x, y, width, colors, reveal = null) {
  const s = width / 1000;
  WORDMARK_GLYPHS.forEach((g, i) => {
    let off = 0;
    if (reveal) {
      const p = easeOutCubic(prog(reveal.t, reveal.start + i * (reveal.stagger ?? STAGGER), REVEAL));
      if (p <= 0) return;
      off = (1 - p) * g.h * 1.25;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (reveal) {
      ctx.beginPath();
      ctx.rect(g.x - 6, g.y - 6, g.w + 12, g.h + 10);
      ctx.clip();
    }
    ctx.translate(0, off);
    ctx.fillStyle = Array.isArray(colors) ? colors[i < 7 ? 0 : 1] : colors;
    ctx.fill(path2d(g.d), 'evenodd');
    ctx.restore();
  });
}

function drawFigure(ctx, cx, cy, height, color) {
  const s = height / LOGO_FIGURE.h;
  ctx.save();
  ctx.translate(cx - (LOGO_FIGURE.w * s) / 2, cy - height / 2);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.fill(path2d(LOGO_FIGURE.d), 'evenodd');
  ctx.restore();
}

// Product photo standing on the floor at (cx, yb), with a soft studio shadow.
function drawPhoto(ctx, img, cx, yb, height, alpha = 1, shadow = 0.42) {
  const w = (img.width * height) / img.height;
  if (shadow) softShadow(ctx, cx, yb + 4, w * 0.8, 20, shadow * alpha);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cx - w / 2, yb - height, w, height);
  ctx.restore();
  return w;
}

// Fine spray: soft puffs + micro-droplets fanning out of a nozzle.
function drawMist(ctx, u, t0, nozzle, dir, seed, { v0 = 1800, k = 1.6, drops = 110, spread = 0.28 } = {}) {
  const R = rng(seed);
  for (let q = 0; q < 8; q++) {
    const delay = R() * 0.1, frac = 0.25 + R() * 0.6, sp = (R() - 0.5) * 0.3;
    const tau = u - t0 - delay;
    if (tau < 0 || tau > 1.1) continue;
    const d = (v0 / k) * (1 - Math.exp(-k * tau)) * frac;
    const x = nozzle.x + Math.cos(dir + sp) * d, y = nozzle.y + Math.sin(dir + sp) * d;
    const rad = 25 + 110 * easeOutCubic(tau / 1.1);
    const a = 0.5 * (1 - tau / 1.1);
    const gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, `rgba(255,255,255,${a})`);
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let q = 0; q < drops; q++) {
    const delay = R() * 0.08, ang = dir + (R() + R() + R() - 1.5) * spread, sp = v0 * (0.55 + R() * 0.5), size = 2 + R() * 4.5;
    const tau = u - t0 - delay;
    if (tau < 0 || tau > 1.3) continue;
    const d = (sp / k) * (1 - Math.exp(-k * tau));
    const x = nozzle.x + Math.cos(ang) * d, y = nozzle.y + Math.sin(ang) * d + 60 * tau * tau;
    const a = Math.pow(1 - tau / 1.3, 1.4);
    const rr = size * (1 + tau * 0.6);
    ctx.fillStyle = `rgba(150, 100, 118, ${0.35 * a})`;
    ctx.beginPath();
    ctx.arc(x + 0.8, y + 1.4, rr + 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- background / grain

function drawBackground(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, 900, 0, W / 2, 900, 1050);
  g.addColorStop(0, 'rgba(252, 238, 241, 1)');
  g.addColorStop(0.5, 'rgba(252, 238, 241, 0.55)');
  g.addColorStop(1, 'rgba(252, 238, 241, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W / 2, H / 2, 700, W / 2, H / 2, 1250);
  g.addColorStop(0, 'rgba(206, 150, 166, 0)');
  g.addColorStop(1, 'rgba(206, 150, 166, 0.14)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

let grainTiles = null;
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function drawGrain(ctx, t) {
  if (!grainTiles) {
    grainTiles = [];
    for (let k = 0; k < 6; k++) {
      const c = makeCanvas(256, 256);
      const g = c.getContext('2d');
      const img = g.createImageData(256, 256);
      const r = rng(9000 + k);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = r() < 0.5 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.floor(r() * 18); // ~3.5% average opacity
      }
      g.putImageData(img, 0, 0);
      grainTiles.push(c);
    }
  }
  const f = Math.round(t * FPS);
  const tile = grainTiles[f % grainTiles.length];
  const h = hash(f, 77);
  ctx.save();
  ctx.translate(-(h % 256), -((h >>> 8) % 256));
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
}

// ---------------------------------------------------------------- wipe

const WIPE_ANGLE = (-25 * Math.PI) / 180;
const WIPE_D = (W / 2) * Math.cos(WIPE_ANGLE) + (H / 2) * Math.abs(Math.sin(WIPE_ANGLE)) + 60;

function wipeEdges(t) {
  for (const c of CUTS) {
    if (t >= c - WIPE / 2 && t <= c + WIPE / 2) {
      const p = easeInOutCubic(prog(t, c - WIPE / 2, WIPE));
      return { lead: lerp(-WIPE_D, WIPE_D, clamp(p * 2)), trail: lerp(-WIPE_D, WIPE_D, clamp(p * 2 - 1)) };
    }
  }
  return null;
}
function bandPath(ctx, a, b) {
  ctx.translate(W / 2, H / 2);
  ctx.rotate(WIPE_ANGLE);
  ctx.beginPath();
  ctx.rect(a, -1500, b - a, 3000);
}
function drawWipe(ctx, t) {
  const e = wipeEdges(t);
  if (!e) return null;
  ctx.save();
  bandPath(ctx, e.trail, e.lead);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(e.lead + 14, -1500, 7, 3000);
  ctx.fillRect(e.trail - 21, -1500, 7, 3000);
  ctx.restore();
  return e;
}

// ---------------------------------------------------------------- persistent UI

function drawUI(ctx, t, mono) {
  const a = smooth(prog(t, 0.15, 0.5)) * (1 - smooth(prog(t, CUTS[4], 0.3)));
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  drawWordmark(ctx, MARGIN, 160, 200, mono || C.ink);

  ctx.restore();
}

// ---------------------------------------------------------------- shared product text

function productText(ctx, u, num, titleLines, subLines) {
  revealOutlineLine(ctx, num, MARGIN - 8, 440, 230, 0.05, u, C.accent);
  const size = fitSize(ctx, titleLines, 900, 118, W - MARGIN * 2);
  let y = 482 + size * 0.92;
  titleLines.forEach((line, i) => {
    revealLine(ctx, line, MARGIN, y, size, 0.18 + i * STAGGER, u, { weight: 900, color: C.ink });
    if (i < titleLines.length - 1) y += size * 1.0;
  });
  y += 72;
  subLines.forEach((line, i) => {
    revealLine(ctx, line, MARGIN, y + i * 54, 40, 0.18 + (titleLines.length + i) * STAGGER, u, { weight: 500, color: C.ink2 });
  });
}

// ---------------------------------------------------------------- 00 intro

function sceneIntro(ctx, t) {
  const zoom = 1 + 0.035 * smooth(prog(t, 0, 3));
  ctx.save();
  ctx.translate(W / 2, 960);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -960);

  drawWordmark(ctx, 90, 790, 900, C.ink, { start: 0.2, t });
  ctx.font = font(600, 36);
  revealLine(ctx, 'ДОГЛЯД ЗА ВЗУТТЯМ', W / 2, 1130, 36, 1.2, t, { weight: 600, color: C.ink2, align: 'center', tracking: 15 });

  ctx.restore();
}

// ---------------------------------------------------------------- 01 foam

function drawBubble(ctx, x, y, r) {
  if (r < 0.5) return;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.75, '#FFFDFE');
  g.addColorStop(1, '#F6E9EE');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 118, 132, 0.45)';
  ctx.lineWidth = r < 16 ? 1.5 : 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(214, 51, 108, 0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, 0.3, 1.6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.12, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(190, 150, 165, 0.35)';
  ctx.beginPath();
  ctx.arc(x - r * 0.12, y - r * 0.62, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function sceneFoam(ctx, u) {
  productText(ctx, u, '01', ['ПІНА ДЛЯ', 'ОЧИЩЕННЯ'], ['Видаляє бруд і плями.', 'Не промочує матеріал.']);
  const rise = easeOutBack(prog(u, 0.15, 0.8), 1.4);
  const yb = 1500 + (1 - rise) * 900;

  // foam shadow grows with the cloud
  const landed = FOAM.bubbles.filter((b) => u > b.emit + b.flight * 0.6).length / FOAM.bubbles.length;
  softShadow(ctx, 730, 1506, 280, 26, 0.25 * landed);
  drawPhoto(ctx, IMG.foam, 300, yb, 600);

  const sway = 0.03 * Math.sin(u * 1.5);
  ctx.save();
  ctx.translate(700, 1180);
  ctx.rotate(sway * smooth(prog(u, 1.2, 1)));
  ctx.translate(-700, -1180);
  const n = FOAM.nozzle;
  const live = [];
  for (const b of FOAM.bubbles) {
    if (u < b.emit) continue;
    const f = clamp((u - b.emit) / b.flight);
    const e = easeOutCubic(f);
    let x = lerp(n.x, b.x, e);
    let y = lerp(n.y, b.y, e) - b.arc * Math.sin(Math.PI * f) * (1 - f * 0.5);
    const settle = smooth(prog(u, b.emit + b.flight, 0.6));
    x += 6 * Math.sin(1.7 * u + b.phase) * settle;
    y += 4 * Math.sin(2.1 * u + b.phase * 1.3) * settle;
    const r = b.r * (0.2 + 0.8 * easeOutBack(f, 2.2)) * (1 + 0.03 * Math.sin(3 * u + b.phase));
    live.push({ x, y, r, f });
  }
  // soft white foam mass first, then individual bubbles on top
  ctx.save();
  ctx.shadowColor = 'rgba(150, 100, 116, 0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  for (const b of live) {
    if (b.f < 1) continue;
    ctx.moveTo(b.x + b.r * 0.92, b.y);
    ctx.arc(b.x, b.y, b.r * 0.92, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
  for (const b of live) drawBubble(ctx, b.x, b.y, b.r);
  ctx.restore();

  // tags
  const tags = ['замша', 'шкіра', 'текстиль'];
  ctx.font = font(600, 34);
  const pads = 30, gap = 22, hgt = 66;
  const widths = tags.map((s) => ctx.measureText(s).width + pads * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (tags.length - 1);
  let x = W / 2 - total / 2;
  tags.forEach((s, i) => {
    const p = prog(u, 1.7 + i * STAGGER, 0.55);
    if (p > 0) {
      const k = easeOutBack(p, 2);
      ctx.save();
      ctx.globalAlpha = clamp(p * 3);
      ctx.translate(x + widths[i] / 2, 1595 + (1 - k) * 40);
      ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
      ctx.shadowColor = 'rgba(140, 92, 108, 0.18)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      roundRect(ctx, -widths[i] / 2, -hgt / 2, widths[i], hgt, hgt / 2);
      ctx.fillStyle = C.cream;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, 0, 2);
      ctx.restore();
    }
    x += widths[i] + gap;
  });
}

// ---------------------------------------------------------------- 02 brushes

function blob(ctx, x, y, r, seed, wob = 0) {
  const R = rng(seed);
  const n = 14;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.72 + R() * 0.5) + wob * Math.sin(a * 3 + seed);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]);
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
  }
  const p0 = pts[0], p1 = pts[1];
  ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
  ctx.closePath();
}

// Photo with mud spots on it; spots fade as the brush cleans them.
function drawDirty(ctx, img, ph, clean, dx, alpha) {
  const { x, y, w, h } = ph.rect;
  softShadow(ctx, x + w / 2 + dx, y + h - 6, w * 0.5, 30, 0.38 * alpha);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x + dx, y, w, h);
  ctx.translate(dx, 0);
  ph.spots.forEach((sp, i) => {
    const a = sp.a * (1 - clean[i]);
    if (a <= 0.01) return;
    ctx.globalAlpha = alpha * a;
    ctx.fillStyle = ph.dirt[sp.c];
    blob(ctx, sp.x, sp.y, sp.r * (0.85 + 0.15 * (1 - clean[i])), sp.seed);
    ctx.fill();
    const R = rng(sp.seed + 1);
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.arc(sp.x + (R() - 0.5) * sp.r * 3, sp.y + (R() - 0.5) * sp.r * 2, 2 + R() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

function drawDust(ctx, ph, dust, u) {
  for (const d of dust) {
    const a = u - d.t0;
    if (a < 0 || a > 0.85) continue;
    ctx.globalAlpha = (1 - a / 0.85) * 0.9;
    ctx.fillStyle = ph.dirt[d.c];
    ctx.beginPath();
    ctx.arc(d.x + d.vx * a, d.y + d.vy * a + 0.5 * 1900 * a * a, d.size * (1 - a * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Brush photo turned on its side, bristles down, tilting with the stroke.
function drawBrush(ctx, img, len, x, y, angle) {
  const thick = (img.width * len) / img.height;
  softShadow(ctx, x, y + thick / 2 + 26, len * 0.55, 26, 0.3);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2 + angle);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -thick / 2, -len / 2, thick, len);
  ctx.restore();
}

function scrubPass(ctx, u, ph, photo, brushImg, brushLen, dx, alpha) {
  const st = brushState(ph, u);
  drawDirty(ctx, photo, ph, st.clean, dx, alpha);
  drawDust(ctx, ph, st.dust, u);
  if (u > ph.start - 0.05 && u < ph.end) {
    const vx = ph.vx(u);
    drawBrush(ctx, brushImg, brushLen, ph.x(u), ph.y(u) - 70, vx * 0.00004);
  }
}

function sceneBrush(ctx, u) {
  productText(ctx, u, '02', ['ЩІТКИ'], ['М’яка — для верху.', 'Жорстка — для підошви.']);
  ctx.save();
  ctx.translate(0, -40);
  // 1) beige bristles clean the sneaker upper
  const appear = easeOutCubic(prog(u, 0.05, 0.5));
  const out = easeInOutCubic(prog(u, BRUSH.swap - 0.1, 0.4));
  if (out < 1) scrubPass(ctx, u, BRUSH.upper, IMG.sneaker, IMG.brush, 360, (1 - appear) * 300 - out * 1150, appear);
  // 2) white bristles scrub the outsole
  const inn = easeOutCubic(prog(u, BRUSH.swap, 0.45));
  if (inn > 0) scrubPass(ctx, u, BRUSH.sole, IMG.sole, IMG.brushWhite, 330, (1 - inn) * 1150, 1);
  ctx.restore();
}

// ---------------------------------------------------------------- 03 antibacterial spray

function pressAmount(u) {
  let p = 0;
  for (const t0 of SPRAY.presses) {
    const d = u - t0 + 0.06;
    if (d >= 0 && d < 0.06) p = Math.max(p, d / 0.06);
    else if (d >= 0.06 && d < 0.2) p = Math.max(p, 1 - (d - 0.06) / 0.14);
  }
  return smooth(p);
}

function drawGerm(ctx, g, u, i) {
  const enter = easeOutBack(prog(u, 0.35 + i * 0.06, 0.5), 2);
  if (enter <= 0) return;
  const pt = u - g.pop;
  if (pt > 0.45) return;
  let sx = 1, sy = 1, alpha = 1;
  if (pt >= 0) {
    if (pt < 0.07) { const k = pt / 0.07; sx = 1 + 0.25 * k; sy = 1 - 0.18 * k; }
    else { const k = clamp((pt - 0.07) / 0.16); sx = 1.25 * (1 - easeOutCubic(k)); sy = 0.82 * (1 - easeOutCubic(k)); alpha = 1 - k; }
    // expanding crimson ring
    const rk = clamp(pt / 0.42);
    ctx.save();
    ctx.globalAlpha = 1 - rk;
    ctx.strokeStyle = C.accentDeep;
    ctx.lineWidth = 9 * (1 - rk) + 1;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r * (1 + 1.6 * easeOutCubic(rk)), 0, Math.PI * 2);
    ctx.stroke();
    const R = rng(g.seed + 7);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + R();
      const d = g.r * (1 + 2.2 * easeOutCubic(rk));
      ctx.fillStyle = k % 2 ? C.accentDeep : C.germ;
      ctx.beginPath();
      ctx.arc(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d, 5 * (1 - rk), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (alpha <= 0.01) return;
  }
  const bob = 7 * Math.sin(2.2 * u + g.phase);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(g.x, g.y + bob);
  ctx.rotate(0.25 * Math.sin(1.3 * u + g.phase));
  ctx.scale(sx * enter, sy * enter);
  softShadow(ctx, 0, g.r * 1.15, g.r * 0.9, g.r * 0.18, 0.18);
  // spikes
  ctx.strokeStyle = C.germDark;
  ctx.fillStyle = C.germDark;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let k = 0; k < g.spikes; k++) {
    const a = (k / g.spikes) * Math.PI * 2 + 0.15 * Math.sin(3 * u + k);
    const r0 = g.r * 0.85, r1 = g.r + 16;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r1, Math.sin(a) * r1, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  blob(ctx, 0, 0, g.r, g.seed, 2.5 * Math.sin(4 * u + g.phase));
  const bg = ctx.createRadialGradient(-g.r * 0.3, -g.r * 0.35, 2, 0, 0, g.r * 1.2);
  bg.addColorStop(0, '#A9B957');
  bg.addColorStop(0.6, C.germ);
  bg.addColorStop(1, '#66722A');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.germDark;
  ctx.stroke();
  const R = rng(g.seed + 3);
  ctx.fillStyle = 'rgba(205, 220, 130, 0.55)';
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.arc((R() - 0.5) * g.r, (R() - 0.5) * g.r, 3 + R() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function sceneGerm(ctx, u) {
  productText(ctx, u, '03', ['АНТИБАКТЕРІАЛЬНИЙ', 'СПРЕЙ'], ['Нейтралізує бактерії', 'та неприємний запах.']);
  const enter = easeOutBack(prog(u, 0.1, 0.75), 1.3);
  const press = pressAmount(u);
  ctx.save();
  ctx.translate(250, 1500);
  ctx.scale(1 + press * 0.015, 1 - press * 0.02);
  ctx.translate(-250, -1500);
  drawPhoto(ctx, IMG.sprayAntibac, 250, 1500 + (1 - enter) * 900, 620);
  ctx.restore();

  SPRAY.germs.forEach((g, i) => drawGerm(ctx, g, u, i));
  SPRAY.presses.forEach((p0, pi) => drawMist(ctx, u, p0, SPRAY.nozzle, SPRAY.dirs[pi], 500 + pi, { v0: SPRAY.v0, k: SPRAY.k }));
}

// ---------------------------------------------------------------- 04 water repellent

function domeHalf(ctx, d, p) {
  ctx.beginPath();
  const steps = 90;
  for (let i = 0; i <= steps * p; i++) {
    const th = Math.PI - (i / steps) * Math.PI;
    const x = d.cx + d.rx * Math.cos(th), y = d.cy - d.ry * Math.sin(th);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
}

function drawDome(ctx, u) {
  const d = WATER.dome;
  const p = easeInOutCubic(prog(u, 0.6, 0.8));
  if (p <= 0) return;
  const fill = smooth(prog(u, 0.9, 0.7));
  ctx.save();
  if (fill > 0) {
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, Math.PI, 0);
    ctx.closePath();
    const g = ctx.createRadialGradient(d.cx, d.cy - 120, 50, d.cx, d.cy, d.ry * 1.05);
    g.addColorStop(0, `rgba(255,255,255,${0.12 * fill})`);
    g.addColorStop(0.8, `rgba(255,255,255,${0.32 * fill})`);
    g.addColorStop(1, `rgba(255,240,245,${0.55 * fill})`);
    ctx.fillStyle = g;
    ctx.fill();
    // honeycomb
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * fill})`;
    ctx.lineWidth = 1.5;
    const s = 36, hw = s * Math.sqrt(3);
    for (let row = 0; row * s * 1.5 < d.ry + 40; row++) {
      const yy = d.cy - row * s * 1.5;
      for (let col = -8; col <= 8; col++) {
        const xx = d.cx + col * hw + (row % 2 ? hw / 2 : 0);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const px = xx + Math.cos(a) * s, py = yy + Math.sin(a) * s;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // glowing crimson rim, drawn progressively
  domeHalf(ctx, d, p);
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(229, 138, 176, 0.9)';
  ctx.shadowBlur = 28;
  ctx.strokeStyle = 'rgba(229, 138, 176, 0.95)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawDrop(ctx, x, y, s, stretch, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s * stretch);
  ctx.bezierCurveTo(s * 0.5, -s * 0.9, s, -s * 0.3, s, s * 0.15);
  ctx.arc(0, s * 0.15, s, 0, Math.PI);
  ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.5, -s * 0.9, 0, -s * stretch);
  const g = ctx.createLinearGradient(-s, -s, s, s);
  g.addColorStop(0, '#6DB7E6');
  g.addColorStop(1, '#2C82BD');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(-s * 0.35, -s * 0.05, s * 0.18, s * 0.32, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function sceneWater(ctx, u) {
  productText(ctx, u, '04', ['ВОДОВІДШТОВХУВАЛЬНИЙ', 'СПРЕЙ'], ['Вода скочується.', 'Взуття — сухе.']);
  const a = easeOutCubic(prog(u, 0.05, 0.6));
  const sh = (IMG.sneaker.height * WATER.shoe.w) / IMG.sneaker.width;
  drawPhoto(ctx, IMG.sneaker, WATER.shoe.cx, WATER.dome.cy + (1 - a) * 80, sh, a, 0.4);
  drawDome(ctx, u);

  const { g, dome } = WATER;
  for (const dr of WATER.drops) {
    if (u < dr.s) continue;
    if (u < dr.hit) {
      const tau = u - dr.s;
      const vy = dr.vy0 + g * tau;
      drawDrop(ctx, dr.x, dr.y0 + dr.vy0 * tau + 0.5 * g * tau * tau, dr.size, 1.9 + vy / 1400, clamp(tau / 0.08));
      continue;
    }
    const t2 = u - dr.hit;
    // ripple on the shield
    if (t2 < 0.35) {
      const k = t2 / 0.35;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = C.accentDeep;
      ctx.lineWidth = 3 * (1 - k) + 0.5;
      const nx = (dr.x - dome.cx) / dome.rx;
      ctx.beginPath();
      ctx.ellipse(dr.x, dr.yHit, 10 + 40 * k, 4 + 12 * k, Math.atan(nx * 1.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (t2 < 0.55) {
      const bx = dr.x + dr.bounce.x * t2, by = dr.yHit + dr.bounce.y * t2 + 0.5 * g * t2 * t2;
      ctx.save();
      ctx.globalAlpha = 1 - t2 / 0.55;
      ctx.fillStyle = C.water;
      ctx.beginPath();
      ctx.arc(bx, by, dr.size * 0.7 * (1 - t2 * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (t2 < 0.45) {
      ctx.fillStyle = C.water;
      for (const s of dr.splash) {
        ctx.globalAlpha = 1 - t2 / 0.45;
        ctx.beginPath();
        ctx.arc(dr.x + s.vx * t2, dr.yHit + s.vy * t2 + 0.5 * g * t2 * t2, s.size * (1 - t2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  const ce = easeOutBack(prog(u, 0.1, 0.7), 1.3);
  drawPhoto(ctx, IMG.sprayWater, WATER.can.x, 1500 + (1 - ce) * 900, 600);
  drawMist(ctx, u, WATER.can.spray, WATER.can.nozzle, WATER.can.dir, 640, { v0: 1500, k: 1.9, drops: 90, spread: 0.22 });
}

// ---------------------------------------------------------------- outro

function sceneOutro(ctx, u) {
  const g = ctx.createRadialGradient(W / 2, 900, 0, W / 2, 900, 1200);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(1, '#FBF1F4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const p = prog(u, OUTRO.logoIn, 0.7);
  if (p > 0) {
    const k = easeOutBack(p, 1.8);
    ctx.save();
    ctx.globalAlpha = clamp(p * 2.5);
    const breathe = 1 + 0.012 * Math.sin((u - OUTRO.logoIn) * 2.2);
    ctx.translate(W / 2, 1180);
    ctx.scale((0.6 + 0.4 * k) * breathe, (0.6 + 0.4 * k) * breathe);
    ctx.translate(-W / 2, -1180);
    drawFigure(ctx, W / 2, 860, 640, C.accent);
    ctx.restore();
  }
  drawWordmark(ctx, W / 2 - 230, 1250, 460, C.ink, { start: OUTRO.logoIn + 0.35, t: u, stagger: 0.04 });
}

// ---------------------------------------------------------------- main

const SCENES = [
  (ctx, t) => sceneIntro(ctx, t),
  (ctx, t) => sceneFoam(ctx, t - T_FOAM),
  (ctx, t) => sceneBrush(ctx, t - T_BRUSH),
  (ctx, t) => sceneGerm(ctx, t - T_GERM),
  (ctx, t) => sceneWater(ctx, t - T_WATER),
  (ctx, t) => sceneOutro(ctx, t - T_OUTRO),
];

export function render(ctx, t) {
  t = clamp(t, 0, DURATION - 1e-6);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  drawBackground(ctx);
  ctx.save();
  SCENES[sceneAt(t)](ctx, t);
  ctx.restore();
  const e = drawWipe(ctx, t);
  drawUI(ctx, t, null);
  if (e) {
    // persistent UI stays graphite over the pink band (progress bar included)
    ctx.save();
    bandPath(ctx, e.trail, e.lead);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clip();
    drawUI(ctx, t, C.ink);
    ctx.restore();
  }
  drawGrain(ctx, t);
  ctx.restore();
}

// Text/background pairs used on screen, for the contrast check.
export const CONTRAST_PAIRS = [
  ['графітовий текст / рожевий фон', C.ink, C.bg],
  ['другорядний текст / фон', C.ink2, C.bg],
  ['графітовий UI / рожевий вайп', C.ink, C.accent],
  ['теги, лого: графіт / білий', C.ink, C.cream],
];
