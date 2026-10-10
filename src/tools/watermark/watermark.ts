import { compositeMask, isBlendMode, type BlendMode, type Mask } from './blend';
import type { RGBAImage } from '../../engine/image';
import {
  CLASSIC_LABELS,
  moleculeGeometry,
  placeBox,
  POSITIONS,
  sanitizeLabel,
  type AtomLabels,
  type MeasureLabel,
  type MoleculeGeometry,
  type MoleculeLayout,
  type WatermarkPosition,
} from './molecule';
import { motionBlurMask, type MotionBlurStyle } from './motionBlur';

export type WatermarkVariant = 'classic' | 'custom';
export type ColorMode = 'auto' | 'white' | 'black' | 'custom';

export interface MotionSettings {
  enabled: boolean;
  /** Streak length as a percentage of 3 bond lengths (0–100). */
  amount: number;
  /** Direction of travel in degrees (0 = right, 90 = down). */
  angle: number;
  style: MotionBlurStyle;
}

export interface WatermarkSettings {
  variant: WatermarkVariant;
  /** Letters used when `variant` is 'custom'. */
  customLabels: AtomLabels;
  layout: MoleculeLayout;
  /** Bond length as a percentage of the image's shorter side. */
  size: number;
  /** 0–100 */
  opacity: number;
  colorMode: ColorMode;
  /** '#rrggbb', used when colorMode is 'custom'. */
  customColor: string;
  /** Distance from the edge as a percentage of the image's shorter side. */
  margin: number;
  position: WatermarkPosition;
  blendMode: BlendMode;
  motion: MotionSettings;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  variant: 'classic',
  customLabels: { ...CLASSIC_LABELS },
  layout: 'horizontal',
  size: 4,
  opacity: 55,
  colorMode: 'auto',
  customColor: '#ffffff',
  margin: 3,
  position: 'bottom-right',
  blendMode: 'normal',
  motion: { enabled: false, amount: 35, angle: 0, style: 'trail' },
};

export const LIMITS = {
  size: { min: 1, max: 20 },
  opacity: { min: 5, max: 100 },
  margin: { min: 0, max: 20 },
  amount: { min: 0, max: 100 },
  angle: { min: 0, max: 359 },
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Validates settings loaded from storage, filling gaps with defaults. */
export function normalizeWatermark(input: unknown): WatermarkSettings {
  const d = DEFAULT_WATERMARK;
  const s = (input && typeof input === 'object' ? input : {}) as Partial<WatermarkSettings>;
  const labels = (s.customLabels ?? {}) as Partial<AtomLabels>;
  const motion = (s.motion ?? {}) as Partial<MotionSettings>;
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  return {
    variant: s.variant === 'custom' ? 'custom' : 'classic',
    customLabels: {
      o: sanitizeLabel(str(labels.o, 'O'), 'O'),
      c: sanitizeLabel(str(labels.c, 'C'), 'C'),
      h1: sanitizeLabel(str(labels.h1, 'H'), 'H'),
      h2: sanitizeLabel(str(labels.h2, 'H'), 'H'),
    },
    layout: s.layout === 'vertical' ? 'vertical' : 'horizontal',
    size: clamp(s.size, LIMITS.size.min, LIMITS.size.max, d.size),
    opacity: clamp(s.opacity, LIMITS.opacity.min, LIMITS.opacity.max, d.opacity),
    colorMode: (['auto', 'white', 'black', 'custom'] as const).includes(s.colorMode as ColorMode)
      ? (s.colorMode as ColorMode)
      : d.colorMode,
    customColor: /^#[0-9a-f]{6}$/i.test(str(s.customColor, '')) ? s.customColor! : d.customColor,
    margin: clamp(s.margin, LIMITS.margin.min, LIMITS.margin.max, d.margin),
    position: POSITIONS.includes(s.position as WatermarkPosition)
      ? (s.position as WatermarkPosition)
      : d.position,
    blendMode: isBlendMode(s.blendMode) ? s.blendMode : d.blendMode,
    motion: {
      enabled: motion.enabled === true,
      amount: clamp(motion.amount, LIMITS.amount.min, LIMITS.amount.max, d.motion.amount),
      angle: clamp(motion.angle, LIMITS.angle.min, LIMITS.angle.max, d.motion.angle),
      style: motion.style === 'blur' ? 'blur' : 'trail',
    },
  };
}

export function activeLabels(s: WatermarkSettings): AtomLabels {
  return s.variant === 'custom' ? s.customLabels : CLASSIC_LABELS;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface WatermarkPlacement {
  geometry: MoleculeGeometry;
  bondLength: number;
  /** Integer pixel position of the mask's top-left corner on the image. */
  x: number;
  y: number;
  /** Mask size; the geometry is drawn translated by (-originX, -originY). */
  width: number;
  height: number;
  originX: number;
  originY: number;
  /** Motion streak length in pixels (0 when off). */
  motionLength: number;
}

/** A little space around the drawing so anti-aliased edges are not clipped. */
const MASK_PADDING = 2;

export function placeWatermark(
  imageW: number,
  imageH: number,
  s: WatermarkSettings,
  measure: MeasureLabel,
): WatermarkPlacement {
  const short = Math.min(imageW, imageH);
  const bondLength = Math.max(4, (short * s.size) / 100);
  const geometry = moleculeGeometry(s.layout, activeLabels(s), bondLength, measure);
  const b = geometry.bounds;
  const drawW = b.x2 - b.x1;
  const drawH = b.y2 - b.y1;
  const margin = (short * s.margin) / 100;
  const pos = placeBox(imageW, imageH, drawW, drawH, margin, s.position);
  const x = Math.round(pos.x) - MASK_PADDING;
  const y = Math.round(pos.y) - MASK_PADDING;
  return {
    geometry,
    bondLength,
    x,
    y,
    width: Math.ceil(drawW) + MASK_PADDING * 2,
    height: Math.ceil(drawH) + MASK_PADDING * 2,
    originX: b.x1 - MASK_PADDING,
    originY: b.y1 - MASK_PADDING,
    motionLength: s.motion.enabled ? (s.motion.amount / 100) * 3 * bondLength : 0,
  };
}

/** Relative luminance (0..1) of the image under the mask, weighted by coverage. */
export function luminanceUnder(img: RGBAImage, mask: Mask, ox: number, oy: number): number {
  let acc = 0;
  let weight = 0;
  for (let my = 0; my < mask.height; my++) {
    const y = oy + my;
    if (y < 0 || y >= img.height) continue;
    for (let mx = 0; mx < mask.width; mx++) {
      const x = ox + mx;
      if (x < 0 || x >= img.width) continue;
      const m = mask.data[my * mask.width + mx];
      if (m <= 0) continue;
      const i = (y * img.width + x) * 4;
      const l = (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]) / 255;
      acc += l * m;
      weight += m;
    }
  }
  return weight > 0 ? acc / weight : 0.5;
}

export function resolveColor(
  s: WatermarkSettings,
  backgroundLuminance: number,
): [number, number, number] {
  switch (s.colorMode) {
    case 'white':
      return [255, 255, 255];
    case 'black':
      return [0, 0, 0];
    case 'custom':
      return hexToRgb(s.customColor);
    default:
      return backgroundLuminance < 0.5 ? [255, 255, 255] : [0, 0, 0];
  }
}

/**
 * Draws the watermark onto `img` (in place). `rasterize` turns the
 * molecule geometry into a coverage mask; it is injected so this logic can
 * be shared by the browser renderer and the unit tests.
 */
export function applyWatermark(
  img: RGBAImage,
  s: WatermarkSettings,
  measure: MeasureLabel,
  rasterize: (p: WatermarkPlacement) => Mask,
): WatermarkPlacement {
  const placement = placeWatermark(img.width, img.height, s, measure);
  const sharp = rasterize(placement);
  const color = resolveColor(s, luminanceUnder(img, sharp, placement.x, placement.y));
  const blurred = motionBlurMask(sharp, {
    length: placement.motionLength,
    angle: s.motion.angle,
    style: s.motion.style,
  });
  compositeMask(img, blurred.mask, {
    x: placement.x - blurred.offsetX,
    y: placement.y - blurred.offsetY,
    color,
    opacity: s.opacity / 100,
    mode: s.blendMode,
  });
  return placement;
}
