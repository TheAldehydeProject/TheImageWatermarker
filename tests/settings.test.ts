import { describe, expect, it } from 'vitest';
import { formatBytes, formatChange, outputFileName, uniqueNames } from '../src/lib/filename';
import {
  DEFAULT_SETTINGS,
  jobSpecFor,
  normalizeSettings,
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
