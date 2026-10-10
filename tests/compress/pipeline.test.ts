import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage, encodeImage } from '../../src/engine/codecs';
import type { InputFormat } from '../../src/engine/formats';
import type { RGBAImage } from '../../src/engine/image';
import { extractWebpMetadata, injectJpegMetadata } from '../../src/engine/metadata';
import { UserFacingError } from '../../src/engine/process';
import { compressImage, QUALITY_FLOOR } from '../../src/tools/compress/pipeline';
import {
  compressSpec,
  DEFAULT_COMPRESS,
  type CompressSettings,
} from '../../src/tools/compress/settings';
import {
  decodeJpeg,
  encodeJpeg,
  initCodecs,
  maxChannelDiff,
  photoLike,
  solid,
  uniqueColors,
} from '../helpers';
import { rewriteJpeg } from '../jpegRewrite';

beforeAll(() => initCodecs());

const spec = (over: Partial<CompressSettings> = {}) =>
  compressSpec({ ...DEFAULT_COMPRESS, ...over });
const pixels = async (bytes: Uint8Array, format: InputFormat): Promise<RGBAImage> =>
  (await decodeImage(bytes, format)).image;
const png = async (img: RGBAImage) => {
  const { default: encode } = await import('@jsquash/png/encode.js');
  return new Uint8Array(await encode(img as unknown as ImageData));
};
const kb = (n: number) => ({ value: n, unit: 'KB' as const });

describe('Compress, keeping the format (lossless)', () => {
  it('shrinks a camera-style JPG without changing a single pixel', async () => {
    const original = rewriteJpeg(
      await encodeJpeg(photoLike(320, 240, 1), { quality: 90, baseline: true, progressive: false }),
      { standardTables: true },
    );
    const r = await compressImage(original, 'cam.jpg', spec());
    expect(r.format).toBe('jpeg');
    expect(r.lossless).toBe(true);
    expect(r.bytes.length).toBeLessThan(original.length * 0.97);
    expect(maxChannelDiff(await decodeJpeg(original), await decodeJpeg(r.bytes))).toBe(0);
    expect([r.width, r.height]).toEqual([320, 240]);
  });

  it('optimises PNGs losslessly', async () => {
    const img = photoLike(90, 60, 4);
    const r = await compressImage(await png(img), 'x.png', spec());
    expect(r.format).toBe('png');
    expect(maxChannelDiff(img, await pixels(r.bytes, 'png'))).toBe(0);
  });

  it('says so when a lossy file cannot shrink losslessly', async () => {
    const avif = await encodeImage(photoLike(40, 30), 'avif', {
      lossless: false,
      quality: 60,
      effort: 'balanced',
    });
    const r = await compressImage(avif, 'a.avif', spec());
    expect(r.keptOriginal).toBe(true);
    expect(r.notes.join(' ')).toMatch(/Visually lossless/);
  });

  it('reports a readable error when a file cannot be decoded', async () => {
    // A TIFF named like a camera RAW is routed to the RAW decoder, which needs a browser.
    const tiff = await encodeImage(photoLike(20, 20), 'tiff', {
      lossless: true,
      quality: 100,
      effort: 'balanced',
    });
    await expect(compressImage(tiff, 'x.dng', spec())).rejects.toBeInstanceOf(UserFacingError);
  });

  it('reports reading, then compressing', async () => {
    const steps: string[] = [];
    const jpg = await encodeJpeg(photoLike(120, 80, 4), { quality: 90 });
    await compressImage(jpg, 'p.jpg', spec(), (s) => steps.push(s));
    expect(steps).toEqual(['reading', 'compressing']);
  });
});

describe('Compress, keeping the format (visually lossless)', () => {
  it('re-encodes a large JPG at the chosen quality', async () => {
    const big = await encodeJpeg(photoLike(256, 192, 8), { quality: 98, progressive: false });
    const r = await compressImage(big, 'b.jpg', spec({ mode: 'visual', quality: 80 }));
    expect(r.keptOriginal).toBe(false);
    expect(r.bytes.length).toBeLessThan(big.length);
  });

  it('keeps the original when it cannot be made smaller', async () => {
    const tiny = await encodeJpeg(photoLike(128, 96, 2), { quality: 40 });
    const r = await compressImage(tiny, 'small.jpg', spec({ mode: 'visual', quality: 95 }));
    expect(r.keptOriginal).toBe(true);
    expect(r.bytes).toEqual(tiny);
  });

  it('reduces PNG colours', async () => {
    const original = await png(photoLike(120, 90, 4));
    const r = await compressImage(original, 'p.png', spec({ mode: 'visual', quality: 90 }));
    expect(uniqueColors(await pixels(r.bytes, 'png'))).toBeLessThanOrEqual(256);
    expect(r.bytes.length).toBeLessThan(original.length);
  });
});

describe('Compress, keeping the format (target size)', () => {
  it('saves a JPG at the highest quality that fits, keeping its size in pixels', async () => {
    const jpg = await encodeJpeg(photoLike(480, 360, 5), { quality: 97 });
    const target = Math.round((jpg.length * 0.4) / 1024);
    const r = await compressImage(jpg, 'p.jpg', spec({ mode: 'target', target: kb(target) }));
    expect(r.format).toBe('jpeg');
    expect([r.width, r.height]).toEqual([480, 360]);
    expect(r.bytes.length).toBeLessThanOrEqual(target * 1024);
    // It uses the room it has rather than settling for a much lower quality.
    expect(r.bytes.length).toBeGreaterThan(target * 1024 * 0.8);
    expect(r.notes.join(' ')).toMatch(/Fits under .* at quality \d+\./);
  }, 60_000);

  it('makes the image smaller only when even the lowest quality is too big', async () => {
    const jpg = await encodeJpeg(photoLike(480, 360, 6), { quality: 95 });
    const r = await compressImage(jpg, 'p.jpg', spec({ mode: 'target', target: kb(3) }));
    expect(r.bytes.length).toBeLessThanOrEqual(3 * 1024);
    expect(r.width).toBeLessThan(480);
    expect(r.width / r.height).toBeCloseTo(480 / 360, 1);
    expect(r.notes.join(' ')).toMatch(/resized to \d+ × \d+ \(at quality 50\)/);
  }, 60_000);

  it('never lowers the quality of a file that already fits', async () => {
    const jpg = await encodeJpeg(photoLike(160, 120, 7), { quality: 80 });
    const r = await compressImage(jpg, 'p.jpg', spec({ mode: 'target', target: kb(1000) }));
    expect(r.bytes.length).toBeLessThanOrEqual(jpg.length);
    expect(r.lossless).toBe(true);
    expect(maxChannelDiff(await decodeJpeg(r.bytes), await decodeJpeg(jpg))).toBe(0);
    expect(r.notes[0]).toMatch(/^Already under 1000 KB/);
  });

  it('PNG stays lossless if that fits, and otherwise drops to 256 colours', async () => {
    const original = await png(photoLike(200, 150, 8));
    const lossless = await compressImage(original, 'x.png', spec());
    const reduced = await compressImage(original, 'x.png', spec({ mode: 'visual' }));
    expect(reduced.bytes.length).toBeLessThan(lossless.bytes.length);
    const between = (lossless.bytes.length + reduced.bytes.length) / 2 / 1024;
    const r = await compressImage(original, 'x.png', spec({ mode: 'target', target: kb(between) }));
    expect(r).toMatchObject({ format: 'png', lossless: false, width: 200 });
    expect(r.bytes.length).toBeLessThanOrEqual(between * 1024);
    expect(r.notes.join(' ')).toMatch(/256 colours/);
  }, 60_000);
});

describe('Compress to WebP', () => {
  it('turns a big photo into a WebP of at most 50 KB by default', async () => {
    const jpg = await encodeJpeg(photoLike(1200, 800, 3), { quality: 95 });
    expect(jpg.length).toBeGreaterThan(200 * 1024);
    const steps: string[] = [];
    const r = await compressImage(jpg, 'big.jpg', spec({ output: 'webp' }), (s, n) =>
      steps.push(n ? `${s} ${n}` : s),
    );
    expect(r.format).toBe('webp');
    expect(r.extension).toBe('webp');
    expect(r.bytes.length).toBeLessThanOrEqual(50 * 1024);
    expect(r.bytes.length).toBeGreaterThan(50 * 1024 * 0.85);
    expect(r.width / r.height).toBeCloseTo(1.5, 1);
    const back = await pixels(r.bytes, 'webp');
    expect([back.width, back.height]).toEqual([r.width, r.height]);
    expect(steps[0]).toBe('reading');
    expect(steps.filter((s) => s.startsWith('fitting')).length).toBeLessThanOrEqual(8);
  }, 120_000);

  it('only shrinks the image when quality alone can’t reach the target', async () => {
    const jpg = await encodeJpeg(photoLike(400, 300, 9), { quality: 95 });
    const r = await compressImage(jpg, 'p.jpg', spec({ output: 'webp', webpTarget: kb(25) }));
    expect(r.bytes.length).toBeLessThanOrEqual(25 * 1024);
    expect([r.width, r.height]).toEqual([400, 300]);
    expect(r.notes.join(' ')).toMatch(/Fits under 25.0 KB at quality \d+/);
  }, 60_000);

  it('offers keeping more pixels at a lower quality instead', async () => {
    const jpg = await encodeJpeg(photoLike(800, 600, 2), { quality: 95 });
    const clean = await compressImage(jpg, 'p.jpg', spec({ output: 'webp', webpTarget: kb(3) }));
    const more = await compressImage(
      jpg,
      'p.jpg',
      spec({ output: 'webp', webpTarget: kb(3), tooBig: 'lower-quality' }),
    );
    for (const r of [clean, more]) expect(r.bytes.length).toBeLessThanOrEqual(3 * 1024);
    const quality = (r: { notes: string[] }) => Number(/quality (\d+)/.exec(r.notes.join(' '))![1]);
    expect(quality(clean)).toBeGreaterThanOrEqual(QUALITY_FLOOR.shrink.webp);
    expect(quality(more)).toBeLessThan(QUALITY_FLOOR.shrink.webp);
    expect(quality(more)).toBeGreaterThanOrEqual(QUALITY_FLOOR['lower-quality'].webp);
    expect(more.width).toBeGreaterThan(clean.width);
  }, 120_000);

  it('never makes a file bigger than the original', async () => {
    const jpg = await encodeJpeg(photoLike(240, 160, 4), { quality: 75 });
    expect(jpg.length).toBeLessThan(50 * 1024);
    const r = await compressImage(jpg, 'small.jpg', spec({ output: 'webp' }));
    expect(r.format).toBe('webp');
    expect(r.bytes.length).toBeLessThanOrEqual(jpg.length);
    expect(r.notes.join(' ')).toMatch(/never makes a file bigger/);
  }, 60_000);

  it('keeps simple graphics lossless when that fits', async () => {
    const original = await png(solid(300, 200, [40, 120, 200, 255]));
    const r = await compressImage(original, 'flat.png', spec({ output: 'webp' }));
    expect(r).toMatchObject({ format: 'webp', lossless: true });
    expect(r.notes.join(' ')).toMatch(/without any loss/);
  });

  it('leaves a WebP that is already small enough as it is', async () => {
    const webp = await encodeImage(photoLike(100, 80, 1), 'webp', {
      lossless: false,
      quality: 70,
      effort: 'balanced',
    });
    const r = await compressImage(webp, 'small.webp', spec({ output: 'webp' }));
    expect(r.keptOriginal).toBe(true);
    expect(r.bytes).toEqual(webp);
  });

  it('keeps camera data in the WebP only when asked', async () => {
    const exif = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]);
    const jpg = injectJpegMetadata(await encodeJpeg(photoLike(300, 200, 5), { quality: 95 }), {
      exif,
    });
    const target = { output: 'webp' as const, webpTarget: kb(5) };
    const stripped = await compressImage(jpg, 'c.jpg', spec(target));
    expect(extractWebpMetadata(stripped.bytes).exif).toBeUndefined();
    const kept = await compressImage(jpg, 'c.jpg', spec({ ...target, stripMetadata: false }));
    expect(extractWebpMetadata(kept.bytes).exif).toBeDefined();
  }, 60_000);
});
