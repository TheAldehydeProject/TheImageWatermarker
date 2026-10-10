import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/engine/codecs';
import type { InputFormat } from '../../src/engine/formats';
import { applyOrientation, type RGBAImage } from '../../src/engine/image';
import {
  exifOrientation,
  extractJpegMetadata,
  injectJpegMetadata,
  orientationOnlyExif,
} from '../../src/engine/metadata';
import { convertImage } from '../../src/tools/convert/pipeline';
import {
  convertSpec,
  DEFAULT_CONVERT,
  type ConvertSettings,
} from '../../src/tools/convert/settings';
import {
  decodeJpeg,
  encodeJpeg,
  initCodecs,
  maxChannelDiff,
  photoLike,
  uniqueColors,
} from '../helpers';

beforeAll(() => initCodecs());

const spec = (over: Partial<ConvertSettings> = {}) => convertSpec({ ...DEFAULT_CONVERT, ...over });
const pixels = async (bytes: Uint8Array, format: InputFormat): Promise<RGBAImage> =>
  (await decodeImage(bytes, format)).image;
const png = async (img: RGBAImage) => {
  const { default: encode } = await import('@jsquash/png/encode.js');
  return new Uint8Array(await encode(img as unknown as ImageData));
};

describe('Convert', () => {
  it('converts to lossless WebP by default with identical pixels', async () => {
    const img = photoLike(64, 48, 6, true);
    const steps: string[] = [];
    const r = await convertImage(await png(img), 'x.png', spec(), (s) => steps.push(s));
    expect(r).toMatchObject({
      format: 'webp',
      extension: 'webp',
      mime: 'image/webp',
      lossless: true,
    });
    expect(maxChannelDiff(img, await pixels(r.bytes, 'webp'))).toBe(0);
    expect(steps).toEqual(['reading', 'compressing']);
  });

  for (const format of ['jpeg', 'png', 'webp', 'avif', 'jxl', 'tiff'] as const) {
    it(`converts a JPG to ${format}`, async () => {
      const jpg = await encodeJpeg(photoLike(48, 32, 9), { quality: 85 });
      const r = await convertImage(jpg, 'in.jpg', spec({ format, lossless: false, quality: 80 }));
      expect(r.format).toBe(format);
      const back = await pixels(r.bytes, format);
      expect([back.width, back.height]).toEqual([48, 32]);
    });
  }

  it('keeps PNG lossless even when the lossless switch was off for another format', async () => {
    const img = photoLike(80, 60, 3);
    const r = await convertImage(await png(img), 'x.png', spec({ format: 'png', lossless: false }));
    expect(r.lossless).toBe(true);
    expect(maxChannelDiff(img, await pixels(r.bytes, 'png'))).toBe(0);
    expect(uniqueColors(img)).toBeGreaterThan(256);
  });

  it('fills transparency with white for JPG and says so', async () => {
    const original = await png(photoLike(20, 20, 1, true));
    const r = await convertImage(original, 'x.png', spec({ format: 'jpeg', quality: 90 }));
    expect(r.notes.join(' ')).toMatch(/white/);
    const back = await decodeJpeg(r.bytes);
    expect(back.data[0]).toBeGreaterThan(230); // fully transparent corner became white
  });

  it('applies EXIF rotation and resets the tag when metadata is kept', async () => {
    const jpg = injectJpegMetadata(await encodeJpeg(photoLike(40, 20, 3), { quality: 90 }), {
      exif: orientationOnlyExif(6),
    });
    const kept = await convertImage(
      jpg,
      'rot.jpg',
      spec({ format: 'jpeg', quality: 90, stripMetadata: false }),
    );
    expect([kept.width, kept.height]).toEqual([20, 40]);
    expect(exifOrientation(extractJpegMetadata(kept.bytes).exif!)).toBe(1);

    const stripped = await convertImage(jpg, 'rot.jpg', spec({ format: 'jpeg', quality: 90 }));
    expect(extractJpegMetadata(stripped.bytes).exif).toBeUndefined();
    // The pixels are upright either way.
    const upright = applyOrientation(await decodeJpeg(jpg), 6);
    expect(maxChannelDiff(upright, await decodeJpeg(stripped.bytes))).toBeLessThan(40);
  });

  it('resizes when asked', async () => {
    const jpg = await encodeJpeg(photoLike(200, 100, 3), { quality: 90 });
    const r = await convertImage(
      jpg,
      'r.jpg',
      spec({ resize: { enabled: true, maxWidth: 50, maxHeight: 0 } }),
    );
    expect([r.width, r.height]).toEqual([50, 25]);
    expect(r.notes.join(' ')).toMatch(/Resized to 50 × 25/);
  });
});
