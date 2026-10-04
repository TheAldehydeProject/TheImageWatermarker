import { OUTPUT_FORMATS, type OutputFormat } from './formats';
import { normalizeWatermark, DEFAULT_WATERMARK, type WatermarkSettings } from './watermark';

export type Tool = 'compress' | 'convert' | 'watermark' | 'all';
/** 'target' aims for a file size instead of a fixed quality. */
export type CompressionMode = 'lossless' | 'visual' | 'target';
export type Effort = 'balanced' | 'maximum';

export interface TargetSize {
  value: number;
  unit: 'KB' | 'MB';
}

/** A target size in bytes. KB and MB are 1024-based, as the sizes shown on the page are. */
export function targetBytes(t: TargetSize): number {
  const value = Number.isFinite(t.value) && t.value > 0 ? t.value : DEFAULT_TARGET.value;
  return Math.max(1024, Math.round(value * (t.unit === 'MB' ? 1024 * 1024 : 1024)));
}

export const DEFAULT_TARGET: TargetSize = { value: 500, unit: 'KB' };

export interface AppSettings {
  tool: Tool;
  compress: { mode: CompressionMode; quality: number; target: TargetSize };
  convert: { format: OutputFormat; lossless: boolean; quality: number };
  watermark: WatermarkSettings;
  /** Quality used when a watermarked photo has to be re-saved in a lossy format. */
  watermarkQuality: number;
  all: {
    watermark: boolean;
    format: 'keep' | OutputFormat;
    mode: CompressionMode;
    quality: number;
    target: TargetSize;
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
  compress: { mode: 'lossless', quality: 90, target: DEFAULT_TARGET },
  convert: { format: 'webp', lossless: true, quality: 90 },
  watermark: DEFAULT_WATERMARK,
  watermarkQuality: 92,
  all: { watermark: true, format: 'webp', mode: 'lossless', quality: 90, target: DEFAULT_TARGET },
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
  v === 'lossless' || v === 'visual' || v === 'target' ? v : fallback;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
function target(v: unknown): TargetSize {
  const t = obj(v);
  const value =
    typeof t.value === 'number' && Number.isFinite(t.value) && t.value > 0
      ? Math.min(100_000, Math.round(t.value * 100) / 100)
      : DEFAULT_TARGET.value;
  return { value: Math.max(0.01, value), unit: t.unit === 'MB' ? 'MB' : 'KB' };
}

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
      target: target(compress.target),
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
      target: target(all.target),
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
  /** When set, find the highest quality whose file fits in this many bytes. */
  targetBytes: number | null;
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
    targetBytes: null,
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
        targetBytes: s.compress.mode === 'target' ? targetBytes(s.compress.target) : null,
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
        targetBytes: s.all.mode === 'target' ? targetBytes(s.all.target) : null,
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

// ---------------------------------------------------------------------------
// Settings files (Export settings / Upload settings)

export const SETTINGS_FILE_NAME = 'image-watermarker-settings.json';
const SETTINGS_FILE_APP = 'the-image-watermarker';
const SETTINGS_FILE_VERSION = 1;

/** Settings stored in a settings file: everything except which tab is open. */
export type PortableSettings = Omit<AppSettings, 'tool'>;

export class SettingsFileError extends Error {}

/** The contents of a downloadable settings file. */
export function exportSettings(s: AppSettings, now = new Date()): string {
  const settings: Partial<AppSettings> = structuredClone(s);
  delete settings.tool;
  return JSON.stringify(
    {
      app: SETTINGS_FILE_APP,
      version: SETTINGS_FILE_VERSION,
      exportedAt: now.toISOString(),
      settings: settings as PortableSettings,
    },
    null,
    2,
  );
}

/**
 * Reads a settings file. Missing or invalid values fall back to the defaults;
 * the open tab is kept as it is.
 */
export function importSettings(text: string, current: AppSettings): AppSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const file = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (file.app !== SETTINGS_FILE_APP) {
    throw new SettingsFileError("This isn't a settings file from The Image Watermarker.");
  }
  if (typeof file.version !== 'number' || file.version > SETTINGS_FILE_VERSION) {
    throw new SettingsFileError('This settings file was made by a newer version of the site.');
  }
  return { ...normalizeSettings(file.settings), tool: current.tool };
}

/**
 * Copies settings into an existing settings object without replacing its
 * nested objects, so parts of the page holding on to them stay connected.
 */
export function applySettingsInPlace(target: AppSettings, source: AppSettings): void {
  const copy = (to: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(from)) {
      const existing = to[key];
      if (value && typeof value === 'object' && existing && typeof existing === 'object') {
        copy(existing as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        to[key] = value;
      }
    }
  };
  copy(
    target as unknown as Record<string, unknown>,
    structuredClone(source) as unknown as Record<string, unknown>,
  );
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
