import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage, encodeImage } from '../../src/engine/codecs';
import type { OutputFormat } from '../../src/engine/formats';
import type { RGBAImage } from '../../src/engine/image';
import { jpegChromaSubsampling } from '../../src/engine/metadata';
import { initCodecs, maxChannelDiff, photoLike } from '../helpers';

beforeAll(() => initCodecs());

const pixels = async (bytes: Uint8Array, format: OutputFormat): Promise<RGBAImage> =>
  (await decodeImage(bytes, format)).image;

describe('codecs', () => {
  it('give identical output on repeated calls (no state leaking between files)', async () => {
    const a = photoLike(41, 29, 7);
    const b = photoLike(77, 51, 3, true);
    const formats: OutputFormat[] = ['jpeg', 'webp', 'avif', 'jxl', 'png'];
    for (const f of formats) {
      for (const lossless of f === 'jpeg' ? [false] : [false, true]) {
        for (const effort of ['balanced', 'maximum'] as const) {
          if (effort === 'maximum' && (f === 'avif' || f === 'jxl')) continue; // very slow
          const o = { lossless, quality: 85, effort };
          const first = await encodeImage(a, f, o);
          await encodeImage(b, f, { ...o, quality: 95 });
          expect(await encodeImage(a, f, o), `${f} lossless=${lossless} ${effort}`).toEqual(first);
        }
      }
    }
  }, 120_000);

  it('lossless modes round-trip pixels exactly', async () => {
    const img = photoLike(50, 40, 2, true);
    for (const f of ['png', 'webp', 'jxl', 'avif', 'tiff'] as const) {
      const bytes = await encodeImage(img, f, { lossless: true, quality: 100, effort: 'balanced' });
      expect(maxChannelDiff(img, await pixels(bytes, f)), f).toBe(0);
    }
  }, 60_000);

  it('saves JPG colour at full resolution from quality 90, unless told otherwise', async () => {
    const img = photoLike(64, 48, 3);
    const at = (quality: number, jpegChroma?: 1 | 2) =>
      encodeImage(img, 'jpeg', { lossless: false, quality, effort: 'balanced', jpegChroma });
    expect(jpegChromaSubsampling(await at(85))).toBe(2);
    expect(jpegChromaSubsampling(await at(95))).toBe(1);
    expect(jpegChromaSubsampling(await at(95, 2))).toBe(2);
    expect(jpegChromaSubsampling(await at(60, 1))).toBe(1);
  });

  it('maximum effort gives a smaller lossy WebP for the same quality', async () => {
    const img = photoLike(240, 180, 5);
    const size = async (effort: 'balanced' | 'maximum') =>
      (await encodeImage(img, 'webp', { lossless: false, quality: 60, effort })).length;
    expect(await size('maximum')).toBeLessThanOrEqual(await size('balanced'));
  });
});
