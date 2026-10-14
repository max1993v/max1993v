"""Cut the product photos out of their studio backgrounds.

Usage: python3 tools/cutout.py assets/photos-source assets/photos
Needs: pip install "rembg[cpu]" pillow numpy
Writes trimmed WebP files with alpha, scaled to a sensible max size.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from rembg import new_session, remove

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
session = new_session("isnet-general-use")
MAX = {"sneaker": 1300, "sole": 1400}

for name in sorted(os.listdir(src)):
    base = os.path.splitext(name)[0]
    im = Image.open(os.path.join(src, name)).convert("RGB")
    cut = remove(im, session=session, post_process_mask=True)
    a = np.asarray(cut)[..., 3]
    if base == "brush":
        # the models drop the cream bristles; add them back by chroma (the backdrop is neutral grey)
        rgb = np.asarray(im).astype(int)
        chroma = rgb.max(-1) - rgb.min(-1)
        bristles = ndimage.binary_opening(chroma > 22, iterations=2)
        solid = ndimage.binary_fill_holes(ndimage.binary_closing(bristles | (a > 128), iterations=4))
        lab, n = ndimage.label(solid)
        solid = lab == (np.argmax(ndimage.sum(solid, lab, range(1, n + 1))) + 1)
        soft = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)))
        a = np.maximum(a, soft)
    if base == "brush-white":
        # white bristles on a white backdrop: compare each row with the backdrop just right of them
        g = np.asarray(im.convert("L")).astype(float)
        ys, xs = np.nonzero(a > 128)
        x1, y0, y1 = xs.max(), ys.min(), ys.max()
        ref = np.median(g[:, x1 + 110:x1 + 150], axis=1, keepdims=True)
        band = np.zeros_like(a, dtype=bool)
        band[y0 + 10:y1 - 10, x1 - 6:x1 + 100] = True
        bristles = band & (g < ref - 10)
        bristles = ndimage.binary_closing(bristles, iterations=3)
        bristles = ndimage.binary_opening(bristles, iterations=1)
        solid = ndimage.binary_fill_holes(bristles | (a > 128))
        lab, n = ndimage.label(solid)
        solid = lab == (np.argmax(ndimage.sum(solid, lab, range(1, n + 1))) + 1)
        soft = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)))
        a = np.maximum(a, soft)
    a = np.where(a < 12, 0, a).astype(np.uint8)  # drop faint shadow/reflection haze
    cut = im.copy()
    cut.putalpha(Image.fromarray(a))
    ys, xs = np.nonzero(a > 0)
    cut = cut.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    m = MAX.get(base, 1100)
    if max(cut.size) > m:
        k = m / max(cut.size)
        cut = cut.resize((round(cut.width * k), round(cut.height * k)), Image.LANCZOS)
    out = os.path.join(dst, base + ".webp")
    cut.save(out, "WEBP", quality=90, method=6)
    print(base, cut.size, os.path.getsize(out) // 1024, "KB")
