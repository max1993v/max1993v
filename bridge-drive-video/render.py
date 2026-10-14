#!/usr/bin/env python3
"""POV-поїздка через міст: салон Audi поверх дороги, міст наближається, легка тряска.

Рендерить кадри в пам'яті й передає їх у ffmpeg → out/bridge-drive.mp4 (1080×1920, 30 fps).
Відео зациклене: в останні C секунд мимо проїжджає пілон, і кадр плавно
переходить у стартовий — у Reels/Stories петля без шва.
"""
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out" / "bridge-drive.mp4"

W, H, FPS = 1080, 1920, 30
T = 10.0          # тривалість петлі, с
C = 0.6           # тривалість переходу в кінці петлі, с
Z_END = 4.6       # наскільки наближаємось до пілона (зум у кінці шляху)
F = W / 941       # масштаб вихідних картинок (941 px завширшки) у кадр

# Геометрія у координатах вихідних картинок (941×1672).
VP = (470.0, 1215.0)     # точка сходу дороги на фото мосту
VP_FRAME = (470.0, 870.0)  # де вона стоїть у кадрі — над панеллю приладів
BG_SCALE = 0.82          # стартовий масштаб фону: видно пілон разом із прапором
COCKPIT_SHIFT = 150      # салон опущено, щоб у лобовому склі було більше дороги
UP = 4                   # піксель-арт збільшуємо «по пікселях», далі — гладко
PAD = 110                # дзеркальне доповнення фону з боків (видно лише перші секунди)

# Постійна швидкість: відстань до пілона d = d0 - v·p, видимий масштаб z = d0/d.
K = (1 - 1 / Z_END) / (T + C)


def zoom(p):
    return 1 / (1 - K * p)


def smooth_noise(t, seed):
    """Суміш синусоїд з «некратними» частотами — плавна псевдовипадкова вібрація."""
    rng = np.random.default_rng(seed)
    freqs = rng.uniform(5, 13, 4)
    phases = rng.uniform(0, 2 * math.pi, 4)
    amps = np.array([1.0, 0.7, 0.5, 0.35])
    return float(np.sum(amps * np.sin(2 * math.pi * freqs * t + phases)) / amps.sum())


# Стики й нерівності дороги: (час, сила). Час повторюється з періодом T, щоб петля не мала шва.
BUMPS = [(0.9, 1.0), (2.6, 0.6), (4.1, 0.9), (5.7, 0.5), (7.0, 1.2), (8.3, 0.7), (9.5, 1.4)]


def bump(t):
    y = 0.0
    for t0, a in BUMPS:
        for k in (-1, 0, 1):
            dt = t - (t0 + k * T)
            if 0 <= dt < 0.8:
                y += a * math.exp(-dt * 7) * math.sin(dt * 2 * math.pi * 5.5)
    return y


def shake(t):
    """Зсув камери (у пікселях кадру) і крен у радіанах."""
    dy = 2.2 * smooth_noise(t, 1) + 7 * bump(t)
    dx = 1.2 * smooth_noise(t, 2) + 1.5 * bump(t - 0.05)
    roll = math.radians(0.18 * smooth_noise(t * 0.6, 3) + 0.25 * bump(t - 0.03))
    return dx, dy, roll


def load_bg():
    bg = Image.open(ROOT / "assets" / "bridge.webp").convert("RGB")
    a = np.asarray(bg)
    a = np.concatenate([a[:, PAD:0:-1], a, a[:, -2:-PAD - 2:-1]], axis=1)  # дзеркало з боків
    bg = Image.fromarray(a)
    return bg.resize((bg.width * UP, bg.height * UP), Image.NEAREST)


def load_cockpit():
    ck = Image.open(ROOT / "assets" / "cockpit.webp").convert("RGBA")
    return ck.resize((W, round(ck.height * F)), Image.LANCZOS)


def bg_frame(bg, p, dx, dy, roll):
    """Фон при позиції шляху p: зум навколо точки сходу + тряска камери."""
    s = BG_SCALE * zoom(p) * F / UP           # пікселі кадру на піксель джерела
    cx, cy = VP_FRAME[0] * F + dx, VP_FRAME[1] * F + dy
    sx, sy = (VP[0] + PAD) * UP, VP[1] * UP
    cr, sr = math.cos(roll), math.sin(roll)
    # Зворотне відображення кадр → джерело для Image.transform.
    a, b = cr / s, sr / s
    d, e = -sr / s, cr / s
    c = sx - a * cx - b * cy
    f = sy - d * cx - e * cy
    return bg.transform((W, H), Image.AFFINE, (a, b, c, d, e, f), Image.BICUBIC)


def compose(bg, cockpit, t):
    dx, dy, roll = shake(t)
    frame = bg_frame(bg, t + C, dx, dy, roll)
    if t > T - C:  # проїхали пілон — плавно переходимо в початок наступного прольоту
        w = (t - (T - C)) / C
        w = w * w * (3 - 2 * w)
        nxt = bg_frame(bg, t - (T - C), dx, dy, roll)
        frame = Image.blend(frame, nxt, w)
    # Салон трясеться разом із головою, але трохи м'якше.
    ox, oy = round(dx * 0.35), round(COCKPIT_SHIFT * F + dy * 0.45)
    frame.paste(cockpit, (ox, oy), cockpit)
    return frame


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bg, cockpit = load_bg(), load_cockpit()
    if len(sys.argv) > 1 and sys.argv[1] == "--stills":
        for t in (0.0, 3.0, 6.0, 8.5, 9.6, 9.9):
            compose(bg, cockpit, t).save(OUT.parent / f"still_{t:04.1f}.png")
        return
    n = round(T * FPS)
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "17",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
        stdin=subprocess.PIPE)
    for i in range(n):
        ff.stdin.write(compose(bg, cockpit, i / FPS).tobytes())
        if i % 30 == 0:
            print(f"кадр {i}/{n}", flush=True)
    ff.stdin.close()
    sys.exit(ff.wait())


if __name__ == "__main__":
    main()
