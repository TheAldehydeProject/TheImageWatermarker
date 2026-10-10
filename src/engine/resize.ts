import { createImage, type RGBAImage } from './image';

/** Size that fits inside maxW × maxH while keeping the aspect ratio (never enlarges). */
export function fitWithin(
  width: number,
  height: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const limitW = maxW > 0 ? maxW : Infinity;
  const limitH = maxH > 0 ? maxH : Infinity;
  const scale = Math.min(1, limitW / width, limitH / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const LANCZOS_A = 3;

function lanczos(x: number): number {
  if (x === 0) return 1;
  if (x <= -LANCZOS_A || x >= LANCZOS_A) return 0;
  const px = Math.PI * x;
  return (LANCZOS_A * Math.sin(px) * Math.sin(px / LANCZOS_A)) / (px * px);
}

interface Contrib {
  start: number;
  weights: Float32Array;
}

function contributions(srcSize: number, dstSize: number): Contrib[] {
  const scale = dstSize / srcSize;
  // When shrinking, widen the kernel so every source pixel contributes (anti-aliasing).
  const support = scale < 1 ? LANCZOS_A / scale : LANCZOS_A;
  const filterScale = scale < 1 ? scale : 1;
  const out: Contrib[] = [];
  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const start = Math.max(0, Math.floor(center - support));
    const end = Math.min(srcSize - 1, Math.ceil(center + support));
    const weights = new Float32Array(end - start + 1);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      const w = lanczos((j - center) * filterScale);
      weights[j - start] = w;
      sum += w;
    }
    for (let k = 0; k < weights.length; k++) weights[k] /= sum || 1;
    out.push({ start, weights });
  }
  return out;
}

/**
 * High-quality resize (separable Lanczos-3 on premultiplied alpha, so
 * transparent edges don't get dark fringes).
 */
export function resizeImage(img: RGBAImage, width: number, height: number): RGBAImage {
  if (width === img.width && height === img.height) return img;
  const sw = img.width;
  const sh = img.height;
  const src = img.data;

  // Horizontal pass on premultiplied values (computed on the fly to avoid
  // a full-size float copy of the source).
  const cx = contributions(sw, width);
  const tmp = new Float32Array(width * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      const { start, weights } = cx[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const p = (y * sw + start + k) * 4;
        const sa = src[p + 3];
        const w = weights[k];
        const wa = (w * sa) / 255;
        r += src[p] * wa;
        g += src[p + 1] * wa;
        b += src[p + 2] * wa;
        a += sa * w;
      }
      const o = (y * width + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  }

  // Vertical pass, then un-premultiply.
  const cy = contributions(sh, height);
  const out = createImage(width, height);
  const d = out.data;
  for (let y = 0; y < height; y++) {
    const { start, weights } = cy[y];
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < weights.length; k++) {
        const w = weights[k];
        const p = ((start + k) * width + x) * 4;
        r += tmp[p] * w;
        g += tmp[p + 1] * w;
        b += tmp[p + 2] * w;
        a += tmp[p + 3] * w;
      }
      const o = (y * width + x) * 4;
      const alpha = Math.min(255, Math.max(0, a));
      if (alpha <= 0) {
        d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
      } else {
        const inv = 255 / alpha;
        d[o] = r * inv;
        d[o + 1] = g * inv;
        d[o + 2] = b * inv;
        d[o + 3] = alpha;
      }
    }
  }
  return out;
}
