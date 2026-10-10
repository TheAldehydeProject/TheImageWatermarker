import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage, encodeImage } from '../../src/engine/codecs';
import { extractJpegMetadata, injectJpegMetadata } from '../../src/engine/metadata';
import {
  detectOrFail,
  encodeToTarget,
  lazyDecoder,
  prepareSave,
  resizeToFit,
  typicalSize,
  UserFacingError,
} from '../../src/engine/process';
import { encodeJpeg, initCodecs, photoLike } from '../helpers';

beforeAll(() => initCodecs());

describe('reading files', () => {
  it('turns unknown or unreadable files into readable errors', async () => {
    expect(() => detectOrFail(new Uint8Array([1, 2, 3]), 'notes.txt')).toThrow(UserFacingError);
    // A TIFF named like a camera RAW is routed to the RAW decoder, which needs a browser.
    const tiff = await encodeImage(photoLike(20, 20), 'tiff', {
      lossless: true,
      quality: 100,
      effort: 'balanced',
    });
    const decode = lazyDecoder(tiff, detectOrFail(tiff, 'x.dng'));
    await expect(decode()).rejects.toBeInstanceOf(UserFacingError);
  });

  it('decodes once, however often it is asked, and reports it', async () => {
    const jpg = await encodeJpeg(photoLike(40, 30, 1), { quality: 90 });
    const steps: string[] = [];
    const decode = lazyDecoder(jpg, 'jpeg', (s) => steps.push(s));
    const [a, b] = await Promise.all([decode(), decode()]);
    expect(a).toBe(b);
    expect(await decode()).toBe(a);
    expect(steps).toEqual(['reading']);
  });
});

describe('resizeToFit', () => {
  it('shrinks to the limits, never enlarges, and says what it did', () => {
    const notes: string[] = [];
    const img = photoLike(200, 100, 1);
    const out = resizeToFit(img, { maxWidth: 50, maxHeight: 0 }, notes);
    expect([out.width, out.height]).toEqual([50, 25]);
    expect(notes).toEqual(['Resized to 50 × 25.']);
    expect(resizeToFit(img, { maxWidth: 500, maxHeight: 500 }, notes)).toBe(img);
    expect(resizeToFit(img, null, notes)).toBe(img);
    expect(notes).toHaveLength(1);
  });
});

describe('prepareSave', () => {
  it('carries camera data over only when asked, and notes transparency in JPG', async () => {
    const exif = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]);
    const jpg = injectJpegMetadata(await encodeJpeg(photoLike(30, 20, 2), { quality: 90 }), {
      exif,
    });
    const decoded = await decodeImage(jpg, 'jpeg');
    const keep = prepareSave(decoded, decoded.image, 'jpeg', {
      keepExif: true,
      effort: 'balanced',
    });
    expect(extractJpegMetadata(await keep.save(decoded.image, false, 80)).exif).toBeDefined();
    const strip = prepareSave(decoded, decoded.image, 'jpeg', {
      keepExif: false,
      effort: 'balanced',
    });
    expect(extractJpegMetadata(await strip.save(decoded.image, false, 80)).exif).toBeUndefined();
    const avif = prepareSave(decoded, decoded.image, 'avif', {
      keepExif: true,
      effort: 'balanced',
    });
    expect(avif.notes.join(' ')).toMatch(/can't carry camera metadata/);

    const clear = photoLike(10, 10, 1, true);
    const withAlpha = prepareSave({ ...decoded, image: clear }, clear, 'jpeg', {
      keepExif: false,
      effort: 'balanced',
    });
    expect(withAlpha.notes.join(' ')).toMatch(/filled with white/);
  });
});

describe('encodeToTarget', () => {
  it('keeps the size in pixels when shrinking is not allowed', async () => {
    const img = photoLike(160, 120, 4);
    const decoded = { image: img, meta: {}, sourceLossless: true } as Awaited<
      ReturnType<typeof decodeImage>
    >;
    const { save } = prepareSave(decoded, img, 'webp', { keepExif: false, effort: 'balanced' });
    const tiny = await encodeToTarget(img, 'webp', 300, save, {
      minQuality: 1,
      maxQuality: 100,
      allowShrink: false,
    });
    expect([tiny.width, tiny.height, tiny.scale]).toEqual([160, 120, 1]);
    expect(tiny.fits).toBe(false);
    const shrunk = await encodeToTarget(img, 'webp', 300, save, {
      minQuality: 50,
      maxQuality: 100,
      allowShrink: true,
    });
    expect(shrunk.width).toBeLessThan(160);
    expect(shrunk.bytes.length).toBeLessThanOrEqual(300);
  });

  it('knows typical sizes for the lossy formats only', () => {
    for (const f of ['jpeg', 'webp', 'avif', 'jxl'] as const) {
      const sizes = [20, 40, 60, 80, 100].map((q) => typicalSize(f, 1_000_000, q)!);
      for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
    expect(typicalSize('png', 1_000_000, 1)).toBeNull();
  });
});
