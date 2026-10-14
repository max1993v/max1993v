// Deterministic event timeline shared by the renderer and the soundtrack,
// so every sound lands exactly on the frame that causes it.
import { rng, clamp, smooth, prog } from './util.js';

export const T_INTRO = 0;
export const T_FOAM = 3;
export const T_BRUSH = 7;
export const T_GERM = 11;
export const T_WATER = 15;
export const T_OUTRO = 19;

// ---------- 01 foam ----------
export const FOAM = (() => {
  const nozzle = { x: 305, y: 892 }; // top of the foam bottle photo
  const r = rng(101);
  const lobes = [
    { x: 680, y: 1150, rx: 160, ry: 90 },
    { x: 560, y: 1100, rx: 90, ry: 70 },
    { x: 770, y: 1085, rx: 120, ry: 80 },
    { x: 850, y: 1175, rx: 90, ry: 65 },
    { x: 670, y: 1045, rx: 95, ry: 60 },
  ];
  const N = 68;
  const targets = [];
  for (let i = 0; i < N; i++) {
    const l = lobes[Math.floor(r() * lobes.length)];
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const small = i % 3 === 2;
    targets.push({
      x: l.x + Math.cos(a) * l.rx * d,
      y: l.y + Math.sin(a) * l.ry * d,
      r: small ? 10 + r() * 10 : (32 + r() * 32) * (1 - d * 0.3),
      phase: r() * Math.PI * 2,
      hl: r(),
    });
  }
  // fill from the bottom of the cloud upward
  targets.sort((a, b) => b.y - a.y);
  const bubbles = targets.map((tg, i) => ({
    ...tg,
    emit: 1.05 + i * 0.028 + r() * 0.01, // local time (s)
    arc: 30 + r() * 60,
    flight: 0.48 + r() * 0.12,
  }));
  return { nozzle, bubbles };
})();

// ---------- 02 brushes ----------
export const BRUSH = (() => {
  const amp = (u) => 290 * smooth(prog(u, 0.55, 0.5)) * (1 - smooth(prog(u, 3.2, 0.45)));
  // slides in from the right, scrubs left-right (one stroke per beat), exits right
  const x = (u) =>
    540 + amp(u) * Math.sin(2 * Math.PI * (u - 1)) + 760 * (1 - easeOut(prog(u, 0.3, 0.7))) + 760 * smooth(prog(u, 3.4, 0.5));
  const y = (u) => 1238 + 38 * Math.sin(Math.PI * (u - 1));
  // brush is touching the sole only while it is over it
  const contact = (u) => clamp(1 - (Math.abs(x(u) - 540) - 420) / 120);
  const vx = (u) => (x(u + 0.001) - x(u - 0.001)) / 0.002;
  const r = rng(202);
  const spots = [];
  // outsole photo placement and mud spots (fractions of the photo)
  const sole = { x: 100, y: 1060, w: 880, h: (880 * 534) / 1400 };
  const anchors = [
    [0.12, 0.55], [0.24, 0.42], [0.3, 0.68], [0.44, 0.52], [0.55, 0.64],
    [0.63, 0.4], [0.72, 0.62], [0.83, 0.46], [0.9, 0.62],
  ];
  for (const [fx, fy] of anchors) {
    spots.push({ x: sole.x + fx * sole.w + (r() - 0.5) * 20, y: sole.y + fy * sole.h + (r() - 0.5) * 14, r: 20 + r() * 20, seed: Math.floor(r() * 1e6), c: Math.floor(r() * 3), a: 0.8 + r() * 0.15 });
  }
  return { x, y, vx, amp, contact, sole, spots, start: 0.3, end: 3.9, step: 1 / 120 };
})();
function easeOut(v) { return 1 - Math.pow(1 - v, 3); }

// Exposure of each dirt spot to the brush up to local time u, plus dust spawns.
export function brushState(u) {
  const { spots, x, y, vx, amp, start, step } = BRUSH;
  const exp = new Float32Array(spots.length);
  const dust = [];
  const need = 0.45;
  let j = 0;
  for (let s = start; s <= u; s += step, j++) {
    const bx = x(s), by = y(s);
    const scrub = amp(s) / 290; // only the scrubbing strokes clean, not the slide-in
    if (scrub < 0.2) continue;
    for (let k = 0; k < spots.length; k++) {
      const sp = spots[k];
      if (exp[k] >= need) continue;
      if (Math.abs(bx - sp.x) < 150 && Math.abs(by - sp.y) < 120) {
        exp[k] += step * scrub;
        if ((j + k) % 2 === 0) {
          const r = rng(j * 31 + k * 977 + 5);
          for (let q = 0; q < 2; q++) {
            dust.push({
              t0: s,
              x: sp.x + (r() - 0.5) * sp.r * 1.6,
              y: sp.y + (r() - 0.5) * sp.r,
              vx: vx(s) * 0.25 + (r() - 0.5) * 380,
              vy: -260 - r() * 520,
              size: 2.5 + r() * 5,
              c: sp.c,
            });
          }
        }
      }
    }
  }
  return { clean: Array.from(exp, (e) => clamp(e / need)), dust };
}

// ---------- 03 antibacterial spray ----------
export const SPRAY = (() => {
  const nozzle = { x: 286, y: 903 }; // sprayer head of the bottle photo
  const presses = [1.0, 1.5, 2.0];
  const v0 = 1800, k = 1.6;
  const germs = [
    { x: 600, y: 1170, r: 44 }, { x: 720, y: 950, r: 40 }, { x: 760, y: 1300, r: 48 },
    { x: 885, y: 1095, r: 46 }, { x: 935, y: 880, r: 36 }, { x: 950, y: 1360, r: 38 },
    { x: 650, y: 1430, r: 34 },
  ];
  const order = germs
    .map((g, i) => ({ i, d: Math.hypot(g.x - nozzle.x, g.y - nozzle.y) }))
    .sort((a, b) => a.d - b.d);
  const groups = [[], [], []];
  order.forEach((o, n) => groups[n < 2 ? 0 : n < 4 ? 1 : 2].push(o.i));
  const reach = (d) => -Math.log(1 - (d * k) / v0) / k;
  const r = rng(303);
  germs.forEach((g, i) => {
    const p = groups.findIndex((gr) => gr.includes(i));
    g.press = p;
    g.pop = presses[p] + reach(Math.hypot(g.x - nozzle.x, g.y - nozzle.y));
    g.phase = r() * Math.PI * 2;
    g.spikes = 9 + Math.floor(r() * 5);
    g.seed = Math.floor(r() * 1e6);
  });
  const dirs = groups.map((gr) => {
    const a = gr.map((i) => Math.atan2(germs[i].y - nozzle.y, germs[i].x - nozzle.x));
    return a.reduce((s, v) => s + v, 0) / a.length;
  });
  return { nozzle, presses, v0, k, germs, dirs };
})();

// ---------- 04 water repellent ----------
export const WATER = (() => {
  const dome = { cx: 615, cy: 1445, rx: 385, ry: 440 };
  const g = 2200;
  const r = rng(404);
  const drops = [];
  for (let i = 0; i < 40; i++) {
    const s = 1.45 + i * 0.05 + r() * 0.03;
    const x = dome.cx + (r() * 2 - 1) * dome.rx * 0.8;
    const y0 = 700 + r() * 100;
    const vy0 = 300 + r() * 120;
    const nx = (x - dome.cx) / dome.rx;
    const yHit = dome.cy - dome.ry * Math.sqrt(1 - nx * nx);
    const dy = yHit - y0;
    const tau = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * g * dy)) / g;
    const vyHit = vy0 + g * tau;
    // outward surface normal of the ellipse
    let n = { x: (x - dome.cx) / (dome.rx * dome.rx), y: (yHit - dome.cy) / (dome.ry * dome.ry) };
    const nl = Math.hypot(n.x, n.y);
    n = { x: n.x / nl, y: n.y / nl };
    const vn = vyHit * n.y; // v = (0, vyHit)
    const vt = { x: -vn * n.x, y: vyHit - vn * n.y }; // tangential part
    const bounce = { x: vt.x * 0.9 - 0.42 * vn * n.x, y: vt.y * 0.9 - 0.42 * vn * n.y };
    const splash = [];
    for (let q = 0; q < 5; q++) {
      const ang = Math.atan2(n.y, n.x) + (r() - 0.5) * 2.4;
      const sp = 160 + r() * 340;
      splash.push({ vx: Math.cos(ang) * sp + bounce.x * 0.3, vy: Math.sin(ang) * sp + bounce.y * 0.3, size: 2.5 + r() * 4 });
    }
    drops.push({ s, x, y0, vy0, hit: s + tau, yHit, bounce, splash, size: 9 + r() * 5 });
  }
  const shoe = { cx: 615, w: 650 };
  // the can stands left of the shield and gives one spray that "draws" the dome
  const can = { x: 135, spray: 0.45, nozzle: { x: 150, y: 902 }, dir: -0.35 };
  return { dome, g, drops, shoe, can };
})();

// ---------- outro ----------
export const OUTRO = { logoIn: 0.3, ding: 0.42 };
