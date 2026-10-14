import { W, H, FPS, DURATION, TOTAL_FRAMES, SAMPLE_RATE } from './config.js';
import { render, CONTRAST_PAIRS } from './scene.js';
import { renderSoundtrack } from './audio.js';
import { encodeWavFloat32 } from './loudness.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const status = (s) => ($('status').textContent = s);

async function fontsReady() {
  const fams = ['Inter Display', 'Inter'];
  await Promise.all(
    fams.flatMap((f) => [500, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px "${f}"`, 'SNEAKER Щітки йї’').catch(() => null))),
  );
  await document.fonts.ready;
}

let soundtrackPromise = null;
const getSoundtrack = () => (soundtrackPromise ??= renderSoundtrack());

// ---------------------------------------------------------------- contrast check (WCAG)
function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrastReport() {
  return CONTRAST_PAIRS.map(([name, fg, bg]) => {
    const a = lum(fg), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { name, fg, bg, ratio: +ratio.toFixed(2), pass: ratio >= 4.5 };
  });
}

function showStats(st) {
  const rows = [];
  if (st) {
    rows.push(['Музика, LUFS', st.musicLufs.toFixed(1)], ['Ефекти, LUFS', st.sfxLufs.toFixed(1)], ['Мікс, LUFS', st.mixLufs.toFixed(1)], ['Пік, dBFS', st.peakDb.toFixed(1)]);
  }
  for (const c of contrastReport()) rows.push([`Контраст: ${c.name}`, `${c.ratio}:1 ${c.pass ? '✓' : '✗'}`]);
  $('stats').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
}

// ---------------------------------------------------------------- player
let audioCtx = null, source = null, playing = false, startedAt = 0, offset = 0, buffer = null;

function now() {
  if (!playing) return offset;
  const lat = audioCtx.outputLatency || audioCtx.baseLatency || 0;
  return audioCtx.currentTime - startedAt - lat;
}

async function play() {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' });
  await audioCtx.resume();
  if (!buffer) {
    $('play').disabled = true;
    status('Генерую саундтрек…');
    const st = await getSoundtrack();
    buffer = audioCtx.createBuffer(2, st.channels[0].length, st.sampleRate);
    st.channels.forEach((c, i) => buffer.copyToChannel(c, i));
    showStats(st.stats);
    status('');
    $('play').disabled = false;
  }
  if (offset >= DURATION - 0.05) offset = 0;
  source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  const when = audioCtx.currentTime + 0.05;
  startedAt = when - offset;
  source.start(when, offset);
  source.onended = () => {
    if (playing && now() >= DURATION - 0.1) { playing = false; offset = DURATION; updateButton(); }
  };
  playing = true;
  updateButton();
}
function pause() {
  offset = Math.min(DURATION, Math.max(0, now()));
  playing = false;
  try { source && source.stop(); } catch {}
  updateButton();
}
function seek(t) {
  const was = playing;
  if (playing) pause();
  offset = t;
  if (was) play();
}
function updateButton() {
  $('play').textContent = playing ? '❚❚ Pause' : '▶ Play';
}

function loop() {
  const t = Math.min(DURATION, Math.max(0, now()));
  render(ctx, t);
  $('time').textContent = `${t.toFixed(2)} / ${DURATION.toFixed(2)}`;
  if (document.activeElement !== $('scrub')) $('scrub').value = t;
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- in-browser MP4 export (WebCodecs)
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportMp4() {
  if (!('VideoEncoder' in window)) {
    status('Цей браузер не підтримує WebCodecs. Скористайтеся Chrome/Edge або командою npm run export.');
    return;
  }
  $('export').disabled = true;
  try {
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
    status('Генерую саундтрек…');
    const st = await getSoundtrack();
    showStats(st.stats);

    let vcfg = null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
      const c = { codec, width: W, height: H, bitrate: 14_000_000, framerate: FPS, avc: { format: 'avc' } };
      if ((await VideoEncoder.isConfigSupported(c)).supported) { vcfg = c; break; }
    }
    if (!vcfg) throw new Error('у цьому браузері немає H.264-кодера. Відкрийте сторінку в Chrome або Edge чи запустіть npm run export');
    let acfg = { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192_000 };
    let acodec = 'aac';
    if (!(await AudioEncoder.isConfigSupported(acfg)).supported) {
      acfg = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192_000 };
      acodec = 'opus';
    }

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      audio: { codec: acodec, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let err = null;
    const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) });
    ve.configure(vcfg);
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d');
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      if (err) throw err;
      render(octx, f / FPS);
      const frame = new VideoFrame(off, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      ve.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
      frame.close();
      while (ve.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
      if (f % 10 === 0) status(`Кодую відео: ${Math.round((f / TOTAL_FRAMES) * 100)}%`);
    }
    await ve.flush();

    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) });
    ae.configure(acfg);
    const n = st.channels[0].length, block = 1024;
    for (let i = 0; i < n; i += block) {
      const len = Math.min(block, n - i);
      const data = new Float32Array(len * 2);
      data.set(st.channels[0].subarray(i, i + len), 0);
      data.set(st.channels[1].subarray(i, i + len), len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data });
      ae.encode(ad);
      ad.close();
    }
    await ae.flush();
    if (err) throw err;
    muxer.finalize();
    download(new Blob([target.buffer], { type: 'video/mp4' }), 'sneaker-mama-reel.mp4');
    status(acodec === 'aac' ? 'Готово: sneaker-mama-reel.mp4 (H.264 + AAC).' : 'Готово, але браузер не має AAC-кодера — аудіо в Opus. Для Instagram краще npm run export.');
  } catch (e) {
    console.error(e);
    status('Помилка експорту: ' + e.message);
  } finally {
    $('export').disabled = false;
  }
}

// ---------------------------------------------------------------- headless API for export/render.mjs
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
window.SM = {
  W, H, FPS, DURATION, TOTAL_FRAMES,
  frame(t) { render(ctx, t); return canvas.toDataURL('image/png'); },
  async wav() {
    const st = await getSoundtrack();
    return { wav: toBase64(encodeWavFloat32(st.channels, st.sampleRate)), stats: st.stats };
  },
  contrast: contrastReport,
};

// ---------------------------------------------------------------- boot
$('play').onclick = () => (playing ? pause() : play());
$('restart').onclick = () => seek(0);
$('scrub').oninput = (e) => seek(+e.target.value);
$('export').onclick = exportMp4;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); playing ? pause() : play(); }
});
showStats(null);
await fontsReady();
window.SM_READY = true;
if (!new URLSearchParams(location.search).has('headless')) requestAnimationFrame(loop);
else render(ctx, 0);
