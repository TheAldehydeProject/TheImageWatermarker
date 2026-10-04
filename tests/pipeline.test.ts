import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage, encodeImage } from '../src/lib/codecs';
import type { OutputFormat } from '../src/lib/formats';
import { applyOrientation, type RGBAImage } from '../src/lib/image';
import {
  exifOrientation,
  extractJpegMetadata,
  injectJpegMetadata,
  orientationOnlyExif,
} from '../src/lib/metadata';
import { processImage, UserFacingError, type PipelineDeps } from '../src/lib/pipeline';
import { DEFAULT_SETTINGS, jobSpecFor, type AppSettings, type JobSpec } from '../src/lib/settings';
import { applyWatermark } from '../src/lib/watermark';
import {
  decodeJpeg,
  encodeJpeg,
  initCodecs,
  maxChannelDiff,
  photoLike,
  uniqueColors,
} from './helpers';
import { rewriteJpeg } from './jpegRewrite';

beforeAll(() => initCodecs());

/** Test stand-in for the canvas watermark renderer: draws a solid block. */
const deps: PipelineDeps = {
  watermark: async (img, s) =>
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
};

const spec = (tool: AppSettings['tool'], over: Partial<AppSettings> = {}): JobSpec =>
  jobSpecFor({ ...DEFAULT_SETTINGS, ...over, tool });

const pixels = async (bytes: Uint8Array, name: string): Promise<RGBAImage> => {
  const format = name.split('.').pop() as Parameters<typeof decodeImage>[1];
  return (await decodeImage(bytes, format)).image;
};

describe('codecs', () => {
  it('give identical output on repeated calls (no state leaking between files)', async () => {
    const a = photoLike(41, 29, 7);
    const b = photoLike(77, 51, 3, true);
    const formats: OutputFormat[] = ['jpeg', 'webp', 'avif', 'jxl', 'png'];
    for (const f of formats) {
      for (const lossless of f === 'jpeg' ? [false] : [false, true]) {
        const o = { lossless, quality: 85, effort: 'balanced' as const };
        const first = await encodeImage(a, f, o);
        await encodeImage(b, f, { ...o, quality: 95 });
        expect(await encodeImage(a, f, o), `${f} lossless=${lossless}`).toEqual(first);
      }
    }
  }, 60_000);

  it('lossless modes round-trip pixels exactly', async () => {
    const img = photoLike(50, 40, 2, true);
    for (const f of ['png', 'webp', 'jxl', 'avif', 'tiff'] as const) {
      const bytes = await encodeImage(img, f, { lossless: true, quality: 100, effort: 'balanced' });
      const back = await pixels(bytes, `x.${f}`);
      expect(maxChannelDiff(img, back), f).toBe(0);
    }
  }, 60_000);
});

describe('Compress (lossless)', () => {
  it('shrinks a camera-style JPG without changing a single pixel', async () => {
    const original = rewriteJpeg(
      await encodeJpeg(photoLike(320, 240, 1), { quality: 90, baseline: true, progressive: false }),
      {
        standardTables: true,
      },
    );
    const r = await processImage(original, 'cam.jpg', spec('compress'), deps);
    expect(r.format).toBe('jpeg');
    expect(r.lossless).toBe(true);
    expect(r.bytes.length).toBeLessThan(original.length * 0.97);
    expect(maxChannelDiff(await decodeJpeg(original), await decodeJpeg(r.bytes))).toBe(0);
    expect([r.width, r.height]).toEqual([320, 240]);
  });

  it('optimises PNGs losslessly', async () => {
    const { default: encode } = await import('@jsquash/png/encode.js');
    const img = photoLike(90, 60, 4);
    const png = new Uint8Array(await encode(img as unknown as ImageData));
    const r = await processImage(png, 'x.png', spec('compress'), deps);
    expect(r.format).toBe('png');
    expect(maxChannelDiff(img, await pixels(r.bytes, 'x.png'))).toBe(0);
  });

  it('keeps the original when it cannot be made smaller', async () => {
    const tiny = await encodeJpeg(photoLike(128, 96, 2), { quality: 40 });
    const r = await processImage(
      tiny,
      'small.jpg',
      spec('compress', { compress: { mode: 'visual', quality: 95 } }),
      deps,
    );
    expect(r.keptOriginal).toBe(true);
    expect(r.bytes).toEqual(tiny);
  });

  it('says so when a lossy file cannot shrink losslessly', async () => {
    const avif = await encodeImage(photoLike(40, 30), 'avif', {
      lossless: false,
      quality: 60,
      effort: 'balanced',
    });
    const r = await processImage(avif, 'a.avif', spec('compress'), deps);
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
    await expect(processImage(tiff, 'x.dng', spec('compress'), deps)).rejects.toBeInstanceOf(
      UserFacingError,
    );
  });
});

describe('Compress (visually lossless)', () => {
  it('re-encodes a large JPG at the chosen quality', async () => {
    const big = await encodeJpeg(photoLike(256, 192, 8), { quality: 98, progressive: false });
    const r = await processImage(
      big,
      'b.jpg',
      spec('compress', { compress: { mode: 'visual', quality: 80 } }),
      deps,
    );
    expect(r.keptOriginal).toBe(false);
    expect(r.bytes.length).toBeLessThan(big.length);
  });

  it('reduces PNG colours', async () => {
    const { default: encode } = await import('@jsquash/png/encode.js');
    const png = new Uint8Array(await encode(photoLike(120, 90, 4) as unknown as ImageData));
    const r = await processImage(
      png,
      'p.png',
      spec('compress', { compress: { mode: 'visual', quality: 90 } }),
      deps,
    );
    expect(uniqueColors(await pixels(r.bytes, 'x.png'))).toBeLessThanOrEqual(256);
    expect(r.bytes.length).toBeLessThan(png.length);
  });
});

describe('Convert', () => {
  it('converts to lossless WebP by default with identical pixels', async () => {
    const { default: encode } = await import('@jsquash/png/encode.js');
    const img = photoLike(64, 48, 6, true);
    const png = new Uint8Array(await encode(img as unknown as ImageData));
    const r = await processImage(png, 'x.png', spec('convert'), deps);
    expect(r).toMatchObject({
      format: 'webp',
      extension: 'webp',
      mime: 'image/webp',
      lossless: true,
    });
    expect(maxChannelDiff(img, await pixels(r.bytes, 'x.webp'))).toBe(0);
  });

  for (const target of ['jpeg', 'png', 'webp', 'avif', 'jxl', 'tiff'] as const) {
    it(`converts a JPG to ${target}`, async () => {
      const jpg = await encodeJpeg(photoLike(48, 32, 9), { quality: 85 });
      const r = await processImage(
        jpg,
        'in.jpg',
        spec('convert', { convert: { format: target, lossless: false, quality: 80 } }),
        deps,
      );
      expect(r.format).toBe(target);
      const back = await pixels(r.bytes, `x.${target}`);
      expect([back.width, back.height]).toEqual([48, 32]);
    });
  }

  it('fills transparency with white for JPG and says so', async () => {
    const { default: encode } = await import('@jsquash/png/encode.js');
    const png = new Uint8Array(await encode(photoLike(20, 20, 1, true) as unknown as ImageData));
    const r = await processImage(
      png,
      'x.png',
      spec('convert', { convert: { format: 'jpeg', lossless: true, quality: 90 } }),
      deps,
    );
    expect(r.notes.join(' ')).toMatch(/white/);
    expect(r.notes.join(' ')).toMatch(/can't store images losslessly/);
    const back = await decodeJpeg(r.bytes);
    expect(back.data[0]).toBeGreaterThan(230); // fully transparent corner became white
  });

  it('applies EXIF rotation and resets the tag when metadata is kept', async () => {
    const jpg = injectJpegMetadata(await encodeJpeg(photoLike(40, 20, 3), { quality: 90 }), {
      exif: orientationOnlyExif(6),
    });
    const keep = spec('convert', {
      convert: { format: 'jpeg', lossless: false, quality: 90 },
      output: { ...DEFAULT_SETTINGS.output, stripMetadata: false },
    });
    const r = await processImage(jpg, 'rot.jpg', keep, deps);
    expect([r.width, r.height]).toEqual([20, 40]);
    expect(exifOrientation(extractJpegMetadata(r.bytes).exif!)).toBe(1);

    const stripped = await processImage(
      jpg,
      'rot.jpg',
      spec('convert', { convert: { format: 'jpeg', lossless: false, quality: 90 } }),
      deps,
    );
    expect(extractJpegMetadata(stripped.bytes).exif).toBeUndefined();
    // The pixels are upright either way.
    const upright = applyOrientation(await decodeJpeg(jpg), 6);
    expect(maxChannelDiff(upright, await decodeJpeg(stripped.bytes))).toBeLessThan(40);
  });

  it('resizes when asked', async () => {
    const jpg = await encodeJpeg(photoLike(200, 100, 3), { quality: 90 });
    const r = await processImage(
      jpg,
      'r.jpg',
      spec('convert', {
        output: {
          ...DEFAULT_SETTINGS.output,
          resize: { enabled: true, maxWidth: 50, maxHeight: 0 },
        },
      }),
      deps,
    );
    expect([r.width, r.height]).toEqual([50, 25]);
    expect(r.notes.join(' ')).toMatch(/Resized to 50 × 25/);
  });
});

describe('Watermark', () => {
  it('keeps the format, stays lossless for PNG and changes only the corner', async () => {
    const { default: encode } = await import('@jsquash/png/encode.js');
    const img = photoLike(300, 200, 2);
    const png = new Uint8Array(await encode(img as unknown as ImageData));
    const r = await processImage(png, 'w.png', spec('watermark'), deps);
    expect(r.format).toBe('png');
    expect(r.lossless).toBe(true);
    const out = await pixels(r.bytes, 'x.png');
    // Top-left quarter is untouched; bottom-right corner changed.
    let topLeftDiff = 0;
    let cornerDiff = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 300; x++) {
        const i = (y * 300 + x) * 4;
        const d = Math.abs(out.data[i] - img.data[i]);
        if (x < 150 && y < 100) topLeftDiff += d;
        if (x > 270 && y > 180) cornerDiff += d;
      }
    }
    expect(topLeftDiff).toBe(0);
    expect(cornerDiff).toBeGreaterThan(0);
  });

  it('re-saves lossy sources at the watermark quality', async () => {
    const jpg = await encodeJpeg(photoLike(120, 80, 2), { quality: 85 });
    const r = await processImage(jpg, 'w.jpg', spec('watermark'), deps);
    expect(r).toMatchObject({ format: 'jpeg', lossless: false });
  });
});
