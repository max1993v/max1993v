// ITU-R BS.1770-4 integrated loudness, a look-ahead peak limiter and WAV encoding.

// Biquad on a Float32Array (direct form I).
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

// K-weighting coefficients derived for any sample rate (pyloudnorm formulation).
function kWeight(x, fs) {
  let G = 3.999843853973347, f0 = 1681.974450955533, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

export function integratedLoudness(channels, fs) {
  const kw = channels.map((c) => kWeight(c, fs));
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const z = [];
  for (let s = 0; s + block <= kw[0].length; s += hop) {
    let sum = 0;
    for (const c of kw) {
      let e = 0;
      for (let i = s; i < s + block; i++) e += c[i] * c[i];
      sum += e / block;
    }
    z.push(sum);
  }
  const L = (p) => -0.691 + 10 * Math.log10(p);
  const abs = z.filter((p) => L(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => L(p) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function peak(channels) {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

// Look-ahead brickwall limiter (stereo-linked). Ceiling in linear gain.
export function limit(channels, fs, ceiling) {
  const n = channels[0].length;
  const look = Math.round(0.005 * fs);
  const release = Math.exp(-1 / (0.08 * fs));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const c of channels) a = Math.max(a, Math.abs(c[i]));
    need[i] = a > ceiling ? ceiling / a : 1;
  }
  // minimum over the look-ahead window, then smooth release
  const gain = new Float32Array(n);
  let g = 1;
  for (let i = n - 1; i >= 0; i--) gain[i] = Math.min(need[i], i + 1 < n ? gain[i + 1] + (1 - gain[i + 1]) / look : 1);
  for (let i = 0; i < n; i++) {
    g = gain[i] < g ? gain[i] : 1 - (1 - g) * release;
    g = Math.min(g, gain[i]);
    for (const c of channels) c[i] *= g;
  }
  for (const c of channels) for (let i = 0; i < n; i++) c[i] = Math.max(-ceiling, Math.min(ceiling, c[i]));
}

export function encodeWavFloat32(channels, fs) {
  const n = channels[0].length, ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 4);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, ch, true);
  v.setUint32(24, fs, true); v.setUint32(28, fs * ch * 4, true); v.setUint16(32, ch * 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, n * ch * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += 4) v.setFloat32(o, channels[c][i], true);
  return buf;
}
