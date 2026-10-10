import type { Effort, OutputFormat } from '../../engine/formats';
import {
  bool,
  DEFAULT_RESIZE,
  effort,
  isFormat,
  normalizeResize,
  num,
  obj,
  resizeLimits,
  type ResizeSetting,
  type SettingsStore,
} from '../../engine/settings';

export interface ConvertSettings {
  format: OutputFormat;
  lossless: boolean;
  quality: number;
  resize: ResizeSetting;
  stripMetadata: boolean;
  effort: Effort;
}

export const DEFAULT_CONVERT: ConvertSettings = {
  format: 'webp',
  lossless: true,
  quality: 90,
  resize: DEFAULT_RESIZE,
  stripMetadata: true,
  effort: 'balanced',
};

export function normalizeConvert(input: unknown): ConvertSettings {
  const d = DEFAULT_CONVERT;
  const s = obj(input);
  return {
    format: isFormat(s.format) ? s.format : d.format,
    lossless: bool(s.lossless, d.lossless),
    quality: num(s.quality, 1, 100, d.quality),
    resize: normalizeResize(s.resize),
    stripMetadata: bool(s.stripMetadata, d.stripMetadata),
    effort: effort(s.effort),
  };
}

export const convertStore: SettingsStore<ConvertSettings> = {
  tool: 'convert',
  normalize: normalizeConvert,
  // The single-page site kept these under `convert` and `output`.
  fromLegacy: (old) => ({ ...obj(old.convert), ...obj(old.output) }),
};

/** Everything the Convert pipeline needs to know about one run. */
export interface ConvertSpec {
  format: OutputFormat;
  lossless: boolean;
  quality: number;
  resize: { maxWidth: number; maxHeight: number } | null;
  stripMetadata: boolean;
  effort: Effort;
}

/**
 * The job for these settings. Settings that don't affect the result are left
 * at fixed values, so changing them doesn't make an estimate look out of date.
 */
export function convertSpec(s: ConvertSettings): ConvertSpec {
  // PNG and TIFF are always lossless and JPG always lossy here.
  const lossless =
    s.format === 'png' || s.format === 'tiff' ? true : s.format === 'jpeg' ? false : s.lossless;
  const usesQuality = !lossless || s.format === 'jpeg';
  return {
    format: s.format,
    lossless,
    quality: usesQuality ? s.quality : 0,
    resize: resizeLimits(s.resize),
    stripMetadata: s.stripMetadata,
    effort: s.effort,
  };
}

export const CONVERT_SUFFIX = '';
