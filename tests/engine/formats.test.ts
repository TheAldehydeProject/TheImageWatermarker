import { describe, expect, it } from 'vitest';
import { detectFormat, fileExtension, isLosslessWebP, writableAs } from '../../src/engine/formats';

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  while (out.length < 32) out.push(0);
  return new Uint8Array(out);
};

describe('detectFormat', () => {
  it('recognises formats by their bytes, whatever the file is called', () => {
    expect(detectFormat(bytes([0xff, 0xd8, 0xff, 0xe0]), 'x.png')).toBe('jpeg');
    expect(detectFormat(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]), 'x')).toBe('png');
    expect(detectFormat(bytes('RIFF', [0, 0, 0, 0], 'WEBP'), 'a.jpg')).toBe('webp');
    expect(detectFormat(bytes('GIF89a'), 'a')).toBe('gif');
    expect(detectFormat(bytes('BM'), 'a')).toBe('bmp');
    expect(detectFormat(bytes([0xff, 0x0a]), 'a')).toBe('jxl');
    expect(detectFormat(bytes([0, 0, 0, 0x0c], 'JXL ', [0x0d, 0x0a, 0x87, 0x0a]), 'a')).toBe('jxl');
  });

  it('tells AVIF, HEIC and Canon CR3 apart', () => {
    expect(detectFormat(bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1'), 'a')).toBe(
      'avif',
    );
    expect(detectFormat(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'), 'a')).toBe(
      'heic',
    );
    expect(detectFormat(bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0], 'mif1avif'), 'a')).toBe(
      'avif',
    );
    expect(detectFormat(bytes([0, 0, 0, 0x18], 'ftypcrx ', [0, 0, 0, 1], 'crx isom'), 'a')).toBe(
      'raw',
    );
  });

  it('separates TIFF from TIFF-based RAW formats', () => {
    const tiffLE = bytes([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
    expect(detectFormat(tiffLE, 'scan.tif')).toBe('tiff');
    expect(detectFormat(tiffLE, 'IMG_0001.NEF')).toBe('raw');
    expect(detectFormat(tiffLE, 'photo.dng')).toBe('raw');
    expect(detectFormat(bytes([0x49, 0x49, 42, 0, 16, 0, 0, 0], 'CR'), 'x.tif')).toBe('raw');
    expect(detectFormat(bytes([0x49, 0x49, 0x52, 0x4f]), 'x')).toBe('raw'); // Olympus
    expect(detectFormat(bytes([0x49, 0x49, 0x55, 0]), 'x')).toBe('raw'); // Panasonic
    expect(detectFormat(bytes('FUJIFILMCCD-RAW 0201'), 'x')).toBe('raw');
  });

  it('falls back to the extension, and gives up on unknown files', () => {
    expect(detectFormat(new Uint8Array(4), 'x.heic')).toBe('heic');
    expect(detectFormat(bytes('hello world'), 'notes.txt')).toBeNull();
  });
});

describe('format helpers', () => {
  it('knows which formats can be written', () => {
    expect(writableAs('jpeg')).toBe('jpeg');
    expect(writableAs('tiff')).toBe('tiff');
    expect(writableAs('raw')).toBeNull();
    expect(writableAs('heic')).toBeNull();
    expect(writableAs('gif')).toBeNull();
  });

  it('reads extensions', () => {
    expect(fileExtension('a.b.JPG')).toBe('jpg');
    expect(fileExtension('noext')).toBe('');
  });

  it('detects lossless WebP', () => {
    const chunk = (id: string) =>
      bytes('RIFF', [20, 0, 0, 0], 'WEBP', id, [4, 0, 0, 0, 0, 0, 0, 0]);
    expect(isLosslessWebP(chunk('VP8L'))).toBe(true);
    expect(isLosslessWebP(chunk('VP8 '))).toBe(false);
  });
});
