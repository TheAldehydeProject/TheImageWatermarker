import { describe, expect, it } from 'vitest';
import UTIF from 'utif2';
import { applyOrientation, createImage, hasTransparency, toRGBA } from '../../src/engine/image';
import { quantize } from '../../src/engine/quantize';
import { fitWithin, resizeImage } from '../../src/engine/resize';
import { encodeTiff } from '../../src/engine/tiff';
import { maxChannelDiff, photoLike, solid, uniqueColors } from '../helpers';

describe('applyOrientation', () => {
  // A 3×2 image whose pixels are numbered 0..5 in the red channel.
  const numbered = () => {
    const img = createImage(3, 2);
    for (let i = 0; i < 6; i++) img.data.set([i, 0, 0, 255], i * 4);
    return img;
  };
  const reds = (img: ReturnType<typeof createImage>) => {
    const out: number[] = [];
    for (let i = 0; i < img.width * img.height; i++) out.push(img.data[i * 4]);
    return out;
  };

  it('handles all eight EXIF orientations', () => {
    // Expected upright pixel order for each orientation tag.
    const expected: Record<number, { w: number; order: number[] }> = {
      1: { w: 3, order: [0, 1, 2, 3, 4, 5] },
      2: { w: 3, order: [2, 1, 0, 5, 4, 3] },
      3: { w: 3, order: [5, 4, 3, 2, 1, 0] },
      4: { w: 3, order: [3, 4, 5, 0, 1, 2] },
      5: { w: 2, order: [0, 3, 1, 4, 2, 5] },
      6: { w: 2, order: [3, 0, 4, 1, 5, 2] },
      7: { w: 2, order: [5, 2, 4, 1, 3, 0] },
      8: { w: 2, order: [2, 5, 1, 4, 0, 3] },
    };
    for (const [o, e] of Object.entries(expected)) {
      const out = applyOrientation(numbered(), Number(o));
      expect(out.width, `orientation ${o}`).toBe(e.w);
      expect(reds(out), `orientation ${o}`).toEqual(e.order);
    }
  });
});

describe('image helpers', () => {
  it('toRGBA expands grey and RGB', () => {
    expect(Array.from(toRGBA([7], 1, 1, 1).data)).toEqual([7, 7, 7, 255]);
    expect(Array.from(toRGBA([1, 2, 3], 1, 1, 3).data)).toEqual([1, 2, 3, 255]);
  });

  it('hasTransparency', () => {
    expect(hasTransparency(solid(2, 2, [0, 0, 0, 255]))).toBe(false);
    expect(hasTransparency(solid(2, 2, [0, 0, 0, 254]))).toBe(true);
  });
});

describe('TIFF encoder', () => {
  for (const alpha of [false, true]) {
    it(`round-trips ${alpha ? 'RGBA' : 'RGB'} pixels exactly`, () => {
      const img = photoLike(57, 33, 11, alpha);
      const tiff = encodeTiff(img, new Uint8Array([1, 2, 3, 4, 5]));
      const buf = tiff.slice().buffer;
      const [ifd] = UTIF.decode(buf);
      UTIF.decodeImage(buf, ifd);
      const rgba = UTIF.toRGBA8(ifd);
      expect([ifd.width, ifd.height]).toEqual([57, 33]);
      expect(
        maxChannelDiff(img, { width: 57, height: 33, data: new Uint8ClampedArray(rgba) }),
      ).toBe(0);
      expect(Array.from(ifd.t34675 as number[])).toEqual([1, 2, 3, 4, 5]);
      expect((ifd.t259 as number[])[0]).toBe(8); // Deflate
    });
  }

  it('compresses smooth images well', () => {
    const img = solid(200, 200, [10, 120, 200, 255]);
    expect(encodeTiff(img).length).toBeLessThan(2000);
  });
});

describe('resize', () => {
  it('fitWithin keeps the aspect ratio and never enlarges', () => {
    expect(fitWithin(4000, 3000, 2000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(4000, 3000, 0, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(400, 300, 2000, 2000)).toEqual({ width: 400, height: 300 });
  });

  it('keeps flat colours flat and has no dark fringes on transparent edges', () => {
    const img = solid(64, 48, [200, 100, 50, 255]);
    const small = resizeImage(img, 17, 13);
    expect([small.width, small.height]).toEqual([17, 13]);
    expect(maxChannelDiff(small, solid(17, 13, [200, 100, 50, 255]))).toBeLessThanOrEqual(1);

    const half = createImage(40, 40);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 20; x++) half.data.set([255, 255, 255, 255], (y * 40 + x) * 4);
    const out = resizeImage(half, 10, 10);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] > 10) expect(out.data[i]).toBeGreaterThan(240);
    }
  });
});

describe('quantize', () => {
  it('returns images that already fit unchanged', () => {
    const img = solid(10, 10, [1, 2, 3, 255]);
    expect(quantize(img)).toBe(img);
  });

  it('reduces to at most 256 colours while staying close to the original', () => {
    const img = photoLike(120, 80, 5, true);
    expect(uniqueColors(img)).toBeGreaterThan(256);
    const q = quantize(img);
    expect(uniqueColors(q)).toBeLessThanOrEqual(256);
    let err = 0;
    for (let i = 0; i < img.data.length; i++) err += Math.abs(img.data[i] - q.data[i]);
    expect(err / img.data.length).toBeLessThan(12);
  });
});
