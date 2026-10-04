import type { RGBAImage } from './image';

/** A single-channel coverage mask (0 = transparent, 1 = fully covered). */
export interface Mask {
  width: number;
  height: number;
  data: Float32Array;
}

export type BlendMode =
  | 'normal'
  | 'dissolve'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'grain-extract'
  | 'grain-merge'
  | 'average'
  | 'negation'
  | 'reflect'
  | 'glow'
  | 'freeze'
  | 'heat'
  | 'phoenix';

export interface BlendModeInfo {
  id: BlendMode;
  label: string;
}

export const BLEND_MODE_GROUPS: { label: string; modes: BlendModeInfo[] }[] = [
  {
    label: 'Normal',
    modes: [
      { id: 'normal', label: 'Normal' },
      { id: 'dissolve', label: 'Dissolve' },
    ],
  },
  {
    label: 'Darken',
    modes: [
      { id: 'darken', label: 'Darken' },
      { id: 'multiply', label: 'Multiply' },
      { id: 'color-burn', label: 'Color Burn' },
      { id: 'linear-burn', label: 'Linear Burn' },
      { id: 'darker-color', label: 'Darker Color' },
    ],
  },
  {
    label: 'Lighten',
    modes: [
      { id: 'lighten', label: 'Lighten' },
      { id: 'screen', label: 'Screen' },
      { id: 'color-dodge', label: 'Color Dodge' },
      { id: 'linear-dodge', label: 'Linear Dodge (Add)' },
      { id: 'lighter-color', label: 'Lighter Color' },
    ],
  },
  {
    label: 'Contrast',
    modes: [
      { id: 'overlay', label: 'Overlay' },
      { id: 'soft-light', label: 'Soft Light' },
      { id: 'hard-light', label: 'Hard Light' },
      { id: 'vivid-light', label: 'Vivid Light' },
      { id: 'linear-light', label: 'Linear Light' },
      { id: 'pin-light', label: 'Pin Light' },
      { id: 'hard-mix', label: 'Hard Mix' },
    ],
  },
  {
    label: 'Inversion',
    modes: [
      { id: 'difference', label: 'Difference' },
      { id: 'exclusion', label: 'Exclusion' },
      { id: 'subtract', label: 'Subtract' },
      { id: 'divide', label: 'Divide' },
    ],
  },
  {
    label: 'Component',
    modes: [
      { id: 'hue', label: 'Hue' },
      { id: 'saturation', label: 'Saturation' },
      { id: 'color', label: 'Color' },
      { id: 'luminosity', label: 'Luminosity' },
    ],
  },
  {
    label: 'Extra',
    modes: [
      { id: 'grain-extract', label: 'Grain Extract' },
      { id: 'grain-merge', label: 'Grain Merge' },
      { id: 'average', label: 'Average' },
      { id: 'negation', label: 'Negation' },
      { id: 'reflect', label: 'Reflect' },
      { id: 'glow', label: 'Glow' },
      { id: 'freeze', label: 'Freeze' },
      { id: 'heat', label: 'Heat' },
      { id: 'phoenix', label: 'Phoenix' },
    ],
  },
];

export const BLEND_MODES: BlendModeInfo[] = BLEND_MODE_GROUPS.flatMap((g) => g.modes);

export function isBlendMode(value: unknown): value is BlendMode {
  return BLEND_MODES.some((m) => m.id === value);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Separable blend functions. `b` is the backdrop (photo), `s` is the source
// (watermark); both are 0..1. Formulas follow the W3C Compositing spec where
// it defines a mode, and the usual Photoshop/GIMP definitions otherwise.
const multiply = (b: number, s: number) => b * s;
const screen = (b: number, s: number) => b + s - b * s;
const colorBurn = (b: number, s: number) => {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
};
const colorDodge = (b: number, s: number) => {
  if (b <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
};
const hardLight = (b: number, s: number) => (s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1));
const softLight = (b: number, s: number) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};
const vividLight = (b: number, s: number) =>
  s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5));

type Separable = (b: number, s: number) => number;

const SEPARABLE: Partial<Record<BlendMode, Separable>> = {
  normal: (_b, s) => s,
  darken: Math.min,
  multiply,
  'color-burn': colorBurn,
  'linear-burn': (b, s) => Math.max(0, b + s - 1),
  lighten: Math.max,
  screen,
  'color-dodge': colorDodge,
  'linear-dodge': (b, s) => Math.min(1, b + s),
  overlay: (b, s) => hardLight(s, b),
  'soft-light': softLight,
  'hard-light': hardLight,
  'vivid-light': vividLight,
  'linear-light': (b, s) => clamp01(b + 2 * s - 1),
  'pin-light': (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s)),
  'grain-extract': (b, s) => clamp01(b - s + 0.5),
  'grain-merge': (b, s) => clamp01(b + s - 0.5),
  average: (b, s) => (b + s) / 2,
  negation: (b, s) => 1 - Math.abs(1 - b - s),
  reflect: (b, s) => (s >= 1 ? 1 : Math.min(1, (b * b) / (1 - s))),
  glow: (b, s) => (b >= 1 ? 1 : Math.min(1, (s * s) / (1 - b))),
  freeze: (b, s) => (s <= 0 ? 0 : 1 - Math.min(1, ((1 - b) * (1 - b)) / s)),
  heat: (b, s) => (b <= 0 ? 0 : 1 - Math.min(1, ((1 - s) * (1 - s)) / b)),
  phoenix: (b, s) => Math.min(b, s) - Math.max(b, s) + 1,
};

// Non-separable helpers from the W3C Compositing spec.
type RGB = [number, number, number];
const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let r = c[0];
  let g = c[1];
  let b = c[2];
  if (n < 0) {
    r = l + ((r - l) * l) / (l - n);
    g = l + ((g - l) * l) / (l - n);
    b = l + ((b - l) * l) / (l - n);
  }
  if (x > 1) {
    r = l + ((r - l) * (1 - l)) / (x - l);
    g = l + ((g - l) * (1 - l)) / (x - l);
    b = l + ((b - l) * (1 - l)) / (x - l);
  }
  return [r, g, b];
}
function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}
const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c: RGB, s: number): RGB {
  const out: RGB = [0, 0, 0];
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [iMin, iMid, iMax] = idx;
  if (c[iMax] > c[iMin]) {
    out[iMid] = ((c[iMid] - c[iMin]) * s) / (c[iMax] - c[iMin]);
    out[iMax] = s;
  }
  out[iMin] = 0;
  return out;
}

/** Blends one source colour onto one backdrop colour (alpha handled elsewhere). */
export function blendColor(mode: BlendMode, b: RGB, s: RGB): RGB {
  const fn = SEPARABLE[mode];
  if (fn) return [fn(b[0], s[0]), fn(b[1], s[1]), fn(b[2], s[2])];
  switch (mode) {
    case 'hue':
      return setLum(setSat(s, sat(b)), lum(b));
    case 'saturation':
      return setLum(setSat(b, sat(s)), lum(b));
    case 'color':
      return setLum(s, lum(b));
    case 'luminosity':
      return setLum(b, lum(s));
    case 'darker-color':
      return lum(s) < lum(b) ? s : b;
    case 'lighter-color':
      return lum(s) > lum(b) ? s : b;
    default:
      // 'dissolve' picks pixels rather than mixing colours.
      return s;
  }
}

/** Deterministic per-pixel noise in [0, 1) used by Dissolve. */
export function dissolveNoise(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface CompositeOptions {
  /** Top-left position of the mask on the image, in pixels. May be negative. */
  x: number;
  y: number;
  /** Watermark colour, 0..255 per channel. */
  color: [number, number, number];
  /** 0..1 */
  opacity: number;
  mode: BlendMode;
}

/**
 * Paints a solid-colour mask onto an image in place using a blend mode.
 * Implements the W3C general compositing formula (source-over with blending),
 * so transparent images are handled correctly too.
 */
export function compositeMask(img: RGBAImage, mask: Mask, opts: CompositeOptions): void {
  const { x: ox, y: oy, opacity, mode } = opts;
  const cs: RGB = [opts.color[0] / 255, opts.color[1] / 255, opts.color[2] / 255];
  const d = img.data;
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(img.width, ox + mask.width);
  const y1 = Math.min(img.height, oy + mask.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const m = mask.data[(y - oy) * mask.width + (x - ox)];
      let as = m * opacity;
      if (as <= 0) continue;
      if (mode === 'dissolve') as = dissolveNoise(x, y) < as ? 1 : 0;
      if (as <= 0) continue;
      const i = (y * img.width + x) * 4;
      const ab = d[i + 3] / 255;
      const cb: RGB = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
      const mixed = blendColor(mode, cb, cs);
      const ao = as + ab * (1 - as);
      for (let c = 0; c < 3; c++) {
        const co = as * (1 - ab) * cs[c] + as * ab * mixed[c] + (1 - as) * ab * cb[c];
        d[i + c] = Math.round(clamp01(co / ao) * 255);
      }
      d[i + 3] = Math.round(ao * 255);
    }
  }
}
