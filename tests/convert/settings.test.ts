import { describe, expect, it } from 'vitest';
import { specKey } from '../../src/engine/settings';
import {
  convertSpec,
  convertStore,
  DEFAULT_CONVERT,
  normalizeConvert,
  type ConvertSettings,
} from '../../src/tools/convert/settings';

describe('Convert settings', () => {
  it('default to lossless WebP', () => {
    expect(DEFAULT_CONVERT).toMatchObject({ format: 'webp', lossless: true, stripMetadata: true });
  });

  it('normalise junk back to defaults and survive a JSON round trip', () => {
    expect(normalizeConvert({ format: 'exe', lossless: 'yes', quality: 'max' })).toEqual(
      DEFAULT_CONVERT,
    );
    const custom: ConvertSettings = {
      ...DEFAULT_CONVERT,
      format: 'jxl',
      lossless: false,
      quality: 77,
    };
    expect(normalizeConvert(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
  });

  it('take over the old single-page site’s Convert settings', () => {
    const s = convertStore.normalize(
      convertStore.fromLegacy({
        convert: { format: 'avif', lossless: false, quality: 60 },
        output: { stripMetadata: false, resize: { enabled: true, maxWidth: 800, maxHeight: 600 } },
      }),
    );
    expect(s).toMatchObject({
      format: 'avif',
      lossless: false,
      quality: 60,
      stripMetadata: false,
      resize: { enabled: true, maxWidth: 800, maxHeight: 600 },
    });
  });
});

describe('Convert jobs', () => {
  const spec = (over: Partial<ConvertSettings>) => convertSpec({ ...DEFAULT_CONVERT, ...over });

  it('PNG and TIFF are always lossless, JPG always lossy', () => {
    expect(spec({ format: 'png', lossless: false }).lossless).toBe(true);
    expect(spec({ format: 'tiff', lossless: false }).lossless).toBe(true);
    expect(spec({ format: 'jpeg', lossless: true }).lossless).toBe(false);
    expect(spec({ format: 'avif', lossless: false }).lossless).toBe(false);
  });

  it('change only when a setting that affects the file changes', () => {
    const key = (over: Partial<ConvertSettings>) => specKey(spec(over));
    // Lossless WebP doesn't use the quality.
    expect(key({ quality: 50 })).toBe(key({ quality: 95 }));
    expect(key({ lossless: false, quality: 50 })).not.toBe(key({ lossless: false, quality: 95 }));
    expect(key({ format: 'png', lossless: false })).toBe(key({ format: 'png', lossless: true }));
  });
});
