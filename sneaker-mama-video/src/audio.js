// Original soundtrack, synthesised with the Web Audio API and rendered offline.
// Minimal house, 120 BPM, A minor. Music and SFX are rendered as two stems,
// normalised (music −14 LUFS, SFX 6 dB below), summed and peak-limited.
import { DURATION, SAMPLE_RATE, BEAT, BAR, CUTS } from './config.js';
import { rng } from './util.js';
import { FOAM, BRUSH, SPRAY, WATER, OUTRO, T_FOAM, T_BRUSH, T_GERM, T_WATER, T_OUTRO } from './timeline.js';
import { integratedLoudness, peak, limit } from './loudness.js';

const BEAT_START = 3; // the groove starts on the first cut
const BEAT_END = 19; // and stops on the outro cut

// ---------------------------------------------------------------- shared helpers

function noiseBuffer(ctx, seed, seconds = 2) {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const r = rng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  }
  return buf;
}

function impulse(ctx, seconds, decay, seed) {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const r = rng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      d[i] = (r() * 2 - 1) * Math.pow(1 - x, decay) * (i < 200 ? i / 200 : 1);
    }
  }
  return buf;
}

// Attack to `peak`, then exponential decay with time constant ~ d/5.
function env(param, t, a, peakV, d) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peakV, t + a);
  param.setTargetAtTime(0, t + a, d / 5);
}

function makeCtx() {
  return new OfflineAudioContext(2, Math.round(DURATION * SAMPLE_RATE), SAMPLE_RATE);
}

function noise(ctx, kit, t, dur, seedOffset = 0) {
  const src = ctx.createBufferSource();
  src.buffer = kit.noise;
  const r = rng(Math.floor(t * 1000) + seedOffset);
  src.start(t, r() * (kit.noise.duration - dur - 0.05), dur + 0.05);
  return src;
}

function panner(ctx, v) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, v));
  return p;
}

// ---------------------------------------------------------------- music

const NOTE = { A1: 55, C2: 65.41, G1: 49.0, F2: 87.31, A2: 110, F3: 174.61, A3: 220, C4: 261.63, E4: 329.63, G4: 392.0, B4: 493.88 };
const AM9 = [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4, NOTE.B4];
const FMAJ7 = [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4];

function buildMusic(ctx) {
  const kit = { noise: noiseBuffer(ctx, 11, 6) };
  const out = ctx.createGain();
  out.connect(ctx.destination);
  // last 1.5 s fade-out
  out.gain.setValueAtTime(1, DURATION - 1.5);
  out.gain.linearRampToValueAtTime(0, DURATION);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 3.2, 3.2, 21);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.55;
  verb.connect(verbOut).connect(out);

  // sidechain-style pump for pad and bass
  const duck = ctx.createGain();
  duck.connect(out);
  const beats = [];
  for (let t = BEAT_START; t <= BEAT_END + 1e-6; t += BEAT) beats.push(t);
  duck.gain.setValueAtTime(1, 0);
  for (const t of beats) {
    if (t >= BEAT_END) break;
    duck.gain.setValueAtTime(1, t);
    duck.gain.linearRampToValueAtTime(0.45, t + 0.01);
    duck.gain.setTargetAtTime(1, t + 0.02, 0.09);
  }

  // ---- drums
  const kick = (t, amp = 1) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    const g = ctx.createGain();
    env(g.gain, t, 0.003, 0.95 * amp, 0.45);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.6);
    const c = noise(ctx, kit, t, 0.01, 1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    env(cg.gain, t, 0.001, 0.12 * amp, 0.015);
    c.connect(hp).connect(cg).connect(out);
  };
  const clap = (t) => {
    const s = noise(ctx, kit, t, 0.3, 2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      g.gain.linearRampToValueAtTime(0.55, t + k * 0.011 + 0.001);
      g.gain.linearRampToValueAtTime(0.12, t + k * 0.011 + 0.009);
    }
    g.gain.linearRampToValueAtTime(0.5, t + 0.034);
    g.gain.setTargetAtTime(0, t + 0.036, 0.05);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    s.connect(bp).connect(g);
    g.connect(out);
    g.connect(send).connect(verb);
  };
  const hat = (t, open, pan) => {
    const s = noise(ctx, kit, t, open ? 0.2 : 0.06, 3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7800;
    const g = ctx.createGain();
    env(g.gain, t, 0.001, open ? 0.16 : 0.12, open ? 0.14 : 0.045);
    s.connect(hp).connect(g).connect(panner(ctx, pan)).connect(out);
  };

  const swing = 0.1 * (BEAT / 2); // 10% swing on the off-beat eighths
  beats.forEach((t, i) => {
    if (t >= BEAT_END) return;
    kick(t);
    const inBar = i % 4;
    if (inBar === 1 || inBar === 3) clap(t);
    hat(t, false, -0.15);
    hat(t + BEAT / 2 + swing, inBar % 2 === 1, 0.2);
  });
  // impact on the outro cut: last kick + soft crash into the reverb
  kick(BEAT_END, 1);
  const crash = (t, amp) => {
    const s = noise(ctx, kit, t, 1.6, 4);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = ctx.createGain();
    env(g.gain, t, 0.002, amp, 1.4);
    s.connect(hp).connect(g);
    g.connect(out);
    g.connect(verb);
  };
  crash(BEAT_START, 0.12);
  crash(BEAT_END, 0.1);

  // sub boom on the drop at 3 s
  {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, BEAT_START);
    o.frequency.exponentialRampToValueAtTime(40, BEAT_START + 0.8);
    const g = ctx.createGain();
    env(g.gain, BEAT_START, 0.005, 0.45, 1.0);
    o.connect(g).connect(out);
    o.start(BEAT_START);
    o.stop(BEAT_START + 1.4);
  }

  // ---- bass: saw through a low-pass, riff A–A–C–G each bar
  const riff = [[0, NOTE.A1, 0.38], [0.75, NOTE.A1, 0.2], [1.0, NOTE.C2, 0.38], [1.5, NOTE.G1, 0.42]];
  for (let bar = BEAT_START; bar < BEAT_END - 1e-6; bar += BAR) {
    for (const [off, f, dur] of riff) {
      const t = bar + off;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const sub = ctx.createOscillator();
      sub.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 5;
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.setTargetAtTime(260, t, 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.006);
      g.gain.setValueAtTime(0.32, t + dur - 0.04);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const sg = ctx.createGain();
      sg.gain.value = 0.55;
      o.connect(lp).connect(g);
      sub.connect(sg).connect(g);
      g.connect(duck);
      o.start(t); sub.start(t);
      o.stop(t + dur + 0.01); sub.stop(t + dur + 0.01);
    }
  }

  // ---- warm pad Am9 -> Fmaj7 with a slow filter
  const padLP = ctx.createBiquadFilter();
  padLP.type = 'lowpass';
  padLP.Q.value = 0.8;
  padLP.frequency.setValueAtTime(450, 0);
  padLP.frequency.linearRampToValueAtTime(1500, 3);
  for (let t = 3; t < 19; t += 4) {
    padLP.frequency.linearRampToValueAtTime(900, t + 2);
    padLP.frequency.linearRampToValueAtTime(1700, t + 4);
  }
  padLP.frequency.linearRampToValueAtTime(800, DURATION);
  const padOut = ctx.createGain();
  padOut.gain.value = 0.07;
  const padSend = ctx.createGain();
  padSend.gain.setValueAtTime(0.35, 0);
  padSend.gain.setValueAtTime(0.35, BEAT_END);
  padSend.gain.linearRampToValueAtTime(1.0, BEAT_END + 1);
  padLP.connect(padOut);
  padOut.connect(duck);
  padOut.connect(padSend).connect(verb);
  const chords = [[0, 5, AM9, NOTE.A2]];
  for (let t = 5; t < BEAT_END; t += BAR) chords.push([t, t + BAR, ((t - 5) / BAR) % 2 === 0 ? FMAJ7 : AM9, ((t - 5) / BAR) % 2 === 0 ? NOTE.F2 : NOTE.A2]);
  chords.push([BEAT_END, DURATION + 0.5, AM9, NOTE.A2]);
  chords.forEach(([t0, t1, notes, root], ci) => {
    const att = ci === 0 ? 1.4 : 0.25, rel = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + att);
    g.gain.setValueAtTime(1, t1);
    g.gain.linearRampToValueAtTime(0, t1 + rel);
    g.connect(padLP);
    const voices = [];
    notes.forEach((f) => [-7, 7].forEach((cents) => voices.push({ f, cents, type: 'sawtooth', a: 1 })));
    voices.push({ f: root, cents: 0, type: 'sine', a: 1.6 });
    voices.forEach((v) => {
      const o = ctx.createOscillator();
      o.type = v.type;
      o.frequency.value = v.f;
      o.detune.value = v.cents;
      const vg = ctx.createGain();
      vg.gain.value = v.a;
      o.connect(vg).connect(g);
      o.start(t0);
      o.stop(Math.min(DURATION, t1 + rel + 0.05));
    });
  });

  // ---- riser into the drop (0–3 s)
  {
    const s = noise(ctx, kit, 0, 2.99, 5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(300, 0.2);
    bp.frequency.exponentialRampToValueAtTime(7500, 2.97);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.02, 0.5);
    g.gain.exponentialRampToValueAtTime(0.5, 2.95);
    g.gain.linearRampToValueAtTime(0, 2.995);
    s.connect(bp).connect(g);
    g.connect(out);
    g.connect(verb);
  }

  // ---- final "ding" when the website button appears
  {
    const t = T_OUTRO + OUTRO.ding;
    [[1, 1, 2.6], [2, 0.45, 1.6], [2.76, 0.3, 1.0], [5.4, 0.12, 0.5]].forEach(([ratio, amp, dec]) => {
      const o = ctx.createOscillator();
      o.frequency.value = 880 * ratio;
      const g = ctx.createGain();
      env(g.gain, t, 0.002, 0.16 * amp, dec);
      o.connect(g);
      g.connect(out);
      g.connect(verb);
      o.start(t);
      o.stop(Math.min(DURATION, t + dec * 1.5));
    });
  }
}

// ---------------------------------------------------------------- sfx

function buildSfx(ctx) {
  const kit = { noise: noiseBuffer(ctx, 77, 6) };
  const out = ctx.createGain();
  out.connect(ctx.destination);
  out.gain.setValueAtTime(1, DURATION - 1.5);
  out.gain.linearRampToValueAtTime(0, DURATION);
  const panX = (x) => ((x - 540) / 540) * 0.7;

  // soft "pshh" on every diagonal wipe (moves left → right like the band)
  for (const c of CUTS) {
    const t0 = c - 0.3, t1 = c + 0.3;
    const s = noise(ctx, kit, t0, 0.62, 10);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(700, t0);
    bp.frequency.exponentialRampToValueAtTime(3600, c);
    bp.frequency.exponentialRampToValueAtTime(1300, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.6, c - 0.03);
    g.gain.linearRampToValueAtTime(0, t1);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.7, t0);
    p.pan.linearRampToValueAtTime(0.7, t1);
    s.connect(bp).connect(g).connect(p).connect(out);
  }

  // foam bubbles: soft "puff"
  const r = rng(808);
  FOAM.bubbles.forEach((b, i) => {
    if (i % 2) return;
    const t = T_FOAM + b.emit;
    const f0 = 240 + r() * 320;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.08);
    const g = ctx.createGain();
    env(g.gain, t, 0.006, 0.4, 0.12);
    const p = panner(ctx, panX(b.x));
    o.connect(g).connect(p).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    const s = noise(ctx, kit, t, 0.06, 11 + i);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    env(ng.gain, t, 0.004, 0.18, 0.06);
    s.connect(lp).connect(ng).connect(p);
  });

  // brush scrub: band-passed noise following the brush speed and position
  {
    const t0 = T_BRUSH + BRUSH.start, t1 = T_BRUSH + BRUSH.end;
    const n = Math.round((t1 - t0) * 200);
    const gainCurve = new Float32Array(n), panCurve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = BRUSH.start + (i / (n - 1)) * (BRUSH.end - BRUSH.start);
      const contact = BRUSH.contact(u);
      gainCurve[i] = Math.min(1, Math.abs(BRUSH.vx(u)) / 1800) * 0.7 * contact;
      panCurve[i] = panX(BRUSH.x(u));
    }
    const s = noise(ctx, kit, t0, t1 - t0, 12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.setValueCurveAtTime(gainCurve, t0, t1 - t0);
    const p = ctx.createStereoPanner();
    p.pan.setValueCurveAtTime(panCurve, t0, t1 - t0);
    s.connect(bp).connect(g).connect(p).connect(out);
  }

  // spray pump "pshik" x3
  for (const pt of SPRAY.presses) {
    const t = T_GERM + pt;
    const s = noise(ctx, kit, t, 0.4, 13);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6500;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.012);
    g.gain.setValueAtTime(0.7, t + 0.15);
    g.gain.setTargetAtTime(0, t + 0.15, 0.05);
    s.connect(hp).connect(bp).connect(g).connect(panner(ctx, -0.35)).connect(out);
  }
  // quiet "pop" for each bacterium
  SPRAY.germs.forEach((gm, i) => {
    const t = T_GERM + gm.pop;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.05);
    const g = ctx.createGain();
    env(g.gain, t, 0.002, 0.45, 0.09);
    const p = panner(ctx, panX(gm.x));
    o.connect(g).connect(p).connect(out);
    o.start(t);
    o.stop(t + 0.15);
    const c = noise(ctx, kit, t, 0.006, 20 + i);
    const cg = ctx.createGain();
    env(cg.gain, t, 0.0005, 0.25, 0.008);
    c.connect(cg).connect(p);
  });

  // water drops: high "plink" on each bounce off the shield
  const r2 = rng(909);
  WATER.drops.forEach((d) => {
    const t = T_WATER + d.hit;
    const f = 1900 + r2() * 900;
    const p = panner(ctx, panX(d.x));
    [[1, 0.22], [2.4, 0.06]].forEach(([ratio, amp]) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * ratio, t);
      o.frequency.exponentialRampToValueAtTime(f * ratio * 1.18, t + 0.02);
      const g = ctx.createGain();
      env(g.gain, t, 0.001, amp, 0.12);
      o.connect(g).connect(p).connect(out);
      o.start(t);
      o.stop(t + 0.2);
    });
  });
}

// ---------------------------------------------------------------- render + mix

async function renderStem(build) {
  const ctx = makeCtx();
  build(ctx);
  const buf = await ctx.startRendering();
  return [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
}

const db = (x) => 20 * Math.log10(x);
const fromDb = (d) => Math.pow(10, d / 20);

export async function renderSoundtrack({ musicLufs = -14, sfxOffsetDb = -6, ceilingDb = -1.5 } = {}) {
  const fs = SAMPLE_RATE;
  const music = await renderStem(buildMusic);
  const sfx = await renderStem(buildSfx);
  const lm = integratedLoudness(music, fs);
  const ls = integratedLoudness(sfx, fs);
  const gm = fromDb(musicLufs - lm);
  const gs = fromDb(musicLufs + sfxOffsetDb - ls);
  const mix = [0, 1].map((c) => {
    const o = new Float32Array(music[c].length);
    for (let i = 0; i < o.length; i++) o[i] = music[c][i] * gm + sfx[c][i] * gs;
    return o;
  });
  const prePeak = peak(mix);
  limit(mix, fs, fromDb(ceilingDb));
  const scaledMusic = music.map((ch) => ch.map((v) => v * gm));
  return {
    channels: mix,
    sampleRate: fs,
    stats: {
      musicLufs: integratedLoudness(scaledMusic, fs),
      sfxLufs: integratedLoudness(sfx.map((ch) => ch.map((v) => v * gs)), fs),
      mixLufs: integratedLoudness(mix, fs),
      peakBeforeLimiterDb: db(prePeak),
      peakDb: db(peak(mix)),
    },
  };
}
