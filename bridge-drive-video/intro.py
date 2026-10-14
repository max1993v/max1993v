"""Заставка «как в игре»: титульный экран NORTH BRIDGE перед основным видео.

Над мостом пролетает шахед, надпись переливается, внизу мигает (гаснет) START,
потом кнопка «нажимается» и экран пиксельным переходом уходит в поездку.
Координаты — в пикселях исходной картинки assets/title.webp (941×1672).
"""
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent

DURATION = 5.4                 # длина заставки, с (вместе с переходом)
PRESS = 3.9                    # момент нажатия START
TRANSITION = (4.7, 5.4)        # пиксельный переход в основное видео
SHAHED_FLIGHT = (0.4, 3.4)     # когда шахед пролетает над мостом

TITLE_BOX = (115, 125, 830, 450)
SHAHED_BOX = (75, 380, 500, 650)
FLAGPOLE = (455, 495)          # x от флагштока и выше по y — не трогаем
PILL = (286, 1446, 658, 1562)          # сама кнопка START
ARROWS = [(212, 1472, 264, 1534), (683, 1472, 732, 1534)]


def _fill_from_mirror(img, mask):
    """Закрашивает маску небом с зеркальной стороны картинки, шов сглаживает inpaint'ом."""
    out = img.copy()
    ys, xs = np.nonzero(mask)
    mx = img.shape[1] - 1 - xs
    out[ys, xs] = img[ys, mx]
    # У центра картинки зеркало попадает на сам шахед — такие пиксели дорисовываем inpaint'ом.
    bad = np.zeros_like(mask)
    bad[ys[mask[ys, mx] > 0], xs[mask[ys, mx] > 0]] = 255
    ring = cv2.dilate(mask, np.ones((5, 5), np.uint8)) - cv2.erode(mask, np.ones((3, 3), np.uint8))
    return cv2.inpaint(out, cv2.dilate(bad, np.ones((5, 5), np.uint8)) | ring, 5, cv2.INPAINT_TELEA)


class Title:
    def __init__(self, W, H):
        self.W, self.H = W, H
        img = np.asarray(Image.open(ROOT / "assets" / "title.webp").convert("RGB")).copy()
        h, w = img.shape[:2]
        self.sx, self.sy = W / w, H / h

        # 1) Убираем нарисованный шахед — вместо него будет летающий.
        x0, y0, x1, y1 = SHAHED_BOX
        sub = img[y0:y1, x0:x1].astype(int)
        grey = (sub.max(2) - sub.min(2) < 45) | (sub.max(2) < 70)
        grey[max(0, 495 - y0):, FLAGPOLE[0] - x0:] = False
        sm = np.zeros((h, w), np.uint8)
        sm[y0:y1, x0:x1] = grey * 255
        sm = cv2.morphologyEx(sm, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(sm)
        sm = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 500]).astype(np.uint8) * 255
        sm = cv2.dilate(sm, np.ones((5, 5), np.uint8))
        img = _fill_from_mirror(img, sm)
        self.shahed_mask = sm

        # 2) Маска букв: всё внутри толстой тёмной обводки (небо заливаем от краёв рамки).
        x0, y0, x1, y1 = TITLE_BOX
        sub = img[y0:y1, x0:x1].astype(int)
        lum = sub @ np.array([0.299, 0.587, 0.114])
        passable = (lum > 75).astype(np.uint8)
        n, lab = cv2.connectedComponents(passable, connectivity=4)
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        sky = np.isin(lab, edge[edge > 0])
        letters = np.zeros((h, w), np.float32)
        letters[y0:y1, x0:x1] = (~sky & (lum > 95)).astype(np.float32)
        self.letters = cv2.resize(letters, (W, H), interpolation=cv2.INTER_NEAREST)[:, :, None]

        # 3) Маска кнопки и стрелок: всё, что не синеватый асфальт, — они мигают (гаснут).
        bm = np.zeros((h, w), np.float32)
        for x0, y0, x1, y1 in (PILL, *ARROWS):
            sub = img[y0:y1, x0:x1].astype(int)
            bm[y0:y1, x0:x1] = sub[:, :, 2] - sub[:, :, 0] < 30
        self.button = cv2.resize(bm, (W, H), interpolation=cv2.INTER_NEAREST)[:, :, None]
        self.base = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        self.diag = (xx + 0.6 * yy) / W

    def _button(self, out, t):
        if t < PRESS:
            lit = (t % 0.9) < 0.6                         # спокойное мигание «PRESS START»
        elif t < PRESS + 0.22:                            # нажатие: кнопка вспыхивает
            flash = np.minimum(out * 1.35 + 60, 255)
            out[:] = out * (1 - self.button) + flash * self.button
            return
        else:
            lit = int((t - PRESS) / 0.08) % 2 == 0        # быстрое мигание «принято»
        if not lit:
            out[:] = out * (1 - self.button) + out * 0.28 * self.button

    def _shimmer(self, out, t):
        # Блик-полоса бежит по буквам по диагонали + мягкая «волна» яркости.
        pos = (t * 0.75) % 1.6 - 0.3
        band = np.exp(-((self.diag - pos) / 0.05) ** 2)[:, :, None]
        wave = 0.10 * np.sin(2 * math.pi * (self.diag * 2.2 - t * 1.4))[:, :, None]
        lit = out + (255 - out) * (0.75 * band + np.maximum(wave, 0)) + out * np.minimum(wave, 0)
        return out * (1 - self.letters) + lit * self.letters

    def frame(self, t, shahed_sprite):
        """Кадр заставки как float32 RGB (H×W×3) в момент t."""
        out = self.base.copy()
        self._button(out, t)
        out = self._shimmer(out, t)
        a, b = SHAHED_FLIGHT
        if a <= t < b:
            u = (t - a) / (b - a)
            img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGBA")
            sp = shahed_sprite
            x = -sp.width / 2 + u * (self.W + sp.width)
            y = 620 * self.sy - 0.2 * (x - self.W / 2)
            wob = 1.5 * math.sin(2 * math.pi * u * 1.3)
            r = sp.rotate(wob, resample=Image.BICUBIC, expand=True)
            img.alpha_composite(r, (round(x - r.width / 2), round(y - r.height / 2)))
            out = np.asarray(img.convert("RGB"), np.float32)
        return out


def pixelate(frame, block):
    """Мозаика: кадр «рассыпается» на крупные пиксели, как в старых играх."""
    if block <= 1:
        return frame
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (max(1, w // block), max(1, h // block)), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
