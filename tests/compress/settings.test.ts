import { describe, expect, it } from 'vitest';
import { specKey } from '../../src/engine/settings';
import {
  compressSpec,
  compressStore,
  DEFAULT_COMPRESS,
  normalizeCompress,
  type CompressSettings,
} from '../../src/tools/compress/settings';

describe('Compress settings', () => {
  it('default to lossless, keeping the format; WebP aims for 50 KB', () => {
    expect(DEFAULT_COMPRESS).toMatchObject({
      output: 'keep',
      mode: 'lossless',
      webpTarget: { value: 50, unit: 'KB' },
      tooBig: 'shrink',
      stripMetadata: true,
    });
  });

  it('normalise junk back to defaults and survive a JSON round trip', () => {
    expect(normalizeCompress({ output: 'gif', mode: 'magic', quality: 'high', tooBig: 1 })).toEqual(
      DEFAULT_COMPRESS,
    );
    const custom: CompressSettings = {
      ...DEFAULT_COMPRESS,
      output: 'webp',
      webpTarget: { value: 80, unit: 'KB' },
      tooBig: 'lower-quality',
      effort: 'maximum',
    };
    expect(normalizeCompress(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
  });

  it('take over the old single-page site’s Compress settings', () => {
    const s = compressStore.normalize(
      compressStore.fromLegacy({
        compress: { mode: 'visual', quality: 70 },
        output: { stripMetadata: false, effort: 'maximum', fallbackFormat: 'png' },
        watermark: {},
      }),
    );
    expect(s).toMatchObject({
      mode: 'visual',
      quality: 70,
      stripMetadata: false,
      effort: 'maximum',
      fallbackFormat: 'png',
    });
  });
});

describe('Compress jobs', () => {
  const spec = (over: Partial<CompressSettings>) => compressSpec({ ...DEFAULT_COMPRESS, ...over });

  it('keep the format without a target by default', () => {
    expect(spec({})).toMatchObject({ output: 'keep', mode: 'lossless', targetBytes: null });
  });

  it('use the format’s own target in target mode', () => {
    expect(spec({ mode: 'target', target: { value: 300, unit: 'KB' } }).targetBytes).toBe(
      300 * 1024,
    );
  });

  it('always aim for the WebP target when saving as WebP', () => {
    const s = spec({ output: 'webp', mode: 'lossless' });
    expect(s).toMatchObject({
      output: 'webp',
      mode: 'target',
      targetBytes: 50 * 1024,
      fallbackFormat: 'webp',
    });
  });

  it('change only when a setting that affects the file changes', () => {
    const key = (over: Partial<CompressSettings>) => specKey(spec(over));
    const webp = { output: 'webp' as const };
    expect(key({ ...webp, quality: 60 })).toBe(key({ ...webp, quality: 95 }));
    expect(key({ ...webp, target: { value: 1, unit: 'MB' } })).toBe(key(webp));
    expect(key({ ...webp, tooBig: 'lower-quality' })).not.toBe(key(webp));
    expect(key({ tooBig: 'lower-quality' })).toBe(key({})); // lossless: no target involved
    expect(key({ webpTarget: { value: 10, unit: 'KB' } })).toBe(key({}));
    expect(key({ resize: { enabled: true, maxWidth: 100, maxHeight: 100 } })).not.toBe(key({}));
  });
});
