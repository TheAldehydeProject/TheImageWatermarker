import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage, encodeImage } from '../../src/engine/codecs';
import type { InputFormat } from '../../src/engine/formats';
import type { RGBAImage } from '../../src/engine/image';
import { isLosslessWebP } from '../../src/engine/formats';
import {
  extractJpegMetadata,
  injectJpegMetadata,
  jpegChromaSubsampling,
} from '../../src/engine/metadata';
import { watermarkImage, type WatermarkDeps } from '../../src/tools/watermark/pipeline';
import { DEFAULT_WATERMARK_PAGE, watermarkSpec } from '../../src/tools/watermark/settings';
import { applyWatermark } from '../../src/tools/watermark/watermark';
import { encodeJpeg, initCodecs, maxChannelDiff, photoLike } from '../helpers';

beforeAll(() => initCodecs());

/** Test stand-in for the canvas watermark renderer: draws a solid block. */
const deps = (steps?: string[]): WatermarkDeps => ({
  draw: async (img, s) =>
    applyWatermark(
      img,
      s,
      (t, size) => ({ x1: 0, y1: -0.7 * size, x2: 0.6 * size * t.length, y2: 0 }),
      (p) => ({
        width: p.width,
        height: p.height,
        data: new Float32Array(p.width * p.height).fill(1),
      }),
    ),
  progress: steps && ((s, n) => steps.push(n ? `${s} ${n}` : s)),
});
const spec = watermarkSpec(DEFAULT_WATERMARK_PAGE);
const pixels = async (bytes: Uint8Array, format: InputFormat): Promise<RGBAImage> =>
  (await decodeImage(bytes, format)).image;

/** Total change in a region, to check that only the watermark's corner changed. */
function regionDiff(a: RGBAImage, b: RGBAImage, x0: number, y0: number, x1: number, y1: number) {
  let d = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      d += Math.abs(a.data[(y * a.width + x) * 4] - b.data[(y * a.width + x) * 4]);
  return d;
}

describe('Watermark keeps the file as it was uploaded', () => {
  it('PNG stays a lossless PNG of the same size, changed only in the corner', async () => {
    const { default: encode } = await import('@jsquash/png/encode.js');
    const img = photoLike(300, 200, 2);
    const png = new Uint8Array(await encode(img as unknown as ImageData));
    const steps: string[] = [];
    const r = await watermarkImage(png, 'w.png', spec, deps(steps));
    expect(r).toMatchObject({ format: 'png', lossless: true, width: 300, height: 200 });
    const out = await pixels(r.bytes, 'png');
    expect(regionDiff(img, out, 0, 0, 150, 100)).toBe(0);
    expect(regionDiff(img, out, 270, 180, 300, 200)).toBeGreaterThan(0);
    expect(steps).toEqual(['reading', 'watermarking', 'compressing']);
  });

  it('a lossy WebP stays a WebP, no bigger than the original and close to its size', async () => {
    const img = photoLike(480, 360, 4);
    const webp = await encodeImage(img, 'webp', {
      lossless: false,
      quality: 75,
      effort: 'balanced',
    });
    const steps: string[] = [];
    const r = await watermarkImage(webp, 'photo.webp', spec, deps(steps));
    expect(r).toMatchObject({ format: 'webp', lossless: false, width: 480, height: 360 });
    expect(r.bytes.length).toBeLessThanOrEqual(webp.length);
    expect(r.bytes.length).toBeGreaterThan(webp.length * 0.9);
    expect(isLosslessWebP(r.bytes)).toBe(false);
    expect(r.notes.join(' ')).toMatch(/no bigger than the original/);
    expect(steps.slice(0, 2)).toEqual(['reading', 'watermarking']);
    expect(steps.some((s) => s.startsWith('fitting'))).toBe(true);
  }, 60_000);

  it('a lossless WebP stays lossless', async () => {
    const img = photoLike(120, 90, 5);
    const webp = await encodeImage(img, 'webp', {
      lossless: true,
      quality: 100,
      effort: 'balanced',
    });
    const r = await watermarkImage(webp, 'g.webp', spec, deps());
    expect(r).toMatchObject({ format: 'webp', lossless: true, width: 120, height: 90 });
    expect(isLosslessWebP(r.bytes)).toBe(true);
    expect(regionDiff(img, await pixels(r.bytes, 'webp'), 0, 0, 60, 45)).toBe(0);
  });

  it('a JPG keeps its camera data and colour resolution, and never grows', async () => {
    const exif = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]);
    for (const chroma of [1, 2] as const) {
      const base = await encodeImage(photoLike(400, 300, 6), 'jpeg', {
        lossless: false,
        quality: 92,
        effort: 'balanced',
        jpegChroma: chroma,
      });
      const jpg = injectJpegMetadata(base, { exif });
      const r = await watermarkImage(jpg, 'cam.jpg', spec, deps());
      expect(r).toMatchObject({ format: 'jpeg', width: 400, height: 300 });
      expect(r.bytes.length).toBeLessThanOrEqual(jpg.length);
      expect(extractJpegMetadata(r.bytes).exif).toBeDefined();
      expect(jpegChromaSubsampling(r.bytes)).toBe(chroma);
    }
  }, 60_000);

  it('an AVIF stays an AVIF, no bigger than the original', async () => {
    const avif = await encodeImage(photoLike(160, 120, 7), 'avif', {
      lossless: false,
      quality: 70,
      effort: 'balanced',
    });
    const r = await watermarkImage(avif, 'a.avif', spec, deps());
    expect(r).toMatchObject({ format: 'avif', width: 160, height: 120 });
    expect(r.bytes.length).toBeLessThanOrEqual(avif.length);
  }, 120_000);

  it('a TIFF stays a lossless TIFF', async () => {
    const img = photoLike(60, 40, 8);
    const tiff = await encodeImage(img, 'tiff', {
      lossless: true,
      quality: 100,
      effort: 'balanced',
    });
    const r = await watermarkImage(tiff, 'scan.tiff', spec, deps());
    expect(r).toMatchObject({ format: 'tiff', lossless: true, width: 60, height: 40 });
  });

  it('a JPG from a camera keeps its look: only the corner changes noticeably', async () => {
    const img = photoLike(320, 240, 9);
    const jpg = await encodeJpeg(img, { quality: 90 });
    const before = await pixels(jpg, 'jpeg');
    const r = await watermarkImage(jpg, 'c.jpg', spec, deps());
    const after = await pixels(r.bytes, 'jpeg');
    expect(maxChannelDiff(before, after)).toBeGreaterThan(40); // the watermark
    // Away from the corner, re-saving changes very little.
    let away = 0;
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 160; x++) {
        const i = (y * 320 + x) * 4;
        away = Math.max(away, Math.abs(before.data[i] - after.data[i]));
      }
    expect(away).toBeLessThan(30);
  }, 60_000);
});
