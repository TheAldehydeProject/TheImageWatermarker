import { OUTPUT_FORMATS, type OutputFormat } from './formats';
import { normalizeWatermark, DEFAULT_WATERMARK, type WatermarkSettings } from './watermark';

export type Tool = 'compress' | 'convert' | 'watermark' | 'all';
export type CompressionMode = 'lossless' | 'visual';
export type Effort = 'balanced' | 'maximum';

export interface AppSettings {
  tool: Tool;
  compress: { mode: CompressionMode; quality: number };
  convert: { format: OutputFormat; lossless: boolean; quality: number };
  watermark: WatermarkSettings;
  /** Quality used when a watermarked photo has to be re-saved in a lossy format. */
  watermarkQuality: number;
  all: {
    watermark: boolean;
    format: 'keep' | OutputFormat;
    mode: CompressionMode;
    quality: number;
  };
  output: {
    resize: { enabled: boolean; maxWidth: number; maxHeight: number };
    stripMetadata: boolean;
    /** Used for files whose own format can't be written (RAW, HEIC, GIF, BMP). */
    fallbackFormat: OutputFormat;
    effort: Effort;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  tool: 'compress',
  compress: { mode: 'lossless', quality: 90 },
  convert: { format: 'webp', lossless: true, quality: 90 },
  watermark: DEFAULT_WATERMARK,
  watermarkQuality: 92,
  all: { watermark: true, format: 'webp', mode: 'lossless', quality: 90 },
  output: {
    resize: { enabled: false, maxWidth: 2560, maxHeight: 2560 },
    stripMetadata: true,
    fallbackFormat: 'webp',
    effort: 'balanced',
  },
};

const isFormat = (v: unknown): v is OutputFormat =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(OUTPUT_FORMATS, v);
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
const mode = (v: unknown, fallback: CompressionMode): CompressionMode =>
  v === 'lossless' || v === 'visual' ? v : fallback;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** Validates settings loaded from storage, filling any gaps with defaults. */
export function normalizeSettings(input: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  const s = obj(input);
  const compress = obj(s.compress);
  const convert = obj(s.convert);
  const all = obj(s.all);
  const output = obj(s.output);
  const resize = obj(output.resize);
  return {
    tool: (['compress', 'convert', 'watermark', 'all'] as const).includes(s.tool as Tool)
      ? (s.tool as Tool)
      : d.tool,
    compress: {
      mode: mode(compress.mode, d.compress.mode),
      quality: num(compress.quality, 1, 100, d.compress.quality),
    },
    convert: {
      format: isFormat(convert.format) ? convert.format : d.convert.format,
      lossless: typeof convert.lossless === 'boolean' ? convert.lossless : d.convert.lossless,
      quality: num(convert.quality, 1, 100, d.convert.quality),
    },
    watermark: normalizeWatermark(s.watermark),
    watermarkQuality: num(s.watermarkQuality, 1, 100, d.watermarkQuality),
    all: {
      watermark: typeof all.watermark === 'boolean' ? all.watermark : d.all.watermark,
      format: all.format === 'keep' || isFormat(all.format) ? all.format : d.all.format,
      mode: mode(all.mode, d.all.mode),
      quality: num(all.quality, 1, 100, d.all.quality),
    },
    output: {
      resize: {
        enabled: typeof resize.enabled === 'boolean' ? resize.enabled : d.output.resize.enabled,
        maxWidth: num(resize.maxWidth, 0, 50000, d.output.resize.maxWidth),
        maxHeight: num(resize.maxHeight, 0, 50000, d.output.resize.maxHeight),
      },
      stripMetadata:
        typeof output.stripMetadata === 'boolean' ? output.stripMetadata : d.output.stripMetadata,
      fallbackFormat: isFormat(output.fallbackFormat)
        ? output.fallbackFormat
        : d.output.fallbackFormat,
      effort: output.effort === 'maximum' ? 'maximum' : 'balanced',
    },
  };
}

/** Everything the processing pipeline needs to know about one run. */
export interface JobSpec {
  /** 'keep' = same format as the original (or the fallback if it can't be written). */
  target: 'keep' | OutputFormat;
  /** true/false, or match the original (lossless originals stay lossless). */
  lossless: boolean | 'match-source';
  /** 1–100, used for lossy output. */
  quality: number;
  watermark: WatermarkSettings | null;
  resize: { maxWidth: number; maxHeight: number } | null;
  stripMetadata: boolean;
  fallbackFormat: OutputFormat;
  effort: Effort;
  /** Never hand back a file bigger than the original (Compress). */
  neverBigger: boolean;
  /** Added to the file name, e.g. "-compressed". */
  suffix: string;
}

export function jobSpecFor(s: AppSettings): JobSpec {
  const base = {
    resize: s.output.resize.enabled
      ? { maxWidth: s.output.resize.maxWidth, maxHeight: s.output.resize.maxHeight }
      : null,
    stripMetadata: s.output.stripMetadata,
    fallbackFormat: s.output.fallbackFormat,
    effort: s.output.effort,
  };
  switch (s.tool) {
    case 'compress':
      return {
        ...base,
        target: 'keep',
        lossless: s.compress.mode === 'lossless',
        quality: s.compress.quality,
        watermark: null,
        neverBigger: true,
        suffix: '-compressed',
      };
    case 'convert':
      return {
        ...base,
        target: s.convert.format,
        lossless: s.convert.lossless,
        quality: s.convert.quality,
        watermark: null,
        neverBigger: false,
        suffix: '',
      };
    case 'watermark':
      return {
        ...base,
        target: 'keep',
        lossless: 'match-source',
        quality: s.watermarkQuality,
        watermark: s.watermark,
        neverBigger: false,
        suffix: '-watermarked',
      };
    case 'all':
      return {
        ...base,
        target: s.all.format,
        lossless: s.all.mode === 'lossless',
        quality: s.all.quality,
        watermark: s.all.watermark ? s.watermark : null,
        neverBigger: false,
        suffix: '-edited',
      };
  }
}

/** The job the Watermark tool would run with these settings, whichever tab is open. */
export function watermarkSpecFor(s: AppSettings): JobSpec {
  return jobSpecFor({ ...s, tool: 'watermark' });
}

/**
 * Identifies the output a job would produce. Two specs with the same key give
 * the same file, so a preview made with one is still accurate for the other.
 */
export function specKey(spec: JobSpec): string {
  return JSON.stringify(spec);
}

const STORAGE_KEY = 'the-image-watermarker:settings:v1';

export function loadSettings(): AppSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeSettings({});
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); settings
    // then simply last for this visit.
  }
}
