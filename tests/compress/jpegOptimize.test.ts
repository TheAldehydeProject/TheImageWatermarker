import { describe, expect, it } from 'vitest';
import { optimalTable, optimizeJpeg } from '../../src/tools/compress/jpegOptimize';
import {
  exifOrientation,
  extractJpegMetadata,
  injectJpegMetadata,
  orientationOnlyExif,
} from '../../src/engine/metadata';
import { decodeJpeg, encodeJpeg, hasMarker, maxChannelDiff, photoLike } from '../helpers';
import { rewriteJpeg } from '../jpegRewrite';

const baseline = (extra: Record<string, unknown> = {}) => ({
  quality: 88,
  baseline: true,
  progressive: false,
  ...extra,
});

/** A baseline JPEG with the generic Huffman tables from the JPEG standard, as cameras write. */
async function cameraJpeg(w: number, h: number, seed: number, extra: Record<string, unknown> = {}) {
  const tuned = await encodeJpeg(photoLike(w, h, seed), baseline(extra));
  return rewriteJpeg(tuned, { standardTables: true });
}

describe('optimalTable', () => {
  it('builds a valid prefix code limited to 16 bits', () => {
    // Exponentially skewed frequencies force very long codes before limiting.
    const freq = new Array(256).fill(0);
    for (let i = 0; i < 40; i++) freq[i] = 2 ** Math.min(30, i);
    const { counts, values } = optimalTable(freq);
    expect(counts.length).toBe(16);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(values.length);
    expect(values.length).toBe(40);
    // Kraft inequality, strictly below 1 because the all-ones code is reserved.
    let kraft = 0;
    counts.forEach((n, i) => (kraft += n * 2 ** -(i + 1)));
    expect(kraft).toBeLessThan(1);
  });

  it('gives frequent symbols shorter codes', () => {
    const freq = new Array(256).fill(0);
    freq[10] = 1000;
    freq[20] = 10;
    freq[30] = 1;
    const { values } = optimalTable(freq);
    expect(values[0]).toBe(10);
  });

  it('handles a table with no symbols', () => {
    const { counts, values } = optimalTable(new Array(256).fill(0));
    expect(values.length).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('optimizeJpeg', () => {
  const cases: [string, number, number, Record<string, unknown>][] = [
    ['4:2:0 colour', 160, 120, { chroma_subsample: 2, auto_subsample: false }],
    ['4:4:4 colour', 96, 64, { chroma_subsample: 1, auto_subsample: false }],
    ['odd dimensions', 37, 23, {}],
    ['greyscale', 80, 50, { color_space: 1 }],
  ];

  for (const [name, w, h, opts] of cases) {
    it(`is lossless and smaller for ${name}`, async () => {
      const original = await cameraJpeg(w, h, 7, opts);
      const r = optimizeJpeg(original, { stripMetadata: true });
      expect(r.huffmanOptimized).toBe(true);
      expect(r.bytes.length).toBeLessThan(original.length);
      const before = await decodeJpeg(original);
      const after = await decodeJpeg(r.bytes);
      expect(maxChannelDiff(before, after)).toBe(0);
    });
  }

  it('produces the same tables as libjpeg for an already-optimised file', async () => {
    const tuned = await encodeJpeg(photoLike(80, 50, 9), baseline({ color_space: 1 }));
    const r = optimizeJpeg(tuned, { stripMetadata: false });
    expect(r.bytes).toEqual(tuned);
  });

  it('handles restart markers', async () => {
    const plain = await cameraJpeg(120, 72, 3);
    const withRst = rewriteJpeg(plain, { restartInterval: 3 });
    expect(hasMarker(withRst, 0xdd)).toBe(true);
    // The helper itself must produce an equivalent image.
    const reference = await decodeJpeg(plain);
    expect(maxChannelDiff(reference, await decodeJpeg(withRst))).toBe(0);

    const r = optimizeJpeg(withRst, { stripMetadata: true });
    expect(r.huffmanOptimized).toBe(true);
    expect(r.bytes.length).toBeLessThan(withRst.length);
    expect(maxChannelDiff(reference, await decodeJpeg(r.bytes))).toBe(0);
  });

  it('leaves progressive files coded as they are', async () => {
    const progressive = await encodeJpeg(photoLike(64, 64, 2), { quality: 80, progressive: true });
    const r = optimizeJpeg(progressive, { stripMetadata: true });
    expect(r.huffmanOptimized).toBe(false);
    expect(maxChannelDiff(await decodeJpeg(progressive), await decodeJpeg(r.bytes))).toBe(0);
  });

  it('strips EXIF but keeps the orientation flag', async () => {
    const base = await cameraJpeg(48, 32, 4);
    const exif = orientationOnlyExif(6);
    const withExif = injectJpegMetadata(base, { exif, icc: new Uint8Array(300).fill(7) });
    const stripped = optimizeJpeg(withExif, { stripMetadata: true }).bytes;
    const meta = extractJpegMetadata(stripped);
    expect(meta.orientation).toBe(6);
    expect(meta.exif!.length).toBe(exif.length);
    // ICC profiles describe colour, so they always stay.
    expect(meta.icc).toEqual(new Uint8Array(300).fill(7));
  });

  it('keeps EXIF when asked to', async () => {
    const base = await cameraJpeg(48, 32, 4);
    const exif = orientationOnlyExif(3);
    const kept = optimizeJpeg(injectJpegMetadata(base, { exif }), { stripMetadata: false }).bytes;
    expect(exifOrientation(extractJpegMetadata(kept).exif!)).toBe(3);
  });

  it('drops comments and unknown APP segments when stripping', async () => {
    const base = await cameraJpeg(32, 32, 5);
    const comment = [0xff, 0xfe, 0, 7, 0x68, 0x65, 0x6c, 0x6c, 0x6f];
    const app13 = [0xff, 0xed, 0, 6, 1, 2, 3, 4];
    const withJunk = new Uint8Array([
      ...base.subarray(0, 2),
      ...comment,
      ...app13,
      ...base.subarray(2),
    ]);
    const out = optimizeJpeg(withJunk, { stripMetadata: true }).bytes;
    expect(hasMarker(out, 0xfe)).toBe(false);
    expect(hasMarker(out, 0xed)).toBe(false);
    const kept = optimizeJpeg(withJunk, { stripMetadata: false }).bytes;
    expect(hasMarker(kept, 0xfe)).toBe(true);
  });

  it('rejects data that is not a JPEG', () => {
    expect(() => optimizeJpeg(new Uint8Array([1, 2, 3, 4]), { stripMetadata: true })).toThrow();
  });
});
