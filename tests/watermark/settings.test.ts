import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATERMARK_PAGE,
  normalizeWatermarkPage,
  watermarkSpec,
  watermarkStore,
} from '../../src/tools/watermark/settings';
import { DEFAULT_WATERMARK } from '../../src/tools/watermark/watermark';

describe('Watermark page settings', () => {
  it('default to the classic molecule, bottom right, with WebP for unwritable formats', () => {
    expect(DEFAULT_WATERMARK_PAGE).toEqual({
      watermark: DEFAULT_WATERMARK,
      fallbackFormat: 'webp',
    });
    expect(DEFAULT_WATERMARK.position).toBe('bottom-right');
  });

  it('normalise junk back to defaults', () => {
    expect(
      normalizeWatermarkPage({ watermark: { opacity: 'loud' }, fallbackFormat: 'exe' }),
    ).toEqual(DEFAULT_WATERMARK_PAGE);
  });

  it('take over the old single-page site’s watermark design', () => {
    const s = watermarkStore.normalize(
      watermarkStore.fromLegacy({
        watermark: { ...DEFAULT_WATERMARK, variant: 'custom', blendMode: 'overlay' },
        watermarkQuality: 70,
        output: { fallbackFormat: 'png' },
      }),
    );
    expect(s.watermark).toMatchObject({ variant: 'custom', blendMode: 'overlay' });
    expect(s.fallbackFormat).toBe('png');
  });

  it('the job is the watermark design plus the fallback format', () => {
    expect(watermarkSpec(DEFAULT_WATERMARK_PAGE)).toEqual({
      watermark: DEFAULT_WATERMARK,
      fallbackFormat: 'webp',
    });
  });
});
