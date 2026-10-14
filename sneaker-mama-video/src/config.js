// Global constants for the SNEAKER MAMA motion piece.
export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const DURATION = 23;
export const TOTAL_FRAMES = FPS * DURATION;
export const SAMPLE_RATE = 48000;

export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const BAR = BEAT * 4; // 2 s

// Scene boundaries (each one lands on a bar downbeat).
export const CUTS = [3, 7, 11, 15, 19];
export const WIPE = 0.6; // full wipe length, centred on the cut

export const C = {
  bg: '#F7DDE2',
  spot: '#FCEEF1',
  ink: '#1A1416',
  ink2: '#6E5A60',
  accent: '#D6336C',
  // deeper crimson for text on the pink background (WCAG >= 4.5:1)
  accentText: '#B8245A',
  cream: '#FFFFFF',
  water: '#3E9BD6',
  shadow: 'rgba(140, 92, 108, ',
  dirt: ['#7A5234', '#8B6140', '#6B4630'],
  germ: '#7E8C34',
  germDark: '#56611F',
};

export const FONT = '"Inter Display", "Inter", "SF Pro Display", -apple-system, "Helvetica Neue", Arial, sans-serif';

// Reels safe zone for important text.
export const SAFE_TOP = 150;
export const SAFE_BOTTOM = H - 250;
