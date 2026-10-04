import { describe, expect, it } from 'vitest';
import {
  crc32,
  exifForReencode,
  exifHasGps,
  exifOrientation,
  extractJpegMetadata,
  extractPngMetadata,
  extractWebpMetadata,
  injectJpegMetadata,
  injectPngMetadata,
  injectWebpMetadata,
  orientationOnlyExif,
  stripPngMetadata,
  stripWebpMetadata,
} from '../src/lib/metadata';
import { encodeJpeg, initCodecs, photoLike, asImageData } from './helpers';

/** EXIF block (big-endian) with orientation, a GPS pointer and a link to IFD1. */
function sampleExif(orientation: number): Uint8Array {
  const t = new Uint8Array(64);
  const dv = new DataView(t.buffer);
  t.set([0x4d, 0x4d, 0, 42]);
  dv.setUint32(4, 8);
  dv.setUint16(8, 2); // two entries
  dv.setUint16(10, 0x0112);
  dv.setUint16(12, 3);
  dv.setUint32(14, 1);
  dv.setUint16(18, orientation);
  dv.setUint16(22, 0x8825); // GPS IFD pointer
  dv.setUint16(24, 4);
  dv.setUint32(26, 1);
  dv.setUint32(30, 40);
  dv.setUint32(34, 44); // next IFD (thumbnail)
  return t;
}

function pngChunkTypes(png: Uint8Array): string[] {
  const types: string[] = [];
  let off = 8;
  while (off < png.length) {
    const len = new DataView(png.buffer, png.byteOffset).getUint32(off);
    types.push(String.fromCharCode(...png.subarray(off + 4, off + 8)));
    off += 12 + len;
  }
  return types;
}

function pngCrcsValid(png: Uint8Array): boolean {
  let off = 8;
  const dv = new DataView(png.buffer, png.byteOffset);
  while (off < png.length) {
    const len = dv.getUint32(off);
    if (crc32(png, off + 4, off + 8 + len) !== dv.getUint32(off + 8 + len)) return false;
    off += 12 + len;
  }
  return true;
}

function riffIds(webp: Uint8Array): string[] {
  const ids: string[] = [];
  let off = 12;
  const dv = new DataView(webp.buffer, webp.byteOffset);
  while (off + 8 <= webp.length) {
    ids.push(String.fromCharCode(...webp.subarray(off, off + 4)));
    const size = dv.getUint32(off + 4, true);
    off += 8 + size + (size & 1);
  }
  return ids;
}

describe('EXIF helpers', () => {
  it('reads orientation in both byte orders', () => {
    expect(exifOrientation(sampleExif(6))).toBe(6);
    expect(exifOrientation(orientationOnlyExif(8))).toBe(8);
    expect(exifOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });

  it('resets orientation and unlinks the thumbnail for re-encoded images', () => {
    const fixed = exifForReencode(sampleExif(6));
    expect(exifOrientation(fixed)).toBe(1);
    expect(new DataView(fixed.buffer).getUint32(34)).toBe(0);
  });

  it('detects GPS data', () => {
    expect(exifHasGps(sampleExif(1))).toBe(true);
    expect(exifHasGps(orientationOnlyExif(1))).toBe(false);
  });
});

describe('JPEG metadata', () => {
  it('round-trips EXIF and a multi-segment ICC profile', async () => {
    const jpeg = await encodeJpeg(photoLike(16, 16), { quality: 80 });
    const icc = new Uint8Array(150_000).map((_, i) => i % 251);
    const exif = sampleExif(3);
    const withMeta = injectJpegMetadata(jpeg, { exif, icc });
    const meta = extractJpegMetadata(withMeta);
    expect(meta.exif).toEqual(exif);
    expect(meta.icc).toEqual(icc);
    expect(meta.orientation).toBe(3);
  });

  it('replaces rather than duplicates existing EXIF', async () => {
    const jpeg = await encodeJpeg(photoLike(16, 16), { quality: 80 });
    const once = injectJpegMetadata(jpeg, { exif: sampleExif(3) });
    const twice = injectJpegMetadata(once, { exif: orientationOnlyExif(5) });
    expect(twice.length).toBeLessThan(once.length + 40);
    expect(extractJpegMetadata(twice).orientation).toBe(5);
  });
});

describe('PNG metadata', () => {
  it('round-trips EXIF and ICC with valid checksums, and strips cleanly', async () => {
    await initCodecs();
    const { default: encode } = await import('@jsquash/png/encode.js');
    const png = new Uint8Array(await encode(asImageData(photoLike(20, 10))));
    const icc = new Uint8Array(4000).map((_, i) => (i * 7) % 256);
    const exif = sampleExif(1);
    const out = injectPngMetadata(png, { exif, icc });
    expect(pngCrcsValid(out)).toBe(true);
    const types = pngChunkTypes(out);
    expect(types.indexOf('iCCP')).toBeLessThan(types.indexOf('IDAT'));
    expect(types.indexOf('eXIf')).toBeLessThan(types.indexOf('IDAT'));
    const meta = extractPngMetadata(out);
    expect(meta.icc).toEqual(icc);
    expect(meta.exif).toEqual(exif);

    const stripped = stripPngMetadata(out);
    expect(pngChunkTypes(stripped)).not.toContain('eXIf');
    expect(pngChunkTypes(stripped)).toContain('iCCP');
    expect(pngCrcsValid(stripped)).toBe(true);
  });
});

describe('WebP metadata', () => {
  for (const lossless of [0, 1]) {
    it(`adds ICC/EXIF to a ${lossless ? 'lossless' : 'lossy'} WebP and can decode it`, async () => {
      await initCodecs();
      const { default: encode } = await import('@jsquash/webp/encode.js');
      const { default: decode } = await import('@jsquash/webp/decode.js');
      const img = photoLike(33, 21);
      const webp = new Uint8Array(await encode(asImageData(img), { lossless, quality: 80 }));
      const icc = new Uint8Array(777).fill(3);
      const exif = sampleExif(1);
      const out = injectWebpMetadata(webp, { exif, icc }, false);
      expect(riffIds(out)).toEqual(['VP8X', 'ICCP', lossless ? 'VP8L' : 'VP8 ', 'EXIF']);
      const meta = extractWebpMetadata(out);
      expect(meta.icc).toEqual(icc);
      expect(meta.exif).toEqual(exif);
      const decoded = await decode(out.slice().buffer);
      expect([decoded.width, decoded.height]).toEqual([33, 21]);

      const stripped = stripWebpMetadata(out);
      expect(riffIds(stripped)).toEqual(['VP8X', 'ICCP', lossless ? 'VP8L' : 'VP8 ']);
      expect((await decode(stripped.slice().buffer)).width).toBe(33);
    });
  }
});
