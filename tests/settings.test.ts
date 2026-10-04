import { describe, expect, it } from 'vitest';
import { formatBytes, formatChange, outputFileName, uniqueNames } from '../src/lib/filename';
import {
  applySettingsInPlace,
  DEFAULT_SETTINGS,
  exportSettings,
  importSettings,
  jobSpecFor,
  normalizeSettings,
  SettingsFileError,
  specKey,
  watermarkSpecFor,
  type AppSettings,
} from '../src/lib/settings';

describe('settings', () => {
  it('defaults match what was agreed: lossless compression, WebP lossless conversion', () => {
    expect(DEFAULT_SETTINGS.compress.mode).toBe('lossless');
    expect(DEFAULT_SETTINGS.convert).toMatchObject({ format: 'webp', lossless: true });
    expect(DEFAULT_SETTINGS.watermark.position).toBe('bottom-right');
    expect(DEFAULT_SETTINGS.output.stripMetadata).toBe(true);
  });

  it('normalizes junk back to defaults', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const n = normalizeSettings({
      tool: 'hack',
      convert: { format: 'exe', quality: 500 },
      output: { resize: { maxWidth: -5 } },
    });
    expect(n.tool).toBe('compress');
    expect(n.convert.format).toBe('webp');
    expect(n.convert.quality).toBe(100);
    expect(n.output.resize.maxWidth).toBe(0);
  });

  it('survives a JSON round trip', () => {
    const s: AppSettings = {
      ...DEFAULT_SETTINGS,
      tool: 'all',
      all: { ...DEFAULT_SETTINGS.all, format: 'keep' },
    };
    expect(normalizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('jobSpecFor', () => {
  const at = (tool: AppSettings['tool'], extra: Partial<AppSettings> = {}) =>
    jobSpecFor({ ...DEFAULT_SETTINGS, ...extra, tool });

  it('compress keeps the format and never makes files bigger', () => {
    const s = at('compress');
    expect(s).toMatchObject({
      target: 'keep',
      lossless: true,
      watermark: null,
      neverBigger: true,
      suffix: '-compressed',
    });
  });

  it('convert uses the chosen format', () => {
    expect(at('convert')).toMatchObject({
      target: 'webp',
      lossless: true,
      watermark: null,
      neverBigger: false,
    });
  });

  it('watermark keeps format and matches the source losslessness', () => {
    const s = at('watermark');
    expect(s.watermark).toEqual(DEFAULT_SETTINGS.watermark);
    expect(s).toMatchObject({ target: 'keep', lossless: 'match-source', quality: 92 });
  });

  it('all-in-one combines the steps', () => {
    expect(at('all').watermark).not.toBeNull();
    expect(at('all', { all: { ...DEFAULT_SETTINGS.all, watermark: false } }).watermark).toBeNull();
  });

  it('includes resize only when switched on', () => {
    expect(at('compress').resize).toBeNull();
    const on = at('compress', {
      output: {
        ...DEFAULT_SETTINGS.output,
        resize: { enabled: true, maxWidth: 100, maxHeight: 0 },
      },
    });
    expect(on.resize).toEqual({ maxWidth: 100, maxHeight: 0 });
  });
});

describe('watermark preview keys', () => {
  const key = (s: AppSettings) => specKey(watermarkSpecFor(s));

  it('describes the Watermark job whichever tab is open', () => {
    expect(watermarkSpecFor({ ...DEFAULT_SETTINGS, tool: 'compress' })).toEqual(
      jobSpecFor({ ...DEFAULT_SETTINGS, tool: 'watermark' }),
    );
    expect(key({ ...DEFAULT_SETTINGS, tool: 'convert' })).toBe(key(DEFAULT_SETTINGS));
  });

  it('changes when a watermark or output setting changes', () => {
    const base = key(DEFAULT_SETTINGS);
    const w = DEFAULT_SETTINGS.watermark;
    expect(key({ ...DEFAULT_SETTINGS, watermark: { ...w, opacity: w.opacity + 1 } })).not.toBe(
      base,
    );
    expect(key({ ...DEFAULT_SETTINGS, watermark: { ...w, blendMode: 'overlay' } })).not.toBe(base);
    expect(
      key({ ...DEFAULT_SETTINGS, watermark: { ...w, motion: { ...w.motion, enabled: true } } }),
    ).not.toBe(base);
    expect(key({ ...DEFAULT_SETTINGS, watermarkQuality: 80 })).not.toBe(base);
    expect(
      key({ ...DEFAULT_SETTINGS, output: { ...DEFAULT_SETTINGS.output, stripMetadata: false } }),
    ).not.toBe(base);
  });

  it('ignores settings that do not affect the watermarked file', () => {
    const base = key(DEFAULT_SETTINGS);
    expect(
      key({ ...DEFAULT_SETTINGS, convert: { ...DEFAULT_SETTINGS.convert, format: 'avif' } }),
    ).toBe(base);
    expect(key({ ...DEFAULT_SETTINGS, compress: { mode: 'visual', quality: 70 } })).toBe(base);
    expect(key({ ...DEFAULT_SETTINGS, all: { ...DEFAULT_SETTINGS.all, format: 'png' } })).toBe(
      base,
    );
  });
});

describe('settings files', () => {
  const custom: AppSettings = {
    ...DEFAULT_SETTINGS,
    tool: 'convert',
    convert: { format: 'jxl', lossless: false, quality: 77 },
    watermark: {
      ...DEFAULT_SETTINGS.watermark,
      variant: 'custom',
      customLabels: { o: 'Q', c: 'Zn', h1: 'X', h2: 'Y' },
      blendMode: 'overlay',
      motion: { enabled: true, amount: 60, angle: 200, style: 'blur' },
    },
    output: { ...DEFAULT_SETTINGS.output, stripMetadata: false, effort: 'maximum' },
  };

  it('round-trips every setting except the open tab', () => {
    const text = exportSettings(custom, new Date('2026-01-02T03:04:05Z'));
    const file = JSON.parse(text);
    expect(file).toMatchObject({ app: 'the-image-watermarker', version: 1 });
    expect(file.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(file.settings.tool).toBeUndefined();
    const current: AppSettings = { ...DEFAULT_SETTINGS, tool: 'watermark' };
    expect(importSettings(text, current)).toEqual({ ...custom, tool: 'watermark' });
  });

  it('rejects files that are not settings files', () => {
    const current = DEFAULT_SETTINGS;
    expect(() => importSettings('not json at all', current)).toThrow(SettingsFileError);
    expect(() => importSettings('{"hello": 1}', current)).toThrow(/isn't a settings file/);
    expect(() => importSettings('null', current)).toThrow(SettingsFileError);
    const newer = JSON.stringify({ app: 'the-image-watermarker', version: 99, settings: {} });
    expect(() => importSettings(newer, current)).toThrow(/newer version/);
  });

  it('falls back to defaults for missing or invalid values', () => {
    const text = JSON.stringify({
      app: 'the-image-watermarker',
      version: 1,
      settings: {
        watermark: { opacity: 'loud', blendMode: 'sparkle' },
        convert: { format: 'exe' },
      },
    });
    const s = importSettings(text, DEFAULT_SETTINGS);
    expect(s.watermark.opacity).toBe(DEFAULT_SETTINGS.watermark.opacity);
    expect(s.watermark.blendMode).toBe('normal');
    expect(s.convert.format).toBe('webp');
    expect(s.compress).toEqual(DEFAULT_SETTINGS.compress);
  });

  it('applies settings in place, keeping nested objects', () => {
    const target = structuredClone(DEFAULT_SETTINGS);
    const { watermark, output } = target;
    const { motion } = watermark;
    applySettingsInPlace(target, custom);
    expect(target).toEqual(custom);
    expect(target.watermark).toBe(watermark);
    expect(target.watermark.motion).toBe(motion);
    expect(target.output).toBe(output);
    // The source is copied, not shared.
    expect(target.watermark.customLabels).not.toBe(custom.watermark.customLabels);
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
