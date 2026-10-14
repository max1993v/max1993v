"""Заставка «як у грі»: титульний екран NORTH BRIDGE перед основним відео.

Напис мигає, перед ним пролітає шахед, внизу мигає START,
потім кнопка «натискається» — і піксельна мозаїка переходить у поїздку.
Координати — в пікселях вихідної картинки assets/title.webp (941×1672).
"""
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent

PRESS = 3.9                    # момент натискання START
TRANSITION = (4.7, 5.4)        # піксельний перехід в основне відео
SHAHED_FLIGHT = (0.5, 3.3)     # коли шахед пролітає перед написом
SHAHED_Y = 330                 # висота польоту — між рядками NORTH і BRIDGE

TITLE_BOX = (110, 140, 840, 500)
PILL = (286, 1446, 658, 1562)                              # сама кнопка START
ARROWS = [(212, 1472, 264, 1534), (683, 1472, 732, 1534)]  # жовті стрілки


class Title:
    def __init__(self, W, H):
        self.W, self.H = W, H
        img = np.asarray(Image.open(ROOT / "assets" / "title.webp").convert("RGB"))
        h, w = img.shape[:2]
        self.sy = H / h

        # Маска букв: усе всередині товстої темної обводки (небо заливаємо від країв рамки).
        x0, y0, x1, y1 = TITLE_BOX
        sub = img[y0:y1, x0:x1].astype(int)
        lum = sub @ np.array([0.299, 0.587, 0.114])
        n, lab = cv2.connectedComponents((lum > 75).astype(np.uint8), connectivity=4)
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        sky = np.isin(lab, edge[edge > 0])
        letters = np.zeros((h, w), np.float32)
        letters[y0:y1, x0:x1] = ~sky & (lum > 95)
        self.letters = cv2.resize(letters, (W, H), interpolation=cv2.INTER_NEAREST)[:, :, None]

        # Маска кнопки й стрілок: усе, що не синюватий асфальт, — вони мигають (гаснуть).
        bm = np.zeros((h, w), np.float32)
        for x0, y0, x1, y1 in (PILL, *ARROWS):
            sub = img[y0:y1, x0:x1].astype(int)
            bm[y0:y1, x0:x1] = sub[:, :, 2] - sub[:, :, 0] < 30
        self.button = cv2.resize(bm, (W, H), interpolation=cv2.INTER_NEAREST)[:, :, None]

        self.base = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)

    def _title(self, out, t):
        # Мигання напису по-8-бітному: яскравість стрибає сходинками (0 → ⅓ → ⅔ → 1 → ⅔ → 0).
        step = int(t / 0.12) % 8
        level = (0, 0, 0, 0, 1, 2, 3, 2)[step] / 3
        flash = out + (255 - out) * 0.65 * level
        out[:] = out * (1 - self.letters) + flash * self.letters

    def _button(self, out, t):
        if t < PRESS:
            lit = (t % 0.9) < 0.6                         # спокійне мигання «PRESS START»
        elif t < PRESS + 0.22:                            # натискання: кнопка спалахує
            flash = np.minimum(out * 1.35 + 60, 255)
            out[:] = out * (1 - self.button) + flash * self.button
            return
        else:
            lit = int((t - PRESS) / 0.08) % 2 == 0        # швидке мигання «прийнято»
        if not lit:
            out[:] = out * (1 - self.button) + out * 0.28 * self.button

    def frame(self, t, shahed_sprite):
        """Кадр заставки як float32 RGB (H×W×3) у момент t."""
        out = self.base.copy()
        self._title(out, t)
        self._button(out, t)
        a, b = SHAHED_FLIGHT
        if a <= t < b:  # шахед летить зліва направо перед написом, трохи набираючи висоту
            u = (t - a) / (b - a)
            img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGBA")
            sp = shahed_sprite
            x = -sp.width / 2 + u * (self.W + sp.width)
            y = SHAHED_Y * self.sy - 0.2 * (x - self.W / 2)
            r = sp.rotate(1.5 * math.sin(2 * math.pi * u * 1.3), resample=Image.BICUBIC, expand=True)
            img.alpha_composite(r, (round(x - r.width / 2), round(y - r.height / 2)))
            out = np.asarray(img.convert("RGB"), np.float32)
        return out


def pixelate(frame, block):
    """Мозаїка: кадр «розсипається» на великі пікселі, як у старих іграх."""
    if block <= 1:
        return frame
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (max(1, w // block), max(1, h // block)), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
