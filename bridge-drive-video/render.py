#!/usr/bin/env python3
"""POV-поїздка через міст: салон Audi поверх дороги, міст наближається,
кермо легенько крутиться, машина ледь помітно погойдується — як у 8-бітній грі;
у небі з інтервалом пролітають п'ять шахедів.

Рендерить кадри в пам'яті й передає їх у ffmpeg → out/bridge-drive.mp4 (1080×1920, 30 fps).
Відео зациклене: в останні C секунд мимо проїжджає пілон, і кадр плавно
переходить у стартовий — у Reels/Stories петля без шва.
"""
import math
import subprocess
import sys
from pathlib import Path

import cv2
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


# Кермо (координати салону 941×1671): центр обода, зовнішній і внутрішній радіуси.
WHEEL_C = (459.0, 1126.0)
RIM_OUT, RIM_IN = 367.0, 304.0
TWIST_FADE = 640.0       # далі від центру руки вже не повертаються (плечі нерухомі)
# Отвори всередині керма, крізь які видно нерухому панель і ноги.
OPENINGS = [
    [(0, 0), (941, 0), (941, 1098), (640, 1098), (600, 1066), (330, 1066), (270, 1098), (0, 1098)],  # панель і підрульові перемикачі
    [(150, 1205), (340, 1212), (352, 1300), (388, 1318), (418, 1460), (150, 1460)],  # ліворуч під спицею
    [(770, 1205), (572, 1212), (560, 1300), (528, 1318), (500, 1460), (770, 1460)],  # праворуч під спицею
]
ARMS = [
    [(105, 1072), (195, 1060), (200, 1300), (160, 1330), (105, 1460), (60, 1580), (0, 1640), (0, 1195), (55, 1165), (98, 1110)],
    [(705, 1060), (845, 1060), (852, 1200), (882, 1290), (941, 1370), (941, 1600), (880, 1560), (800, 1330), (725, 1310)],
]
SHADOW = (18, 19, 23)    # колір салону за кермом
WATCH = [(0, 1322), (62, 1318), (90, 1360), (88, 1462), (40, 1478), (0, 1470)]  # годинник на лівій руці
ART_PX = 4 * F           # розмір «пікселя» піксель-арту в кадрі — крок погойдування


def steer(t):
    """Кут керма в градусах (+ — праворуч). Періоди кратні T, тож петля без шва."""
    w = 2 * math.pi / T
    return 2.0 * math.sin(2 * w * t) + 0.8 * math.sin(3 * w * t + 1.1)


def sway(t):
    """Ледь помітне погойдування, як у 8-бітній грі: ступенями по одному «пікселю»."""
    w = 2 * math.pi / T
    car = round(math.sin(8 * w * t)) * ART_PX           # салон: −1 / 0 / +1 піксель
    road = round(0.6 * math.sin(8 * w * t - 1.2)) * ART_PX
    return car, road


def wheel_mask_and_plate():
    """Маска керма з руками та «підкладка» — салон, де замість керма темна тінь."""
    ck = np.asarray(Image.open(ROOT / "assets" / "cockpit.webp").convert("RGBA"))
    h, w = ck.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - WHEEL_C[0], yy - WHEEL_C[1])
    m = np.zeros((h, w), np.uint8)
    m[r < RIM_OUT] = 255
    holes = np.zeros((h, w), np.uint8)
    for poly in OPENINGS:
        cv2.fillPoly(holes, [np.int32(poly)], 255)
    holes[r >= RIM_IN] = 0
    m[holes > 0] = 0
    # Руки — лише справжні пікселі шкіри (з тату й годинником) у межах полігонів ARMS.
    zone = np.zeros((h, w), np.uint8)
    for poly in ARMS:
        cv2.fillPoly(zone, [np.int32(poly)], 255)
    rgb = ck[:, :, :3].astype(int)
    skin = (rgb[:, :, 0] > 110) & (rgb[:, :, 0] - rgb[:, :, 2] > 35) & (rgb[:, :, 0] >= rgb[:, :, 1])
    skin = cv2.morphologyEx(skin.astype(np.uint8) * 255, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
    m[(skin > 0) & (zone > 0)] = 255
    cv2.fillPoly(m, [np.int32(WATCH)], 255)
    m[ck[:, :, 3] < 128] = 0
    # Підкладка: під кермом — темна «тінь» салону, під руками — сусідні кольори панелі й ніг.
    # При повороті на кілька градусів з-під них відкриваються лише тонкі смужки.
    grown = cv2.dilate(m, np.ones((5, 5), np.uint8))
    plate = ck.copy()
    plate[:, :, :3] = cv2.inpaint(np.ascontiguousarray(ck[:, :, :3]), grown, 5, cv2.INPAINT_TELEA)
    plate[(grown > 0) & (r < RIM_OUT + 4), :3] = SHADOW
    return m.astype(np.float32) / 255, plate


def load_bg():
    bg = Image.open(ROOT / "assets" / "bridge.webp").convert("RGB")
    a = np.asarray(bg)
    a = np.concatenate([a[:, PAD:0:-1], a, a[:, -2:-PAD - 2:-1]], axis=1)  # дзеркало з боків
    bg = Image.fromarray(a)
    return bg.resize((bg.width * UP, bg.height * UP), Image.NEAREST)


class Cockpit:
    """Салон із кермом, що повертається разом із руками; решта панелі нерухома."""

    def __init__(self):
        m, plate = wheel_mask_and_plate()
        ck = np.asarray(Image.open(ROOT / "assets" / "cockpit.webp").convert("RGBA")).astype(np.float32)
        wheel = ck.copy()
        wheel[:, :, 3] *= m
        self.plate, self.wheel = plate.astype(np.float32), wheel
        self.X, self.Y = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))

    def layers(self, oy, theta):
        """Шари салону в кадрі (зсунуті на oy пікселів), кермо повернуто на theta градусів."""
        x = self.X / F - WHEEL_C[0]
        y = (self.Y - oy) / F - WHEEL_C[1]
        px, py = x + WHEEL_C[0], y + WHEEL_C[1]
        plate = cv2.remap(self.plate, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        r = np.hypot(x, y)
        fade = np.clip((TWIST_FADE - r) / (TWIST_FADE - RIM_OUT), 0, 1)
        a = -math.radians(theta) * fade        # зворотне відображення: кадр → салон
        ca, sa = np.cos(a), np.sin(a)
        wx = ca * x - sa * y + WHEEL_C[0]
        wy = sa * x + ca * y + WHEEL_C[1]
        wheel = cv2.remap(self.wheel, wx, wy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return plate, wheel


def over(dst, layer):
    a = layer[:, :, 3:4] / 255
    return dst * (1 - a) + layer[:, :, :3] * a


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


# Шахеди в небі: (старт, с; висота центру, px кадру; ширина, px; напрям: +1 вправо, −1 вліво).
# Інтервал 2 с; час прольоту береться за модулем T, тож петля без шва.
SHAHEDS = [(0.2, 260, 300, 1), (2.2, 520, 210, -1), (4.2, 170, 260, 1), (6.2, 430, 240, 1), (8.2, 300, 190, -1)]
FLIGHT = 3.0                # скільки секунд шахед перетинає лобове скло
CLIMB = -0.2                # нахил траєкторії вздовж фюзеляжу (ніс трохи вгору)


class Shaheds:
    def __init__(self):
        src = Image.open(ROOT / "assets" / "shahed.png").convert("RGBA")
        a = np.asarray(src).astype(np.float32)
        a[:, :, :3] *= (0.80, 0.82, 0.92)   # знизу проти світлого неба — трохи темніші й холодніші
        src = Image.fromarray(a.astype(np.uint8))
        self.sprites = []
        for _, _, width, d in SHAHEDS:
            sp = src.resize((width, round(src.height * width / src.width)), Image.LANCZOS)
            self.sprites.append(sp if d > 0 else sp.transpose(Image.FLIP_LEFT_RIGHT))

    def draw(self, frame, t, dx, dy):
        for (start, y0, width, d), sp in zip(SHAHEDS, self.sprites):
            u = ((t - start) % T) / FLIGHT
            if u >= 1:
                continue
            span = W + 2 * width
            x = -width + u * span if d > 0 else W + width - u * span
            y = y0 + CLIMB * (x - W / 2) * d
            wob = 1.2 * math.sin(2 * math.pi * (u * 1.7 + start))   # легеньке похитування крилами
            img = sp.rotate(wob, resample=Image.BICUBIC, expand=True)
            frame.alpha_composite(img, (round(x + dx - img.width / 2), round(y + dy - img.height / 2)))
        return frame


def compose(bg, cockpit, shaheds, t):
    car_dy, road_dy = sway(t)
    lag = steer(t - 0.35)                      # машина відгукується на кермо із затримкою
    dx, roll = -6.0 * lag, math.radians(-0.12 * lag)
    frame = bg_frame(bg, t + C, dx, road_dy, roll)
    if t > T - C:  # проїхали пілон — плавно переходимо в початок наступного прольоту
        w = (t - (T - C)) / C
        w = w * w * (3 - 2 * w)
        nxt = bg_frame(bg, t - (T - C), dx, road_dy, roll)
        frame = Image.blend(frame, nxt, w)
    frame = shaheds.draw(frame.convert("RGBA"), t, dx, road_dy).convert("RGB")
    plate, wheel = cockpit.layers(COCKPIT_SHIFT * F + car_dy, steer(t))
    out = over(over(np.asarray(frame, np.float32), plate), wheel)
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bg, cockpit, shaheds = load_bg(), Cockpit(), Shaheds()
    if len(sys.argv) > 1 and sys.argv[1] == "--stills":
        for t in (1.0, 3.2, 5.6, 7.4, 9.4):
            compose(bg, cockpit, shaheds, t).save(OUT.parent / f"still_{t:04.1f}.png")
        return
    n = round(T * FPS)
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "17",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
        stdin=subprocess.PIPE)
    for i in range(n):
        ff.stdin.write(compose(bg, cockpit, shaheds, i / FPS).tobytes())
        if i % 30 == 0:
            print(f"кадр {i}/{n}", flush=True)
    ff.stdin.close()
    sys.exit(ff.wait())


if __name__ == "__main__":
    main()
