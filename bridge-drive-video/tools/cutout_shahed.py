#!/usr/bin/env python3
"""Вирізає шахед з намальованої «шахівниці»: assets/shahed-source.webp → assets/shahed.png."""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
rgb = np.asarray(Image.open(ROOT / "assets" / "shahed-source.webp").convert("RGB")).astype(int)
h, w = rgb.shape[:2]
# Фон — світлі майже сірі клітинки (і ледь помітні лінії-водяні знаки на них).
light = (rgb.max(2) - rgb.min(2) < 14) & (rgb.min(2) > 196)
n, lab = cv2.connectedComponents(light.astype(np.uint8), connectivity=4)
border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
bg = np.isin(lab, border[border > 0])
# Дрібні острівці фону всередині контуру (між лопатями гвинта) теж прибираємо.
for i in range(1, n):
    comp = lab == i
    if not bg[comp].any() and comp.sum() > 400:
        ys, xs = np.nonzero(comp)
        if xs.min() < 330 and ys.min() > 380:   # зона гвинта
            bg |= comp
alpha = np.where(bg, 0, 255).astype(np.uint8)
alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# Лишаємо тільки великі шматки — дрон і гвинт; цятки водяних знаків відкидаємо.
n, lab, stats, _ = cv2.connectedComponentsWithStats(alpha, connectivity=8)
keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 2000]
alpha = np.where(np.isin(lab, keep), 255, 0).astype(np.uint8)
ys, xs = np.nonzero(alpha)
box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
out = np.dstack([rgb.astype(np.uint8), alpha])
Image.fromarray(out).crop(box).save(ROOT / "assets" / "shahed.png")
print("bbox", box)
