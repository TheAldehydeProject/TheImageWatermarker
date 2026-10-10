import type { Effort, OutputFormat } from '../../engine/formats';
import {
  bool,
  DEFAULT_RESIZE,
  effort,
  isFormat,
  normalizeResize,
  normalizeTarget,
  num,
  obj,
  oneOf,
  resizeLimits,
  targetBytes,
  type ResizeSetting,
  type SettingsStore,
  type TargetSize,
} from '../../engine/settings';

/** Keep each file's format, or save everything as WebP at a target size. */
export type CompressOutput = 'keep' | 'webp';
/** How files keep their format: exact pixels, a high quality, or a target size. */
export type CompressMode = 'lossless' | 'visual' | 'target';
/**
 * When even the lowest clean quality is over the target: make the image
 * smaller in pixels, or first let the quality drop further.
 */
export type TooBig = 'shrink' | 'lower-quality';

export interface CompressSettings {
  output: CompressOutput;
  /** Used when keeping the format. */
  mode: CompressMode;
  quality: number;
  /** Target when keeping the format. */
  target: TargetSize;
  /** Target for WebP output. */
  webpTarget: TargetSize;
  tooBig: TooBig;
  resize: ResizeSetting;
  stripMetadata: boolean;
  /** Used for files whose own format can't be written (RAW, HEIC, GIF, BMP). */
  fallbackFormat: OutputFormat;
  effort: Effort;
}

export const DEFAULT_TARGET: TargetSize = { value: 500, unit: 'KB' };
export const DEFAULT_WEBP_TARGET: TargetSize = { value: 50, unit: 'KB' };

export const DEFAULT_COMPRESS: CompressSettings = {
  output: 'keep',
  mode: 'lossless',
  quality: 90,
  target: DEFAULT_TARGET,
  webpTarget: DEFAULT_WEBP_TARGET,
  tooBig: 'shrink',
  resize: DEFAULT_RESIZE,
  stripMetadata: true,
  fallbackFormat: 'webp',
  effort: 'balanced',
};

export function normalizeCompress(input: unknown): CompressSettings {
  const d = DEFAULT_COMPRESS;
  const s = obj(input);
  return {
    output: oneOf(s.output, ['keep', 'webp'] as const, d.output),
    mode: oneOf(s.mode, ['lossless', 'visual', 'target'] as const, d.mode),
    quality: num(s.quality, 1, 100, d.quality),
    target: normalizeTarget(s.target, DEFAULT_TARGET),
    webpTarget: normalizeTarget(s.webpTarget, DEFAULT_WEBP_TARGET),
    tooBig: oneOf(s.tooBig, ['shrink', 'lower-quality'] as const, d.tooBig),
    resize: normalizeResize(s.resize),
    stripMetadata: bool(s.stripMetadata, d.stripMetadata),
    fallbackFormat: isFormat(s.fallbackFormat) ? s.fallbackFormat : d.fallbackFormat,
    effort: effort(s.effort),
  };
}

export const compressStore: SettingsStore<CompressSettings> = {
  tool: 'compress',
  normalize: normalizeCompress,
  // The single-page site kept these under `compress` and `output`.
  fromLegacy: (old) => ({ ...obj(old.compress), ...obj(old.output) }),
};

/** Everything the Compress pipeline needs to know about one run. */
export interface CompressSpec {
  output: CompressOutput;
  /** Only used when keeping the format. */
  mode: CompressMode;
  quality: number;
  /** Set for target-size mode and for WebP output. */
  targetBytes: number | null;
  tooBig: TooBig;
  resize: { maxWidth: number; maxHeight: number } | null;
  stripMetadata: boolean;
  fallbackFormat: OutputFormat;
  effort: Effort;
}

/**
 * The job for these settings. Settings that don't affect the result are left
 * at fixed values, so changing them doesn't make an estimate look out of date.
 */
export function compressSpec(s: CompressSettings): CompressSpec {
  const webp = s.output === 'webp';
  const mode: CompressMode = webp ? 'target' : s.mode;
  const fits = mode === 'target';
  return {
    output: s.output,
    mode,
    // Lossless mode uses it too, when a RAW or HEIC file has to become a JPG.
    quality: fits ? 0 : s.quality,
    targetBytes: webp
      ? targetBytes(s.webpTarget, DEFAULT_WEBP_TARGET)
      : fits
        ? targetBytes(s.target, DEFAULT_TARGET)
        : null,
    tooBig: fits ? s.tooBig : 'shrink',
    resize: resizeLimits(s.resize),
    stripMetadata: s.stripMetadata,
    fallbackFormat: webp ? 'webp' : s.fallbackFormat,
    effort: s.effort,
  };
}

export const COMPRESS_SUFFIX = '-compressed';
