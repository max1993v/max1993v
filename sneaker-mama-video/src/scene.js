// Frame renderer: render(ctx, t) draws the frame at time t (seconds).
// Pure function of t — every random value comes from a fixed seed.
import { W, H, FPS, DURATION, CUTS, WIPE, C } from './config.js';
import {
  rng, hash, clamp, lerp, prog, easeOutCubic, easeInOutCubic, easeOutBack, smooth,
  font, fillTracked, trackedWidth, fitSize, roundRect, softShadow, path2d,
} from './util.js';
import { LOGO_FIGURE, WORDMARK_GLYPHS } from './logo-paths.js';
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
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
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

// Rotating circular text.
function textRing(ctx, cx, cy, radius, angle, alpha, size = 24) {
  if (alpha <= 0) return;
  const base = 'SNEAKER MAMA • SHOE CARE • ';
  ctx.save();
  ctx.font = font(700, size);
  const circ = Math.PI * 2 * radius;
  const unit = trackedWidth(ctx, base, size * 0.18) + size * 0.18;
  const reps = Math.max(1, Math.round(circ / unit));
  const text = base.repeat(reps);
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const gap = (circ - total) / chars.length;
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = C.ink2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  let a = 0;
  chars.forEach((ch, i) => {
    const w = widths[i];
    const mid = a + (w / 2) / radius;
    ctx.save();
    ctx.rotate(mid);
    ctx.translate(0, -radius);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += (w + gap) / radius;
  });
  ctx.restore();
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

function counterValue(t) {
  return clamp(sceneAt(t), 0, 4);
}
function drawUI(ctx, t, mono) {
  const a = smooth(prog(t, 0.15, 0.5));
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  drawWordmark(ctx, MARGIN, 160, 200, mono || C.ink);

  // counter with a digit roll on each cut
  ctx.font = font(800, 40);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  const right = W - MARGIN;
  const by = 204;
  ctx.fillStyle = mono || C.ink2;
  ctx.fillText('/04', right, by);
  const sw = ctx.measureText('/04').width;
  const dx = right - sw - 4;
  let roll = 0, from = counterValue(t), to = from;
  for (const c of CUTS.slice(0, 4)) {
    if (t > c - 0.15 && t < c + 0.3) {
      roll = easeOutCubic(prog(t, c - 0.15, 0.45));
      from = counterValue(c - 0.01);
      to = counterValue(c + 0.01);
    }
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx - 70, by - 44, 74, 56);
  ctx.clip();
  ctx.fillStyle = mono || C.accentText;
  const pad = (n) => String(n).padStart(2, '0');
  if (roll > 0 && roll < 1) {
    ctx.fillText(pad(from), dx, by - roll * 52);
    ctx.fillText(pad(to), dx, by + (1 - roll) * 52);
  } else ctx.fillText(pad(to), dx, by);
  ctx.restore();

  // progress bar
  const y = H - 206;
  roundRect(ctx, MARGIN, y, W - MARGIN * 2, 5, 2.5);
  ctx.fillStyle = mono ? 'rgba(255,255,255,0.35)' : 'rgba(26, 20, 22, 0.12)';
  ctx.fill();
  roundRect(ctx, MARGIN, y, Math.max(5, (W - MARGIN * 2) * clamp(t / DURATION)), 5, 2.5);
  ctx.fillStyle = mono || C.accent;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- shared product text

function productText(ctx, u, num, titleLines, subLines) {
  revealOutlineLine(ctx, num, MARGIN - 8, 440, 230, 0.05, u, C.accentText);
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

  drawWordmark(ctx, 90, 740, 900, [C.ink, C.accentText], { start: 0.2, t });
  ctx.font = font(600, 36);
  revealLine(ctx, 'ДОГЛЯД ЗА ВЗУТТЯМ', W / 2, 1080, 36, 1.2, t, { weight: 600, color: C.ink2, align: 'center', tracking: 15 });

  const ring = easeOutCubic(prog(t, 1.0, 0.8));
  const cy = 1405;
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.scale(0.85 + 0.15 * ring, 0.85 + 0.15 * ring);
  ctx.translate(-W / 2, -cy);
  textRing(ctx, W / 2, cy, 140, t * 0.45, ring, 22);
  ctx.globalAlpha = ring;
  drawFigure(ctx, W / 2, cy, 140 * easeOutBack(prog(t, 1.15, 0.7)) + 0.001, C.accent);
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- 01 foam

function drawCan(ctx, x, yb) {
  const bw = 200, bh = 470, top = yb - bh;
  softShadow(ctx, x, yb + 6, 160, 24, 0.42);
  ctx.save();
  // actuator + spout
  const ag = ctx.createLinearGradient(x - 48, 0, x + 48, 0);
  ag.addColorStop(0, '#141012');
  ag.addColorStop(0.35, '#4A3F44');
  ag.addColorStop(1, '#151113');
  ctx.fillStyle = ag;
  roundRect(ctx, x + 40, top - 82, 62, 18, 6);
  ctx.fill();
  roundRect(ctx, x - 48, top - 96, 96, 60, 14);
  ctx.fill();
  // shoulder
  ctx.beginPath();
  ctx.moveTo(x - bw / 2, top + 10);
  ctx.bezierCurveTo(x - bw / 2, top - 30, x - 60, top - 42, x - 50, top - 40);
  ctx.lineTo(x + 50, top - 40);
  ctx.bezierCurveTo(x + 60, top - 42, x + bw / 2, top - 30, x + bw / 2, top + 10);
  ctx.closePath();
  ctx.fillStyle = '#2A2326';
  ctx.fill();
  // body
  roundRect(ctx, x - bw / 2, top, bw, bh, 16);
  ctx.fillStyle = '#272023';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = C.accent;
  ctx.fillRect(x - bw / 2, top + 250, bw, 64);
  ctx.globalAlpha = 0.92;
  drawFigure(ctx, x, top + 140, 120, '#FFFFFF');
  ctx.globalAlpha = 1;
  drawWordmark(ctx, x - 55, top + 362, 110, '#FFFFFF');
  ctx.restore();
  // cylinder shading over everything
  const sg = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0.55)');
  sg.addColorStop(0.2, 'rgba(255,255,255,0.10)');
  sg.addColorStop(0.3, 'rgba(255,255,255,0.16)');
  sg.addColorStop(0.45, 'rgba(0,0,0,0)');
  sg.addColorStop(0.85, 'rgba(0,0,0,0.3)');
  sg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = sg;
  roundRect(ctx, x - bw / 2, top - 40, bw, bh + 40, 16);
  ctx.fill();
  ctx.restore();
}

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
  const cx = 300, yb = 1500 + (1 - rise) * 900;

  // foam shadow grows with the cloud
  const landed = FOAM.bubbles.filter((b) => u > b.emit + b.flight * 0.6).length / FOAM.bubbles.length;
  softShadow(ctx, 730, 1506, 280, 26, 0.25 * landed);
  drawCan(ctx, cx, yb);

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

function solePath() {
  const p = new Path2D();
  p.moveTo(60, 150);
  p.bezierCurveTo(60, 70, 120, 40, 200, 45);
  p.bezierCurveTo(300, 52, 360, 86, 440, 84);
  p.bezierCurveTo(560, 70, 660, 22, 740, 60);
  p.bezierCurveTo(805, 95, 805, 210, 740, 245);
  p.bezierCurveTo(660, 285, 560, 240, 440, 228);
  p.bezierCurveTo(360, 222, 300, 255, 200, 258);
  p.bezierCurveTo(120, 262, 60, 230, 60, 150);
  p.closePath();
  return p;
}
const SOLE = solePath();
const SOLE_X = 140, SOLE_Y = 1055;

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

function drawSole(ctx, alpha, dy, clean) {
  softShadow(ctx, 540, 1335 + dy, 400, 34, 0.38 * alpha);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(SOLE_X, SOLE_Y + dy);
  const g = ctx.createLinearGradient(0, 40, 0, 260);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(1, '#F2ECEE');
  ctx.fillStyle = g;
  ctx.fill(SOLE);
  ctx.save();
  ctx.clip(SOLE);
  // tread: zig-zag grooves across the sole + heel pods
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.16)';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  for (let x = 250; x < 800; x += 26) {
    ctx.beginPath();
    for (let y = 30; y <= 280; y += 18) {
      const xx = x + ((y / 18) % 2 ? 7 : -7);
      y === 30 ? ctx.moveTo(xx, y) : ctx.lineTo(xx, y);
    }
    ctx.stroke();
  }
  for (const [px, py, pr] of [[150, 150, 52], [150, 150, 30], [150, 150, 10]]) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 20;
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.07)';
  ctx.stroke(SOLE);
  ctx.restore();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.4)';
  ctx.stroke(SOLE);
  ctx.restore();

  // dirt (global coords)
  ctx.save();
  ctx.translate(0, dy);
  ctx.globalAlpha = alpha;
  BRUSH.spots.forEach((sp, i) => {
    const a = sp.a * (1 - clean[i]);
    if (a <= 0.01) return;
    ctx.globalAlpha = alpha * a;
    ctx.fillStyle = C.dirt[sp.c];
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

function bristles(ctx, x, y, w, len, color, dark, seed, sway = 0) {
  const R = rng(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < w / 3.2; i++) {
    const bx = x + (i / (w / 3.2)) * w + (R() - 0.5) * 2;
    const l = len * (0.8 + R() * 0.3);
    ctx.strokeStyle = R() < 0.3 ? dark : color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(bx + sway * l * (0.6 + R() * 0.4) + (R() - 0.5) * 3, y + l);
    ctx.stroke();
  }
}

function drawBrush(ctx, x, y, angle, vx) {
  softShadow(ctx, x + 10, y + 48, 190, 34, 0.32);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const bw = 300, bh = 104;
  // bristle skirt, bending against the motion
  const sway = clamp(-vx / 3000, -0.5, 0.5);
  bristles(ctx, -bw / 2 + 8, bh / 2 - 6, bw - 16, 34, '#EAD5A9', '#CBAE7A', 11, sway);
  const g = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
  g.addColorStop(0, '#3A3135');
  g.addColorStop(0.5, '#231D20');
  g.addColorStop(1, '#141012');
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // engraved wood-tone logo, as on the real brush
  drawFigure(ctx, -92, 0, 62, '#C99A5B');
  drawWordmark(ctx, -50, -18, 140, '#C99A5B');
  ctx.restore();
}

function drawSmallBrush(ctx, x, y, angle) {
  softShadow(ctx, x, y + 52, 120, 20, 0.3);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  bristles(ctx, -82, 16, 164, 40, C.accent, '#A81E52', 23, 0.05);
  const g = ctx.createLinearGradient(0, -24, 0, 24);
  g.addColorStop(0, '#3A3135');
  g.addColorStop(1, '#151113');
  roundRect(ctx, -95, -26, 190, 48, 12);
  ctx.fillStyle = g;
  ctx.fill();
  drawFigure(ctx, -60, -2, 30, '#C99A5B');
  ctx.restore();
}

function sceneBrush(ctx, u) {
  productText(ctx, u, '02', ['ЩІТКИ'], ['М’яка — для верху.', 'Жорстка — для підошви.']);
  const st = brushState(u);
  ctx.save();
  ctx.translate(0, -40);
  const appear = easeOutCubic(prog(u, 0.05, 0.6));
  drawSole(ctx, appear, (1 - appear) * 120, st.clean);

  // dust with gravity
  for (const d of st.dust) {
    const a = u - d.t0;
    if (a < 0 || a > 0.85) continue;
    ctx.globalAlpha = (1 - a / 0.85) * 0.9;
    ctx.fillStyle = C.dirt[d.c];
    ctx.beginPath();
    ctx.arc(d.x + d.vx * a, d.y + d.vy * a + 0.5 * 1900 * a * a, d.size * (1 - a * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // small crimson brush from the side
  const sb = prog(u, 2.1, 0.75);
  if (sb > 0) {
    const k = easeOutBack(sb, 1.6);
    drawSmallBrush(ctx, 875 + (1 - k) * 420, 1458, lerp(-1.1, -0.32, k));
  }

  if (u > BRUSH.start - 0.05) {
    const vx = BRUSH.vx(u);
    drawBrush(ctx, BRUSH.x(u), BRUSH.y(u) - 70, vx * 0.000035, vx);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 03 antibacterial spray

function drawBottle(ctx, x, yb, press) {
  softShadow(ctx, x, yb + 6, 140, 22, 0.4);
  const bw = 180, bh = 390, top = yb - bh;
  ctx.save();
  // actuator (graphite), pressed down
  const py = press * 14;
  const ag = ctx.createLinearGradient(x - 34, 0, x + 34, 0);
  ag.addColorStop(0, '#151113');
  ag.addColorStop(0.4, '#4A3F44');
  ag.addColorStop(1, '#151113');
  ctx.fillStyle = ag;
  roundRect(ctx, x + 22, top - 112 + py, 70, 16, 5);
  ctx.fill();
  roundRect(ctx, x - 32, top - 124 + py, 64, 56, 10);
  ctx.fill();
  // collar
  roundRect(ctx, x - 44, top - 76, 88, 44, 8);
  ctx.fill();
  // body with shoulders
  ctx.beginPath();
  ctx.moveTo(x - 36, top - 34);
  ctx.lineTo(x + 36, top - 34);
  ctx.bezierCurveTo(x + 40, top, x + bw / 2, top - 4, x + bw / 2, top + 40);
  ctx.lineTo(x + bw / 2, yb - 16);
  ctx.quadraticCurveTo(x + bw / 2, yb, x + bw / 2 - 16, yb);
  ctx.lineTo(x - bw / 2 + 16, yb);
  ctx.quadraticCurveTo(x - bw / 2, yb, x - bw / 2, yb - 16);
  ctx.lineTo(x - bw / 2, top + 40);
  ctx.bezierCurveTo(x - bw / 2, top - 4, x - 40, top, x - 36, top - 34);
  ctx.closePath();
  const bg = ctx.createLinearGradient(x - bw / 2, 0, x + bw / 2, 0);
  bg.addColorStop(0, '#D9D1D4');
  bg.addColorStop(0.22, '#FFFFFF');
  bg.addColorStop(0.36, '#FFFFFF');
  bg.addColorStop(0.8, '#EDE7E9');
  bg.addColorStop(1, '#CFC6CA');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // label
  drawWordmark(ctx, x - 52, top + 70, 104, C.ink);
  drawFigure(ctx, x, top + 220, 120, '#EE9CBD');
  ctx.fillStyle = C.ink;
  ctx.fillRect(x - 40, top + 320, 80, 5);
  ctx.fillRect(x - 28, top + 333, 56, 5);
  ctx.restore();
}

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
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 9 * (1 - rk) + 1;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r * (1 + 1.6 * easeOutCubic(rk)), 0, Math.PI * 2);
    ctx.stroke();
    const R = rng(g.seed + 7);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + R();
      const d = g.r * (1 + 2.2 * easeOutCubic(rk));
      ctx.fillStyle = k % 2 ? C.accent : C.germ;
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
  drawBottle(ctx, 260, 1500 + (1 - enter) * 900, pressAmount(u));

  SPRAY.germs.forEach((g, i) => drawGerm(ctx, g, u, i));

  // mist from each press
  const { nozzle, v0, k } = SPRAY;
  SPRAY.presses.forEach((p0, pi) => {
    const dir = SPRAY.dirs[pi];
    const R = rng(500 + pi);
    for (let q = 0; q < 8; q++) {
      const delay = R() * 0.1, frac = 0.25 + R() * 0.6, spread = (R() - 0.5) * 0.3;
      const tau = u - p0 - delay;
      if (tau < 0 || tau > 1.1) continue;
      const d = (v0 / k) * (1 - Math.exp(-k * tau)) * frac;
      const x = nozzle.x + Math.cos(dir + spread) * d, y = nozzle.y + Math.sin(dir + spread) * d;
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
    for (let q = 0; q < 110; q++) {
      const delay = R() * 0.08, ang = dir + (R() + R() + R() - 1.5) * 0.28, sp = v0 * (0.55 + R() * 0.5), size = 2 + R() * 4.5;
      const tau = u - p0 - delay;
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
  });
}

// ---------------------------------------------------------------- 04 water repellent

const SNEAKER = (() => {
  const upper = new Path2D(
    'M30 222 C14 170 18 120 40 90 C52 72 70 64 92 66 C130 70 160 92 200 96 C222 70 238 40 262 28 ' +
    'C280 20 300 24 306 38 C340 80 420 120 500 150 C560 170 610 182 632 206 C646 222 644 238 630 244 L40 244 Z');
  const sole = new Path2D(
    'M18 236 C14 254 22 272 44 278 L600 278 C632 278 652 262 654 240 C654 232 648 228 638 230 L30 230 C22 230 18 232 18 236 Z');
  const stripe = new Path2D('M40 182 C200 190 380 200 566 194 L604 214 C400 222 200 216 34 206 Z');
  const heelTab = new Path2D('M30 96 C40 78 60 70 80 70 L70 150 C50 150 32 140 26 128 Z');
  const collar = new Path2D('M92 66 C130 70 160 92 200 96 C160 104 118 92 92 78 Z');
  return { upper, sole, stripe, heelTab, collar, w: 660, h: 280 };
})();

function drawSneaker(ctx, x, y, alpha) {
  softShadow(ctx, x + SNEAKER.w / 2, y + 282, 360, 30, 0.42 * alpha);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  const ug = ctx.createLinearGradient(0, 20, 0, 244);
  ug.addColorStop(0, '#FFFFFF');
  ug.addColorStop(1, '#F0E9EC');
  ctx.fillStyle = ug;
  ctx.fill(SNEAKER.upper);
  ctx.fillStyle = C.accent;
  ctx.fill(SNEAKER.stripe);
  ctx.fill(SNEAKER.heelTab);
  ctx.fillStyle = '#2A2326';
  ctx.fill(SNEAKER.collar);
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.45)';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke(SNEAKER.upper);
  // toe cap, stitching
  ctx.beginPath();
  ctx.moveTo(470, 244);
  ctx.bezierCurveTo(492, 196, 560, 172, 628, 204);
  ctx.stroke();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(48, 172);
  ctx.bezierCurveTo(200, 180, 380, 190, 548, 184);
  ctx.stroke();
  ctx.setLineDash([]);
  // laces & eyelets
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const ex = lerp(300, 470, k), ey = lerp(48, 138, k) + Math.sin(k * Math.PI) * 6;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - 26, ey + 14);
    ctx.lineTo(ex + 8, ey - 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(110, 90, 96, 0.5)';
    ctx.beginPath();
    ctx.arc(ex - 30, ey + 18, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // sole
  ctx.fillStyle = '#FFFFFF';
  ctx.fill(SNEAKER.sole);
  ctx.save();
  ctx.clip(SNEAKER.sole);
  ctx.fillStyle = 'rgba(110, 90, 96, 0.16)';
  ctx.fillRect(0, 266, 700, 20);
  ctx.restore();
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.45)';
  ctx.lineWidth = 2.5;
  ctx.stroke(SNEAKER.sole);
  ctx.beginPath();
  ctx.moveTo(40, 252);
  ctx.lineTo(630, 252);
  ctx.strokeStyle = 'rgba(110, 90, 96, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

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
  ctx.shadowColor = 'rgba(214, 51, 108, 0.75)';
  ctx.shadowBlur = 28;
  ctx.strokeStyle = 'rgba(214, 51, 108, 0.85)';
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
  drawSneaker(ctx, 210, 1160 + (1 - a) * 80, a);
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
      ctx.strokeStyle = C.accent;
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
}

// ---------------------------------------------------------------- outro

function sceneOutro(ctx, u) {
  const rows = [['01', 'Піна'], ['02', 'Щітки'], ['03', 'Антибактеріальний спрей'], ['04', 'Водовідштовхувальний спрей']];
  rows.forEach(([n, label], i) => {
    const y = 330 + i * 78;
    const st = 0.2 + i * STAGGER;
    revealLine(ctx, n, MARGIN, y, 40, st, u, { weight: 800, color: C.accentText });
    revealLine(ctx, label, MARGIN + 82, y, 40, st, u, { weight: 600, color: C.ink });
    const lp = easeOutCubic(prog(u, st + 0.1, 0.7));
    if (lp > 0) {
      ctx.fillStyle = 'rgba(26, 20, 22, 0.75)';
      ctx.fillRect(MARGIN, y + 26, (W - MARGIN * 2) * lp, 1.5);
    }
  });

  const cy = 890;
  const lp = prog(u, 0.7, 0.7);
  const ring = easeOutCubic(prog(u, 0.85, 0.8));
  textRing(ctx, W / 2, cy, 212, (u + 19) * 0.45, ring, 24);
  if (lp > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(lp * 2.5);
    const k = easeOutBack(lp, 1.8);
    drawFigure(ctx, W / 2, cy + 4 * Math.sin(u * 3), 300 * (0.6 + 0.4 * k), C.accent);
    ctx.restore();
  }
  drawWordmark(ctx, W / 2 - 220, 1140, 440, C.ink, { start: 1.0, t: u, stagger: 0.04 });
  revealLine(ctx, 'Чисте взуття. Впевнений крок.', W / 2, 1345, 44, 1.25, u, { weight: 600, color: C.ink, align: 'center' });

  const bp = prog(u, OUTRO.buttonIn, 0.5);
  if (bp > 0) {
    const k = easeOutBack(bp, 2.2);
    const pulse = 1 + 0.03 * Math.max(0, Math.sin(Math.PI * 2 * (u - OUTRO.buttonIn - 0.5)));
    ctx.save();
    ctx.font = font(800, 44);
    const label = 'sneakermama.com.ua';
    const bw = ctx.measureText(label).width + 110, bh = 100;
    ctx.translate(W / 2, 1455);
    ctx.scale(k * pulse, k * pulse);
    ctx.globalAlpha = clamp(bp * 3);
    ctx.shadowColor = 'rgba(214, 51, 108, 0.35)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = C.accent;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = C.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 3);
    ctx.restore();
  }
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
    // persistent UI turns white where the crimson band passes under it
    ctx.save();
    bandPath(ctx, e.trail, e.lead);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clip();
    drawUI(ctx, t, C.cream);
    ctx.restore();
  }
  drawGrain(ctx, t);
  ctx.restore();
}

// Text/background pairs used on screen, for the contrast check.
export const CONTRAST_PAIRS = [
  ['основний текст / фон', C.ink, C.bg],
  ['другорядний текст / фон', C.ink2, C.bg],
  ['малинові цифри, MAMA / фон', C.accentText, C.bg],
  ['білий текст / малинова кнопка, вайп', C.cream, C.accent],
  ['теги: графіт / білий', C.ink, C.cream],
];
