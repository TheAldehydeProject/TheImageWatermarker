import type { Mask } from './blend';

export type MotionBlurStyle = 'blur' | 'trail';

export interface MotionBlurOptions {
  /** Streak length in pixels. 0 disables the effect. */
  length: number;
  /** Direction of travel in degrees: 0 = moving right, 90 = moving down. */
  angle: number;
  /**
   * 'blur': the whole watermark is smeared along the direction of travel
   * (a true motion blur: coverage is averaged along the streak).
   * 'trail': the watermark stays sharp and leaves a streak behind it that
   * fades out with distance.
   */
  style: MotionBlurStyle;
}

export interface BlurredMask {
  mask: Mask;
  /** Where the original mask's (0, 0) ended up inside the padded result. */
  offsetX: number;
  offsetY: number;
}

/** Maximum number of samples taken along the streak, to bound the cost. */
const MAX_SAMPLES = 96;
/** Strength of the trail right behind the watermark; it fades to 0 at the end. */
export const TRAIL_STRENGTH = 0.6;

function sampleBilinear(m: Mask, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) =>
    xx < 0 || yy < 0 || xx >= m.width || yy >= m.height ? 0 : m.data[yy * m.width + xx];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Applies a linear motion effect to a coverage mask. The result is padded so
 * the streak is never clipped.
 */
export function motionBlurMask(src: Mask, opts: MotionBlurOptions): BlurredMask {
  const length = Math.max(0, opts.length);
  if (length < 0.5) {
    return { mask: src, offsetX: 0, offsetY: 0 };
  }
  const rad = (opts.angle * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const pad = Math.ceil(length) + 1;
  const width = src.width + pad * 2;
  const height = src.height + pad * 2;
  const out = new Float32Array(width * height);
  const samples = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(length) + 1));

  for (let y = 0; y < height; y++) {
    const sy = y - pad;
    for (let x = 0; x < width; x++) {
      const sx = x - pad;
      let v: number;
      if (opts.style === 'blur') {
        // Average of the watermark over a window centred on this pixel.
        let acc = 0;
        for (let i = 0; i < samples; i++) {
          const t = (i / (samples - 1) - 0.5) * length;
          acc += sampleBilinear(src, sx + ux * t, sy + uy * t);
        }
        v = acc / samples;
      } else {
        // A pixel `t` behind the watermark shows it, fading with distance.
        let trail = 0;
        for (let i = 1; i < samples; i++) {
          const f = i / (samples - 1);
          const t = f * length;
          const c = sampleBilinear(src, sx + ux * t, sy + uy * t) * (1 - f);
          if (c > trail) trail = c;
        }
        trail *= TRAIL_STRENGTH;
        const inside = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height;
        const sharp = inside ? src.data[sy * src.width + sx] : 0;
        v = sharp + trail * (1 - sharp);
      }
      out[y * width + x] = v;
    }
  }
  return { mask: { width, height, data: out }, offsetX: pad, offsetY: pad };
}
