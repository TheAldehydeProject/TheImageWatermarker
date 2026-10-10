import type { OutputFormat } from '../../engine/formats';
import { isFormat, obj, type SettingsStore } from '../../engine/settings';
import { DEFAULT_WATERMARK, normalizeWatermark, type WatermarkSettings } from './watermark';

export interface WatermarkPageSettings {
  watermark: WatermarkSettings;
  /** Used for files whose own format can't be written (RAW, HEIC, GIF, BMP). */
  fallbackFormat: OutputFormat;
}

export const DEFAULT_WATERMARK_PAGE: WatermarkPageSettings = {
  watermark: DEFAULT_WATERMARK,
  fallbackFormat: 'webp',
};

export function normalizeWatermarkPage(input: unknown): WatermarkPageSettings {
  const s = obj(input);
  return {
    watermark: normalizeWatermark(s.watermark),
    fallbackFormat: isFormat(s.fallbackFormat)
      ? s.fallbackFormat
      : DEFAULT_WATERMARK_PAGE.fallbackFormat,
  };
}

export const watermarkStore: SettingsStore<WatermarkPageSettings> = {
  tool: 'watermark',
  normalize: normalizeWatermarkPage,
  // The single-page site kept the fallback format under `output`.
  fromLegacy: (old) => ({
    watermark: old.watermark,
    fallbackFormat: obj(old.output).fallbackFormat,
  }),
};

/** Everything the Watermark pipeline needs to know about one run. */
export interface WatermarkSpec {
  watermark: WatermarkSettings;
  fallbackFormat: OutputFormat;
}

export const watermarkSpec = (s: WatermarkPageSettings): WatermarkSpec => ({
  watermark: s.watermark,
  fallbackFormat: s.fallbackFormat,
});

export const WATERMARK_SUFFIX = '-watermarked';
