// Reference exporter: renders every frame headlessly with the same render(t)
// used by the preview, renders the soundtrack with OfflineAudioContext, and
// muxes both into an Instagram-ready MP4 (H.264 High + AAC-LC 48 kHz stereo).
//
// Usage: node export/render.mjs [out.mp4] [--workers=4] [--frames=a:b]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  const globalRoot = (await import('node:child_process')).execSync('npm root -g').toString().trim();
  ({ chromium } = require(path.join(globalRoot, 'playwright')));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'out', 'sneaker-mama-reel.mp4'));
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const WORKERS = +opt('workers', Math.max(1, Math.min(4, os.cpus().length)));

// ---- static server (ES modules need http://)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html?headless=1`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 2000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  // Google Fonts are optional: the system "Inter Display" is used when present.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => window.SM_READY === true, null, { timeout: 60000 });
  return page;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smreel-'));
fs.mkdirSync(path.dirname(out), { recursive: true });
const main = await openPage();
const meta = await main.evaluate(() => ({ FPS: SM.FPS, TOTAL: SM.TOTAL_FRAMES, DURATION: SM.DURATION, contrast: SM.contrast() }));
const fontOk = await main.evaluate(() => document.fonts.check('900 40px "Inter Display"') || document.fonts.check('900 40px "Inter"'));
if (!fontOk) console.warn('⚠ Inter Display / Inter not found — the render will use a fallback font.');

// ---- audio
console.log('Rendering soundtrack…');
const { wav, stats } = await main.evaluate(() => SM.wav());
const wavPath = path.join(tmp, 'audio.wav');
fs.writeFileSync(wavPath, Buffer.from(wav, 'base64'));
console.log(`  music ${stats.musicLufs.toFixed(1)} LUFS · sfx ${stats.sfxLufs.toFixed(1)} LUFS · mix ${stats.mixLufs.toFixed(1)} LUFS · peak ${stats.peakDb.toFixed(1)} dBFS`);

// ---- video: frames piped as PNG into ffmpeg, muxed with the WAV
const [fa, fb] = opt('frames', `0:${meta.TOTAL}`).split(':').map(Number);
const ff = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(meta.FPS), '-c:v', 'png', '-i', '-',
  '-ss', String(fa / meta.FPS), '-i', wavPath,
  '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '16M', '-bufsize', '32M', '-profile:v', 'high', '-level', '4.1',
  '-pix_fmt', 'yuv420p', '-r', String(meta.FPS), '-g', String(meta.FPS * 2),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
  '-t', String((fb - fa) / meta.FPS),
  '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));

const pages = [main, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, openPage)))];
const ready = new Map();
let next = fa, written = fa;
const t0 = Date.now();
async function worker(page) {
  while (next < fb) {
    const f = next++;
    const data = await page.evaluate((t) => SM.frame(t), f / meta.FPS);
    ready.set(f, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    while (ready.has(written)) {
      const buf = ready.get(written);
      ready.delete(written);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      written++;
      if (written % 30 === 0) process.stdout.write(`\r  frames ${written}/${fb} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
}
console.log(`Rendering frames with ${pages.length} worker(s)…`);
await Promise.all(pages.map(worker));
ff.stdin.end();
await ffDone;
process.stdout.write('\n');
await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log('Contrast (WCAG, ≥ 4.5:1):');
for (const c of meta.contrast) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.ratio}:1`);
console.log(`Done → ${out}`);
