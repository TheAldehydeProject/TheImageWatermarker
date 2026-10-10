import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatBytes, formatChange, outputFileName, uniqueNames } from '../../src/engine/filename';
import {
  applySettingsInPlace,
  exportSettingsFile,
  importSettingsFile,
  loadStoredSettings,
  normalizeResize,
  normalizeTarget,
  num,
  obj,
  saveStoredSettings,
  settingsFileName,
  SettingsFileError,
  specKey,
  targetBytes,
  type SettingsStore,
} from '../../src/engine/settings';

/** A small stand-in tool, so these tests don't depend on any real tool. */
interface Demo {
  level: number;
  nested: { on: boolean; name: string };
}
const DEFAULT_DEMO: Demo = { level: 5, nested: { on: false, name: 'x' } };
const demoStore: SettingsStore<Demo> = {
  tool: 'convert',
  normalize: (input) => {
    const s = obj(input);
    const n = obj(s.nested);
    return {
      level: num(s.level, 0, 10, DEFAULT_DEMO.level),
      nested: {
        on: typeof n.on === 'boolean' ? n.on : DEFAULT_DEMO.nested.on,
        name: typeof n.name === 'string' ? n.name : DEFAULT_DEMO.nested.name,
      },
    };
  },
  fromLegacy: (old) => ({ level: obj(old.convert).quality }),
};

describe('target sizes', () => {
  it('converts KB and MB the same way the page shows sizes (1024-based)', () => {
    const fallback = { value: 500, unit: 'KB' as const };
    expect(targetBytes({ value: 300, unit: 'KB' }, fallback)).toBe(300 * 1024);
    expect(targetBytes({ value: 1.5, unit: 'MB' }, fallback)).toBe(1.5 * 1024 * 1024);
    // Never asks for less than 1 KB; an empty or broken value uses the fallback.
    expect(targetBytes({ value: 0.2, unit: 'KB' }, fallback)).toBe(1024);
    expect(targetBytes({ value: Number.NaN, unit: 'KB' }, fallback)).toBe(500 * 1024);
  });

  it('are checked when loaded', () => {
    const fallback = { value: 50, unit: 'KB' as const };
    expect(normalizeTarget({ value: 2, unit: 'MB' }, fallback)).toEqual({ value: 2, unit: 'MB' });
    expect(normalizeTarget({ value: -5, unit: 'GB' }, fallback)).toEqual({ value: 50, unit: 'KB' });
    expect(normalizeTarget('300kb', fallback)).toEqual(fallback);
    expect(normalizeTarget({ value: 1e9, unit: 'KB' }, fallback).value).toBe(100_000);
  });
});

describe('resize setting', () => {
  it('is checked when loaded', () => {
    expect(normalizeResize({ enabled: true, maxWidth: 800.4, maxHeight: -3 })).toEqual({
      enabled: true,
      maxWidth: 800,
      maxHeight: 0,
    });
    expect(normalizeResize(null)).toEqual({ enabled: false, maxWidth: 2560, maxHeight: 2560 });
  });
});

describe('spec keys', () => {
  it('match exactly when the job is the same', () => {
    expect(specKey({ a: 1, b: [2] })).toBe(specKey({ a: 1, b: [2] }));
    expect(specKey({ a: 1 })).not.toBe(specKey({ a: 2 }));
  });
});

describe('settings files', () => {
  const custom: Demo = { level: 8, nested: { on: true, name: 'mine' } };

  it('round-trip one page’s settings', () => {
    const text = exportSettingsFile(demoStore, custom, new Date('2026-01-02T03:04:05Z'));
    const file = JSON.parse(text);
    expect(file).toMatchObject({ app: 'the-image-watermarker', version: 2, tool: 'convert' });
    expect(file.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(importSettingsFile(demoStore, text)).toEqual(custom);
    expect(settingsFileName('convert')).toBe('image-convert-settings.json');
  });

  it('reject files that are not settings files, or are from a newer site', () => {
    expect(() => importSettingsFile(demoStore, 'not json at all')).toThrow(SettingsFileError);
    expect(() => importSettingsFile(demoStore, '{"hello": 1}')).toThrow(/isn't a settings file/);
    expect(() => importSettingsFile(demoStore, 'null')).toThrow(SettingsFileError);
    const newer = JSON.stringify({ app: 'the-image-watermarker', version: 99, settings: {} });
    expect(() => importSettingsFile(demoStore, newer)).toThrow(/newer version/);
  });

  it('reject another page’s file and say which page it belongs to', () => {
    const other = JSON.stringify({
      app: 'the-image-watermarker',
      version: 2,
      tool: 'watermark',
      settings: {},
    });
    expect(() => importSettingsFile(demoStore, other)).toThrow(/for the Watermark page/);
  });

  it('take this page’s part of a file from the old single-page site', () => {
    const legacy = JSON.stringify({
      app: 'the-image-watermarker',
      version: 1,
      settings: { convert: { quality: 3 }, watermark: {} },
    });
    expect(importSettingsFile(demoStore, legacy)).toEqual({ ...DEFAULT_DEMO, level: 3 });
  });

  it('fall back to defaults for missing or invalid values', () => {
    const text = JSON.stringify({
      app: 'the-image-watermarker',
      version: 2,
      tool: 'convert',
      settings: { level: 'loud', nested: { on: 'yes' } },
    });
    expect(importSettingsFile(demoStore, text)).toEqual(DEFAULT_DEMO);
  });

  it('apply in place, keeping nested objects', () => {
    const target = structuredClone(DEFAULT_DEMO);
    const { nested } = target;
    applySettingsInPlace(target, custom);
    expect(target).toEqual(custom);
    expect(target.nested).toBe(nested);
    // The source is copied, not shared.
    expect(target.nested).not.toBe(custom.nested);
  });
});

describe('saved settings', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('are kept separately for each page', () => {
    saveStoredSettings(demoStore, { level: 2, nested: { on: true, name: 'a' } });
    expect([...store.keys()]).toEqual(['the-image-watermarker:convert:v2']);
    expect(loadStoredSettings(demoStore)).toEqual({ level: 2, nested: { on: true, name: 'a' } });
  });

  it('start from the old single-page site’s settings, then the defaults', () => {
    expect(loadStoredSettings(demoStore)).toEqual(DEFAULT_DEMO);
    store.set('the-image-watermarker:settings:v1', JSON.stringify({ convert: { quality: 7 } }));
    expect(loadStoredSettings(demoStore)).toEqual({ ...DEFAULT_DEMO, level: 7 });
    store.set('the-image-watermarker:convert:v2', 'not json');
    expect(loadStoredSettings(demoStore)).toEqual(DEFAULT_DEMO);
  });
});

describe('file names', () => {
  it('builds output names', () => {
    expect(outputFileName('holiday.JPG', 'jpg', '-compressed')).toBe('holiday-compressed.jpg');
    expect(outputFileName('holiday.png', 'webp', '')).toBe('holiday.webp');
    expect(outputFileName('scan.tif', 'tiff', '')).toBe('scan-converted.tiff');
    expect(outputFileName('photo.jpeg', 'jpg', '')).toBe('photo-converted.jpg');
    expect(outputFileName('.hidden', 'png', '')).toBe('.hidden.png');
    expect(outputFileName('dir/a.b.c.png', 'avif', '-edited')).toBe('a.b.c-edited.avif');
  });

  it('makes ZIP entry names unique', () => {
    expect(uniqueNames(['a.webp', 'A.webp', 'a.webp', 'b.webp'])).toEqual([
      'a.webp',
      'A (2).webp',
      'a (3).webp',
      'b.webp',
    ]);
  });

  it('formats sizes and changes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatChange(1000, 750)).toBe('-25%');
    expect(formatChange(1000, 1100)).toBe('+10%');
    expect(formatChange(1000, 995)).toBe('-0.5%');
  });
});
