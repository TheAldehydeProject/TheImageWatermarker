export type InputFormat =
  'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'avif' | 'heic' | 'jxl' | 'raw';

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'jxl' | 'tiff';

/** How hard the encoders try: 'maximum' squeezes out a few more percent, much more slowly. */
export type Effort = 'balanced' | 'maximum';

export interface OutputFormatInfo {
  label: string;
  extension: string;
  mime: string;
  /** Can store pixels exactly. */
  lossless: boolean;
  /** Has a quality setting. */
  lossy: boolean;
  /** Can carry EXIF metadata through this app. */
  exif: boolean;
  /** Can carry an ICC colour profile through this app. */
  icc: boolean;
  note: string;
}

export const OUTPUT_FORMATS: Record<OutputFormat, OutputFormatInfo> = {
  webp: {
    label: 'WebP',
    extension: 'webp',
    mime: 'image/webp',
    lossless: true,
    lossy: true,
    exif: true,
    icc: true,
    note: 'Lossless is about a quarter smaller than PNG, and it opens everywhere.',
  },
  jxl: {
    label: 'JPEG XL',
    extension: 'jxl',
    mime: 'image/jxl',
    lossless: true,
    lossy: true,
    exif: false,
    icc: false,
    note: 'Smallest files, but most browsers (Chrome, Edge, Firefox) cannot display it yet. Safari can.',
  },
  avif: {
    label: 'AVIF',
    extension: 'avif',
    mime: 'image/avif',
    lossless: true,
    lossy: true,
    exif: false,
    icc: false,
    note: 'Best for small "visually lossless" photos. Its lossless mode is weak.',
  },
  png: {
    label: 'PNG',
    extension: 'png',
    mime: 'image/png',
    lossless: true,
    lossy: false,
    exif: true,
    icc: true,
    note: 'Lossless and universal, but larger than WebP.',
  },
  jpeg: {
    label: 'JPG',
    extension: 'jpg',
    mime: 'image/jpeg',
    lossless: false,
    lossy: true,
    exif: true,
    icc: true,
    note: 'Universal, lossy only. No transparency.',
  },
  tiff: {
    label: 'TIFF',
    extension: 'tiff',
    mime: 'image/tiff',
    lossless: true,
    lossy: false,
    exif: false,
    icc: true,
    note: 'Lossless (Deflate). Common in print and archiving.',
  },
};

export const OUTPUT_FORMAT_ORDER: OutputFormat[] = ['webp', 'jxl', 'avif', 'png', 'jpeg', 'tiff'];

export const INPUT_FORMAT_LABELS: Record<InputFormat, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  avif: 'AVIF',
  heic: 'HEIC',
  jxl: 'JPEG XL',
  raw: 'RAW',
};

export const RAW_EXTENSIONS = [
  '3fr',
  'arw',
  'cr2',
  'cr3',
  'crw',
  'dcr',
  'dng',
  'erf',
  'iiq',
  'kdc',
  'mef',
  'mos',
  'mrw',
  'nef',
  'nrw',
  'orf',
  'pef',
  'raf',
  'raw',
  'rw2',
  'rwl',
  'sr2',
  'srf',
  'srw',
  'x3f',
];

const EXTENSION_FORMATS: Record<string, InputFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  jfif: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  bmp: 'bmp',
  dib: 'bmp',
  tif: 'tiff',
  tiff: 'tiff',
  avif: 'avif',
  heic: 'heic',
  heif: 'heic',
  hif: 'heic',
  jxl: 'jxl',
  ...Object.fromEntries(RAW_EXTENSIONS.map((ext) => [ext, 'raw' as const])),
};

/** Value for an `<input type="file" accept>` attribute. */
export const ACCEPT_ATTRIBUTE = [
  'image/*',
  ...Object.keys(EXTENSION_FORMATS).map((ext) => `.${ext}`),
].join(',');

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

const HEIC_BRANDS = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
];

function isoBrands(bytes: Uint8Array): string[] {
  const size = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  const brands = [ascii(bytes, 8, 4)];
  for (let off = 16; off + 4 <= Math.min(size, bytes.length); off += 4) {
    brands.push(ascii(bytes, off, 4));
  }
  return brands;
}

/**
 * Works out what kind of image a file is. The file's own bytes win; the
 * extension is only used where the bytes are ambiguous (RAW formats are
 * mostly TIFF underneath).
 */
export function detectFormat(bytes: Uint8Array, fileName: string): InputFormat | null {
  const ext = fileExtension(fileName);
  const byExt = EXTENSION_FORMATS[ext] ?? null;
  if (bytes.length < 12) return byExt;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (bytes[0] === 0xff && bytes[1] === 0x0a) return 'jxl';
  if (
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 0 &&
    bytes[3] === 0x0c &&
    ascii(bytes, 4, 4) === 'JXL '
  ) {
    return 'jxl';
  }
  if (ascii(bytes, 0, 15) === 'FUJIFILMCCD-RAW') return 'raw';
  if (ascii(bytes, 0, 4) === 'FOVb') return 'raw';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brands = isoBrands(bytes);
    if (brands.includes('crx ')) return 'raw';
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.some((b) => HEIC_BRANDS.includes(b))) return 'heic';
    return byExt;
  }
  const tiffLE = bytes[0] === 0x49 && bytes[1] === 0x49;
  const tiffBE = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (tiffLE || tiffBE) {
    const magic = tiffLE ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3];
    // Olympus (IIRO/IIRS/MMOR) and Panasonic (IIU) use their own magic numbers.
    if (magic === 0x4f52 || magic === 0x5352 || magic === 0x0055) return 'raw';
    if (magic === 42) {
      if (ascii(bytes, 8, 2) === 'CR') return 'raw';
      return byExt === 'raw' ? 'raw' : 'tiff';
    }
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  return byExt;
}

/** Formats this app can write back out in the same format. */
export function writableAs(format: InputFormat): OutputFormat | null {
  switch (format) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'avif':
    case 'jxl':
    case 'tiff':
      return format;
    default:
      return null;
  }
}

/** Whether a WebP file uses the lossless (VP8L) bitstream. */
export function isLosslessWebP(bytes: Uint8Array): boolean {
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size =
      (bytes[off + 4] | (bytes[off + 5] << 8) | (bytes[off + 6] << 16) | (bytes[off + 7] << 24)) >>>
      0;
    if (id === 'VP8L') return true;
    if (id === 'VP8 ') return false;
    off += 8 + size + (size & 1);
  }
  return false;
}
