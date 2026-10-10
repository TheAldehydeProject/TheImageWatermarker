import { describe, expect, it } from 'vitest';
import { fitToSize } from '../../src/engine/fitSize';

/** A stand-in encoder: size grows exponentially with quality and with the pixel count. */
const model =
  (base = 1000, slope = 0.04, noise = 0) =>
  async (quality: number, scale: number) => {
    const wobble = noise ? 1 + noise * Math.sin(quality * 12.9898 + scale * 78.233) : 1;
    return {
      size: Math.round(base * Math.exp(slope * quality) * scale * scale * wobble),
      value: null,
    };
  };

const opts = { minQuality: 40, maxQuality: 100, minScale: 0.05 };

describe('fitToSize', () => {
  it('finds the highest quality that fits, in a few tries', async () => {
    for (const target of [12_000, 20_000, 33_333, 45_000]) {
      const r = await fitToSize(target, model(), opts);
      const best = Math.floor(Math.log(target / 1000) / 0.04);
      expect(r.fits).toBe(true);
      expect(r.best.scale).toBe(1);
      expect(r.best.size).toBeLessThanOrEqual(target);
      // The best quality, or one using all but the last few percent of the target.
      expect(r.best.quality, `target ${target}`).toBeLessThanOrEqual(best);
      expect(r.best.quality === best || r.best.size >= target * 0.95).toBe(true);
      expect(r.attempts).toBeLessThanOrEqual(6);
    }
  });

  it('uses the top quality straight away when there is room', async () => {
    const r = await fitToSize(10_000_000, model(), opts);
    expect(r.best.quality).toBe(100);
    expect(r.attempts).toBeLessThanOrEqual(2);
  });

  it('only shrinks the image when the lowest quality is still too big', async () => {
    // Quality 40 at full size is 4953 bytes.
    const target = 2000;
    const r = await fitToSize(target, model(), opts);
    expect(r.fits).toBe(true);
    expect(r.best.quality).toBe(40);
    expect(r.best.scale).toBeLessThan(1);
    expect(r.best.size).toBeLessThanOrEqual(target);
    // Keeps as many pixels as the target allows.
    expect(r.best.size).toBeGreaterThan(target * 0.85);
    expect(r.best.scale).toBeGreaterThan(Math.sqrt(target / 4953) * 0.9);
    expect(r.attempts).toBeLessThanOrEqual(10);
  });

  it('returns the smallest version when the target cannot be reached', async () => {
    const r = await fitToSize(1, model(), opts);
    expect(r.fits).toBe(false);
    expect(r.best.quality).toBe(40);
    expect(r.best.scale).toBe(0.05);
  });

  it('handles formats with only two levels (PNG: lossless or 256 colours)', async () => {
    const png = async (level: number, scale: number) => ({
      size: (level === 1 ? 50_000 : 20_000) * scale * scale,
      value: level,
    });
    const o = { minQuality: 0, maxQuality: 1, minScale: 0.1 };
    expect((await fitToSize(60_000, png, o)).best).toMatchObject({ quality: 1, scale: 1 });
    expect((await fitToSize(30_000, png, o)).best).toMatchObject({ quality: 0, scale: 1 });
    const shrunk = await fitToSize(5_000, png, o);
    expect(shrunk.best.quality).toBe(0);
    expect(shrunk.best.scale).toBeLessThan(1);
    expect(shrunk.best.size).toBeLessThanOrEqual(5_000);
  });

  it('always returns a version that fits, even when sizes are uneven', async () => {
    for (const target of [9_000, 15_000, 27_000, 2_500]) {
      const r = await fitToSize(target, model(1000, 0.04, 0.06), opts);
      expect(r.fits).toBe(true);
      expect(r.best.size).toBeLessThanOrEqual(target);
    }
  });

  it('needs fewer tries when it knows the typical size curve', async () => {
    // Flat at low qualities, steep at high ones (like WebP), and this image
    // happens to be 1.8 times bigger than typical.
    const curve = (q: number) => 1000 * (1 + Math.exp(0.08 * (q - 60)));
    const encode = async (q: number, scale: number) => ({
      size: 1.8 * curve(q) * scale * scale,
      value: null,
    });
    for (const target of [3_900, 4_500, 6_000, 20_000]) {
      const plain = await fitToSize(target, encode, opts);
      const guided = await fitToSize(target, encode, { ...opts, typicalSize: curve });
      expect(guided.best.size).toBeLessThanOrEqual(target);
      expect(guided.best.quality).toBeGreaterThanOrEqual(plain.best.quality - 1);
      expect(guided.attempts, `target ${target}`).toBeLessThanOrEqual(4);
      expect(guided.attempts).toBeLessThanOrEqual(plain.attempts);
    }
  });

  it('skips slow full-size tries when even the lowest quality is far too big', async () => {
    const curve = (q: number) => 1000 * Math.exp(0.04 * q);
    const scales: number[] = [];
    const encode = async (q: number, scale: number) => {
      scales.push(scale);
      return { size: curve(q) * scale * scale, value: null };
    };
    // At the lowest quality the full-size file would be about 20 times the target.
    const target = curve(40) / 20;
    const r = await fitToSize(target, encode, { ...opts, typicalSize: curve });
    expect(r.fits).toBe(true);
    expect(r.best.quality).toBe(40);
    expect(r.best.size).toBeLessThanOrEqual(target);
    expect(scales).not.toContain(1);
    expect(r.attempts).toBeLessThanOrEqual(4);
  });

  it('still keeps the full size when an image is far simpler than a typical one', async () => {
    const typical = (q: number) => 1000 * Math.exp(0.04 * q);
    // This image is 30 times smaller than typical: quality 40 fits at full size.
    const encode = async (q: number, scale: number) => ({
      size: (typical(q) / 30) * scale * scale,
      value: null,
    });
    const target = typical(40) / 20;
    const r = await fitToSize(target, encode, { ...opts, typicalSize: typical });
    expect(r.fits).toBe(true);
    expect(r.best.scale).toBe(1);
    expect(r.best.quality).toBeGreaterThan(40);
  });

  it('measures the full size when shrinking turns out not to be needed', async () => {
    const typical = (q: number) => 1000 * Math.exp(0.04 * q);
    // Five times simpler than typical at full size, and (as in real images)
    // smaller copies cost relatively more bytes per pixel.
    const encode = async (q: number, scale: number) => ({
      size: (typical(q) / 5) * scale ** 1.6,
      value: null,
    });
    const target = typical(40) / 4.5;
    const r = await fitToSize(target, encode, { ...opts, typicalSize: typical });
    expect(r.fits).toBe(true);
    expect(r.best.scale).toBe(1);
    expect(r.best.quality).toBeGreaterThanOrEqual(41);
    expect(r.best.size).toBeLessThanOrEqual(target);
  });

  it('can be told to get closer to the target before stopping', async () => {
    // Sizes grow only 1% per quality step, so "within 5%" stops several steps early.
    const r = await fitToSize(2000, model(1000, 0.01), { ...opts, closeEnough: 0.995 });
    expect(r.best.quality).toBe(Math.floor(Math.log(2) / 0.01));
    expect(r.best.size).toBeLessThanOrEqual(2000);
  });

  it('reports every try', async () => {
    const seen: number[] = [];
    const r = await fitToSize(20_000, model(), { ...opts, onAttempt: (n) => seen.push(n) });
    expect(seen).toEqual(Array.from({ length: r.attempts }, (_, i) => i + 1));
  });
});
