/**
 * Finds the best settings for a file-size target: the highest quality that
 * fits, and only if even the lowest allowed quality is too big, the largest
 * dimensions that fit at that quality.
 */

export interface FitAttempt<T> {
  quality: number;
  /** 1 = full size; 0.5 = half the width and height. */
  scale: number;
  size: number;
  value: T;
}

export interface FitResult<T> {
  best: FitAttempt<T>;
  /** False when even the smallest version tried is over the target. */
  fits: boolean;
  attempts: number;
}

export interface FitOptions {
  /** Lowest and highest quality to consider (whole numbers). */
  minQuality: number;
  maxQuality: number;
  /** Smallest scale allowed, e.g. so the image keeps at least 16 pixels. */
  minScale: number;
  /** Called before each try, counting from 1. */
  onAttempt?: (n: number) => void;
  /** Tries at full size before giving up on finding the exact best quality. */
  maxQualityTries?: number;
  /** Tries at smaller sizes. */
  maxScaleTries?: number;
  /**
   * Typical file size at each quality for an image like this one. It guides
   * the first try and the step size; the real sizes decide the result.
   */
  typicalSize?: (quality: number) => number;
}

/** A result this close under the target is good enough to stop searching. */
const CLOSE_ENOUGH = 0.95;
/** Typical growth of file size per quality step (log scale), used without a size curve. */
const SLOPE = 0.035;

export async function fitToSize<T>(
  target: number,
  encode: (quality: number, scale: number) => Promise<{ size: number; value: T }>,
  o: FitOptions,
): Promise<FitResult<T>> {
  let attempts = 0;
  const tryOne = async (quality: number, scale: number): Promise<FitAttempt<T>> => {
    attempts++;
    o.onAttempt?.(attempts);
    const r = await encode(quality, scale);
    return { quality, scale, size: r.size, value: r.value };
  };
  const fits = (a: FitAttempt<T>) => a.size <= target;

  // 1. Highest quality that fits at full size. `lo` is the best that fits so
  //    far, `hi` the lowest quality known to be too big.
  let lo: FitAttempt<T> | null = null;
  let hi: FitAttempt<T> | null = null;
  const { minQuality: min, maxQuality: max } = o;
  let q = o.typicalSize
    ? highestFitting(min, max, target, o.typicalSize)
    : Math.round(Math.min(max, Math.max(min, min + (max - min) * 0.75)));
  for (let i = 0; i < (o.maxQualityTries ?? 8); i++) {
    const a = await tryOne(q, 1);
    if (fits(a)) {
      if (!lo || a.quality > lo.quality) lo = a;
    } else if (!hi || a.quality < hi.quality) {
      hi = a;
    }
    if (lo && (lo.quality >= max || lo.size >= target * CLOSE_ENOUGH)) break;
    if (lo && hi && hi.quality - lo.quality <= 1) break;
    if (hi && hi.quality <= min) break;
    q = nextQuality(target, lo, hi, min, max, o.typicalSize);
  }
  if (lo) return { best: lo, fits: true, attempts };

  // 2. Even the lowest quality is too big: shrink, keeping as many pixels as fit.
  let big = hi && hi.quality <= min ? hi : await tryOne(min, 1);
  if (fits(big)) return { best: big, fits: true, attempts };
  let small: FitAttempt<T> | null = null;
  let smallest = big;
  let scale = big.scale;
  for (let i = 0; i < (o.maxScaleTries ?? 6); i++) {
    // File size grows roughly with the number of pixels, i.e. with scale².
    const from = small ?? big;
    let next = from.scale * Math.sqrt(target / from.size) * (small ? 0.99 : 0.95);
    if (small) next = Math.min(next, (small.scale + big.scale) / 2);
    else next = Math.min(next, big.scale * 0.95);
    next = Math.max(o.minScale, next);
    if (Math.abs(next - scale) < 0.005 || (small && next <= small.scale)) break;
    scale = next;
    const a = await tryOne(min, scale);
    if (a.size < smallest.size) smallest = a;
    if (fits(a)) {
      if (!small || a.scale > small.scale) small = a;
      if (a.size >= target * 0.9) break;
    } else {
      big = a;
      if (scale <= o.minScale) break;
    }
  }
  return small ? { best: small, fits: true, attempts } : { best: smallest, fits: false, attempts };
}

/** The highest quality in a range whose predicted size fits (or the lowest, if none does). */
function highestFitting(
  min: number,
  max: number,
  target: number,
  size: (quality: number) => number,
): number {
  for (let q = max; q > min; q--) if (size(q) <= target) return q;
  return min;
}

/** Picks the next quality to try, interpolating file sizes on a log scale. */
function nextQuality<T>(
  target: number,
  lo: FitAttempt<T> | null,
  hi: FitAttempt<T> | null,
  min: number,
  max: number,
  typical?: (quality: number) => number,
): number {
  if (lo && hi) {
    const t = (Math.log(target) - Math.log(lo.size)) / (Math.log(hi.size) - Math.log(lo.size));
    const q = lo.quality + (Number.isFinite(t) ? t : 0.5) * (hi.quality - lo.quality);
    // Stay strictly between the two, so every try narrows the range.
    return Math.min(hi.quality - 1, Math.max(lo.quality + 1, Math.round(q)));
  }
  const known = (lo ?? hi)!;
  // Scale the typical curve to the size actually measured, or assume a
  // steady growth per quality step without one.
  const predict = typical
    ? (q: number) => (known.size * typical(q)) / typical(known.quality)
    : (q: number) => known.size * Math.exp(SLOPE * (q - known.quality));
  return lo
    ? Math.max(lo.quality + 1, highestFitting(lo.quality, max, target, predict))
    : Math.min(hi!.quality - 1, highestFitting(min, hi!.quality, target, predict));
}
