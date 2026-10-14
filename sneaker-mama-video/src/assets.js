// Product photos (cut out of their studio backgrounds by tools/cutout.py).
export const IMG = {};

const FILES = {
  foam: 'foam',
  brush: 'brush',
  sole: 'sole',
  sneaker: 'sneaker',
  sprayAntibac: 'spray-antibac',
  sprayWater: 'spray-water',
};

export function loadAssets(base = new URL('../assets/photos/', import.meta.url)) {
  return Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const img = new Image();
      img.src = new URL(file + '.webp', base).href;
      await img.decode();
      IMG[key] = img;
    }),
  );
}
