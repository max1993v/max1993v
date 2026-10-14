// Checks an exported reel: format, duration, A/V alignment and loudness.
// Usage: node export/verify.mjs out/sneaker-mama-reel.mp4
import { execFileSync, spawnSync } from 'node:child_process';

const file = process.argv[2] || 'out/sneaker-mama-reel.mp4';
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
const v = probe.streams.find((s) => s.codec_type === 'video');
const a = probe.streams.find((s) => s.codec_type === 'audio');
const ok = (c, msg) => console.log(`${c ? '✓' : '✗'} ${msg}`) || c;
let pass = true;
pass &= ok(v && v.codec_name === 'h264', `video: ${v?.codec_name} ${v?.profile} ${v?.width}×${v?.height} ${v?.r_frame_rate} ${v?.pix_fmt}`);
pass &= ok(v && v.width === 1080 && v.height === 1920 && v.r_frame_rate === '30/1', 'video is 1080×1920 @ 30 fps');
pass &= ok(+v.nb_frames === 690, `frames: ${v.nb_frames}`);
pass &= ok(a && a.codec_name === 'aac' && +a.sample_rate === 48000 && a.channels === 2, `audio: ${a?.codec_name} ${a?.sample_rate} Hz ${a?.channels} ch`);
const vd = +v.duration, ad = +a.duration, vs = +v.start_time, as = +a.start_time;
pass &= ok(Math.abs(vd - 23) < 0.05, `video duration ${vd.toFixed(3)} s`);
pass &= ok(Math.abs(ad - 23) < 0.05, `audio duration ${ad.toFixed(3)} s`);
pass &= ok(Math.abs(vs - as) <= 1 / 30, `A/V start offset ${((as - vs) * 1000).toFixed(1)} ms (≤ 1 frame)`);

const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
const tail = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
const I = +(/I:\s+(-?[\d.]+) LUFS/.exec(tail) || [])[1];
const TP = +(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail) || [])[1];
pass &= ok(I > -15 && I < -12.5, `integrated loudness ${I} LUFS (music stem normalised to −14, SFX −6 dB)`);
pass &= ok(TP < 0, `true peak ${TP} dBTP (no clipping)`);
console.log(pass ? '\nAll checks passed.' : '\nSome checks failed.');
process.exit(pass ? 0 : 1);
