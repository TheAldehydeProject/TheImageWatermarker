/**
 * Settings helpers shared by the tools: checking values loaded from storage
 * or files, target sizes, and each tool's own saved settings and settings file.
 * Each tool defines its settings in src/tools/<tool>/settings.ts.
 */
import { OUTPUT_FORMATS, type Effort, type OutputFormat } from './formats';

export type ToolId = 'compress' | 'convert' | 'watermark';

export const TOOL_LABELS: Record<ToolId, string> = {
  compress: 'Compress',
  convert: 'Convert',
  watermark: 'Watermark',
};

// ---------------------------------------------------------------------------
// Checking loaded values

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export const isFormat = (v: unknown): v is OutputFormat =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(OUTPUT_FORMATS, v);
export const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
export const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
export const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
export const effort = (v: unknown): Effort => (v === 'maximum' ? 'maximum' : 'balanced');

// ---------------------------------------------------------------------------
// Target sizes

export interface TargetSize {
  value: number;
  unit: 'KB' | 'MB';
}

export function normalizeTarget(v: unknown, fallback: TargetSize): TargetSize {
  const t = obj(v);
  const value =
    typeof t.value === 'number' && Number.isFinite(t.value) && t.value > 0
      ? Math.min(100_000, Math.round(t.value * 100) / 100)
      : fallback.value;
  return { value: Math.max(0.01, value), unit: t.unit === 'MB' ? 'MB' : 'KB' };
}

/** A target size in bytes. KB and MB are 1024-based, as the sizes shown on the page are. */
export function targetBytes(t: TargetSize, fallback: TargetSize): number {
  const value = Number.isFinite(t.value) && t.value > 0 ? t.value : fallback.value;
  return Math.max(1024, Math.round(value * (t.unit === 'MB' ? 1024 * 1024 : 1024)));
}

// ---------------------------------------------------------------------------
// Resizing

export interface ResizeSetting {
  enabled: boolean;
  maxWidth: number;
  maxHeight: number;
}

export const DEFAULT_RESIZE: ResizeSetting = { enabled: false, maxWidth: 2560, maxHeight: 2560 };

export function normalizeResize(v: unknown): ResizeSetting {
  const r = obj(v);
  return {
    enabled: bool(r.enabled, DEFAULT_RESIZE.enabled),
    maxWidth: num(r.maxWidth, 0, 50000, DEFAULT_RESIZE.maxWidth),
    maxHeight: num(r.maxHeight, 0, 50000, DEFAULT_RESIZE.maxHeight),
  };
}

export const resizeLimits = (r: ResizeSetting) =>
  r.enabled ? { maxWidth: r.maxWidth, maxHeight: r.maxHeight } : null;

/**
 * Identifies the output a job would produce. Two specs with the same key give
 * the same file, so a preview made with one is still accurate for the other.
 */
export function specKey(spec: unknown): string {
  return JSON.stringify(spec);
}

// ---------------------------------------------------------------------------
// Saved settings and settings files

const SETTINGS_APP = 'the-image-watermarker';
const SETTINGS_FILE_VERSION = 2;
/** Where the single-page version of the site kept every setting together. */
const LEGACY_STORAGE_KEY = 'the-image-watermarker:settings:v1';

export class SettingsFileError extends Error {}

/** How one tool stores its settings. */
export interface SettingsStore<S> {
  tool: ToolId;
  /** Checks loaded values, filling gaps with the defaults. */
  normalize(input: unknown): S;
  /** Picks this tool's settings out of the old all-in-one settings (version 1). */
  fromLegacy(old: Record<string, unknown>): unknown;
}

export const settingsFileName = (tool: ToolId) => `image-${tool}-settings.json`;
const storageKey = (tool: ToolId) => `the-image-watermarker:${tool}:v2`;

/** The contents of a downloadable settings file for one tool. */
export function exportSettingsFile<S>(store: SettingsStore<S>, s: S, now = new Date()): string {
  return JSON.stringify(
    {
      app: SETTINGS_APP,
      version: SETTINGS_FILE_VERSION,
      tool: store.tool,
      exportedAt: now.toISOString(),
      settings: s,
    },
    null,
    2,
  );
}

/**
 * Reads a settings file. Missing or invalid values fall back to the defaults.
 * Files from the old single-page site (version 1) hold every tool's settings,
 * so this tool's part is taken from them.
 */
export function importSettingsFile<S>(store: SettingsStore<S>, text: string): S {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const file = obj(data);
  if (file.app !== SETTINGS_APP) {
    throw new SettingsFileError("This isn't a settings file from The Image Watermarker.");
  }
  if (typeof file.version !== 'number' || file.version > SETTINGS_FILE_VERSION) {
    throw new SettingsFileError('This settings file was made by a newer version of the site.');
  }
  if (file.version < 2) return store.normalize(store.fromLegacy(obj(file.settings)));
  if (file.tool !== store.tool) {
    const other = TOOL_LABELS[file.tool as ToolId];
    throw new SettingsFileError(
      other
        ? `This settings file is for the ${other} page. Upload it there instead.`
        : "This settings file isn't for this page.",
    );
  }
  return store.normalize(file.settings);
}

/** This tool's saved settings, or the old site's settings for it, or the defaults. */
export function loadStoredSettings<S>(store: SettingsStore<S>): S {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(store.tool));
    if (raw) return store.normalize(JSON.parse(raw));
    const legacy = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return store.normalize(store.fromLegacy(obj(JSON.parse(legacy))));
  } catch {
    // Unreadable storage: use the defaults.
  }
  return store.normalize({});
}

export function saveStoredSettings<S>(store: SettingsStore<S>, s: S): void {
  try {
    globalThis.localStorage?.setItem(storageKey(store.tool), JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); settings
    // then simply last for this visit.
  }
}

/**
 * Copies settings into an existing settings object without replacing its
 * nested objects, so parts of the page holding on to them stay connected.
 */
export function applySettingsInPlace<S extends object>(target: S, source: S): void {
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
