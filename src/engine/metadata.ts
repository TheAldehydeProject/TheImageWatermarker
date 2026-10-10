import { unzlibSync, zlibSync } from 'fflate';
import type { InputFormat } from './formats';

/**
 * Metadata carried from the original file. `exif` is a raw TIFF-structured
 * EXIF block (without the JPEG "Exif\0\0" prefix); `icc` is an ICC profile.
 */
export interface ImageMetadata {
  exif?: Uint8Array;
  icc?: Uint8Array;
  /** EXIF orientation 1–8 (1 = upright). */
  orientation: number;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
const ICC_HEADER = 'ICC_PROFILE\0';

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// EXIF (TIFF structure)
// ---------------------------------------------------------------------------

interface TiffView {
  le: boolean;
  u16(o: number): number;
  u32(o: number): number;
  set16(o: number, v: number): void;
  set32(o: number, v: number): void;
}

function tiffView(t: Uint8Array): TiffView | null {
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  const be = t[0] === 0x4d && t[1] === 0x4d;
  if (!le && !be) return null;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  return {
    le,
    u16: (o) => dv.getUint16(o, le),
    u32: (o) => dv.getUint32(o, le),
    set16: (o, v) => dv.setUint16(o, v, le),
    set32: (o, v) => dv.setUint32(o, v, le),
  };
}

const TAG_ORIENTATION = 0x0112;
const TAG_GPS_IFD = 0x8825;

/** Reads the orientation tag from IFD0 of an EXIF block. Returns 1 if absent. */
export function exifOrientation(exif: Uint8Array): number {
  const v = tiffView(exif);
  if (!v) return 1;
  try {
    const ifd = v.u32(4);
    const count = v.u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (v.u16(e) === TAG_ORIENTATION) {
        const value = v.u16(e + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    return 1;
  }
  return 1;
}

/**
 * Prepares an EXIF block for a re-encoded image: orientation is reset to 1
 * (pixels are already rotated upright) and the link to the embedded
 * thumbnail (IFD1) is removed, because that thumbnail would show the old,
 * un-watermarked picture.
 */
export function exifForReencode(exif: Uint8Array): Uint8Array {
  const copy = new Uint8Array(exif);
  const v = tiffView(copy);
  if (!v) return copy;
  try {
    const ifd = v.u32(4);
    const count = v.u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (v.u16(e) === TAG_ORIENTATION) v.set16(e + 8, 1);
    }
    v.set32(ifd + 2 + count * 12, 0);
  } catch {
    return copy;
  }
  return copy;
}

/** Whether an EXIF block contains GPS location data. */
export function exifHasGps(exif: Uint8Array): boolean {
  const v = tiffView(exif);
  if (!v) return false;
  try {
    const ifd = v.u32(4);
    const count = v.u16(ifd);
    for (let i = 0; i < count; i++) {
      if (v.u16(ifd + 2 + i * 12) === TAG_GPS_IFD) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** A minimal EXIF block containing only an orientation tag. */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const t = new Uint8Array(26);
  t.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]); // little-endian TIFF header, IFD0 at offset 8
  const v = tiffView(t)!;
  v.set16(8, 1); // one entry
  v.set16(10, TAG_ORIENTATION);
  v.set16(12, 3); // SHORT
  v.set32(14, 1); // count
  v.set16(18, orientation);
  v.set32(22, 0); // no next IFD
  return t;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

export interface JpegSegment {
  marker: number;
  /** Offset of the 0xFF byte. */
  start: number;
  /** Offset just past the segment. */
  end: number;
  /** Offset of the segment payload (after the length field). */
  dataStart: number;
}

/**
 * Lists the marker segments before the first scan (SOS). The SOS segment
 * itself is included as the last entry; everything after it is scan data.
 */
export function jpegHeaderSegments(bytes: Uint8Array): JpegSegment[] {
  const out: JpegSegment[] = [];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return out;
  let off = 2;
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) break;
    let marker = bytes[off + 1];
    while (marker === 0xff && off + 2 < bytes.length) {
      off++;
      marker = bytes[off + 1];
    }
    const len = (bytes[off + 2] << 8) | bytes[off + 3];
    const seg = { marker, start: off, end: off + 2 + len, dataStart: off + 4 };
    out.push(seg);
    if (marker === 0xda || seg.end > bytes.length) break;
    off = seg.end;
  }
  return out;
}

/**
 * How a JPEG stores its colour: 1 = full resolution (4:4:4), 2 = halved
 * (4:2:0, or 4:2:2 which the encoder can't reproduce exactly), or null for
 * greyscale or unreadable files. Read from the frame header (SOFn).
 */
export function jpegChromaSubsampling(bytes: Uint8Array): 1 | 2 | null {
  for (const seg of jpegHeaderSegments(bytes)) {
    const m = seg.marker;
    const isFrame = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (!isFrame) continue;
    // Payload: precision, height (2), width (2), component count, then 3 bytes per component.
    const count = bytes[seg.dataStart + 5];
    if (count < 3 || seg.dataStart + 6 + 3 * count > bytes.length) return null;
    const y = bytes[seg.dataStart + 7];
    return Math.max(y >> 4, y & 0x0f) >= 2 ? 2 : 1;
  }
  return null;
}

function isExifSegment(bytes: Uint8Array, s: JpegSegment): boolean {
  return s.marker === 0xe1 && EXIF_HEADER.every((b, i) => bytes[s.dataStart + i] === b);
}

function isIccSegment(bytes: Uint8Array, s: JpegSegment): boolean {
  return s.marker === 0xe2 && ascii(bytes, s.dataStart, 12) === ICC_HEADER;
}

export function extractJpegMetadata(bytes: Uint8Array): ImageMetadata {
  const segs = jpegHeaderSegments(bytes);
  let exif: Uint8Array | undefined;
  const iccChunks: { seq: number; data: Uint8Array }[] = [];
  for (const s of segs) {
    if (!exif && isExifSegment(bytes, s)) {
      exif = bytes.slice(s.dataStart + 6, s.end);
    } else if (isIccSegment(bytes, s)) {
      iccChunks.push({ seq: bytes[s.dataStart + 12], data: bytes.slice(s.dataStart + 14, s.end) });
    }
  }
  iccChunks.sort((a, b) => a.seq - b.seq);
  const icc = iccChunks.length ? concat(iccChunks.map((c) => c.data)) : undefined;
  return { exif, icc, orientation: exif ? exifOrientation(exif) : 1 };
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  if (len > 0xffff) throw new Error('JPEG segment too large');
  return concat([new Uint8Array([0xff, marker, len >> 8, len & 0xff]), payload]);
}

export function jpegExifSegment(exif: Uint8Array): Uint8Array | null {
  if (exif.length + 8 > 0xffff) return null;
  return jpegSegment(0xe1, concat([new Uint8Array(EXIF_HEADER), exif]));
}

export function jpegIccSegments(icc: Uint8Array): Uint8Array[] {
  const maxChunk = 0xffff - 2 - 14;
  const count = Math.ceil(icc.length / maxChunk);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const header = new Uint8Array(14);
    for (let j = 0; j < 12; j++) header[j] = ICC_HEADER.charCodeAt(j);
    header[12] = i + 1;
    header[13] = count;
    out.push(jpegSegment(0xe2, concat([header, icc.subarray(i * maxChunk, (i + 1) * maxChunk)])));
  }
  return out;
}

/**
 * Inserts EXIF/ICC segments into a freshly encoded JPEG (right after the
 * JFIF APP0 segment if there is one), replacing any it already has.
 */
export function injectJpegMetadata(
  jpeg: Uint8Array,
  meta: { exif?: Uint8Array; icc?: Uint8Array },
): Uint8Array {
  if (!meta.exif && !meta.icc) return jpeg;
  const segs = jpegHeaderSegments(jpeg);
  const insertAt = segs.length && segs[0].marker === 0xe0 ? segs[0].end : 2;
  const extra: Uint8Array[] = [];
  if (meta.exif) {
    const seg = jpegExifSegment(meta.exif);
    if (seg) extra.push(seg);
  }
  if (meta.icc) extra.push(...jpegIccSegments(meta.icc));
  // Drop existing EXIF/ICC segments so we never end up with duplicates.
  const kept: Uint8Array[] = [jpeg.subarray(0, insertAt), ...extra];
  let cursor = insertAt;
  for (const s of segs) {
    if (s.start < insertAt) continue;
    if ((meta.exif && isExifSegment(jpeg, s)) || (meta.icc && isIccSegment(jpeg, s))) {
      kept.push(jpeg.subarray(cursor, s.start));
      cursor = s.end;
    }
  }
  kept.push(jpeg.subarray(cursor));
  return concat(kept);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface PngChunk {
  type: string;
  start: number;
  end: number;
  dataStart: number;
  dataEnd: number;
}

function pngChunks(bytes: Uint8Array): PngChunk[] {
  const out: PngChunk[] = [];
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = u32be(bytes, off);
    const type = ascii(bytes, off + 4, 4);
    const end = off + 12 + len;
    if (end > bytes.length) break;
    out.push({ type, start: off, end, dataStart: off + 8, dataEnd: off + 8 + len });
    if (type === 'IEND') break;
    off = end;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function extractPngMetadata(bytes: Uint8Array): ImageMetadata {
  let exif: Uint8Array | undefined;
  let icc: Uint8Array | undefined;
  for (const c of pngChunks(bytes)) {
    if (c.type === 'eXIf' && !exif) exif = bytes.slice(c.dataStart, c.dataEnd);
    if (c.type === 'iCCP' && !icc) {
      const data = bytes.subarray(c.dataStart, c.dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0 && data[nul + 1] === 0) {
        try {
          icc = unzlibSync(data.subarray(nul + 2));
        } catch {
          icc = undefined;
        }
      }
    }
  }
  return { exif, icc, orientation: exif ? exifOrientation(exif) : 1 };
}

/** Adds iCCP and eXIf chunks to a PNG, replacing colour-space chunks they conflict with. */
export function injectPngMetadata(
  png: Uint8Array,
  meta: { exif?: Uint8Array; icc?: Uint8Array },
): Uint8Array {
  if (!meta.exif && !meta.icc) return png;
  const chunks = pngChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) return png;
  const parts: Uint8Array[] = [png.subarray(0, ihdr.end)];
  if (meta.icc) {
    const name = new TextEncoder().encode('ICC profile');
    parts.push(
      pngChunk('iCCP', concat([name, new Uint8Array([0, 0]), zlibSync(meta.icc, { level: 9 })])),
    );
  }
  if (meta.exif) parts.push(pngChunk('eXIf', meta.exif));
  for (const c of chunks) {
    if (c.type === 'IHDR') continue;
    if (meta.icc && (c.type === 'iCCP' || c.type === 'sRGB')) continue;
    if (meta.exif && c.type === 'eXIf') continue;
    parts.push(png.subarray(c.start, c.end));
  }
  return concat(parts);
}

/** Chunks that only carry metadata (text, EXIF, timestamps); safe to drop. */
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** Removes text/EXIF/time chunks from a PNG without touching the pixels. */
export function stripPngMetadata(png: Uint8Array): Uint8Array {
  const chunks = pngChunks(png);
  if (!chunks.some((c) => PNG_METADATA_CHUNKS.has(c.type))) return png;
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const c of chunks) {
    if (!PNG_METADATA_CHUNKS.has(c.type)) parts.push(png.subarray(c.start, c.end));
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

interface RiffChunk {
  id: string;
  start: number;
  end: number;
  dataStart: number;
  dataEnd: number;
}

function riffChunks(bytes: Uint8Array): RiffChunk[] {
  const out: RiffChunk[] = [];
  let off = 12;
  while (off + 8 <= bytes.length) {
    const size = u32le(bytes, off + 4);
    const dataEnd = off + 8 + size;
    const end = dataEnd + (size & 1);
    if (dataEnd > bytes.length) break;
    out.push({
      id: ascii(bytes, off, 4),
      start: off,
      end: Math.min(end, bytes.length),
      dataStart: off + 8,
      dataEnd,
    });
    off = end;
  }
  return out;
}

function riffChunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

export function extractWebpMetadata(bytes: Uint8Array): ImageMetadata {
  let exif: Uint8Array | undefined;
  let icc: Uint8Array | undefined;
  for (const c of riffChunks(bytes)) {
    if (c.id === 'EXIF' && !exif) {
      exif = bytes.slice(c.dataStart, c.dataEnd);
      // Some writers wrongly keep the JPEG "Exif\0\0" prefix.
      if (EXIF_HEADER.every((b, i) => exif![i] === b)) exif = exif.slice(6);
    }
    if (c.id === 'ICCP' && !icc) icc = bytes.slice(c.dataStart, c.dataEnd);
  }
  return { exif, icc, orientation: exif ? exifOrientation(exif) : 1 };
}

/** Dimensions stored in a WebP bitstream chunk. */
function webpCanvasSize(bytes: Uint8Array, c: RiffChunk): [number, number] | null {
  const d = c.dataStart;
  if (c.id === 'VP8X') {
    const w = 1 + (bytes[d + 4] | (bytes[d + 5] << 8) | (bytes[d + 6] << 16));
    const h = 1 + (bytes[d + 7] | (bytes[d + 8] << 8) | (bytes[d + 9] << 16));
    return [w, h];
  }
  if (c.id === 'VP8L') {
    const b = u32le(bytes, d + 1);
    return [(b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1];
  }
  if (c.id === 'VP8 ') {
    const w = (bytes[d + 6] | (bytes[d + 7] << 8)) & 0x3fff;
    const h = (bytes[d + 8] | (bytes[d + 9] << 8)) & 0x3fff;
    return [w, h];
  }
  return null;
}

/** Adds ICCP/EXIF chunks to a WebP file, converting it to the extended (VP8X) layout. */
export function injectWebpMetadata(
  webp: Uint8Array,
  meta: { exif?: Uint8Array; icc?: Uint8Array },
  hasAlpha: boolean,
): Uint8Array {
  if (!meta.exif && !meta.icc) return webp;
  const chunks = riffChunks(webp);
  const vp8x = chunks.find((c) => c.id === 'VP8X');
  const bitstream = chunks.find((c) => c.id === 'VP8 ' || c.id === 'VP8L');
  if (!bitstream) return webp;
  const size = webpCanvasSize(webp, vp8x ?? bitstream);
  if (!size) return webp;
  let flags = vp8x ? webp[vp8x.dataStart] : 0;
  if (hasAlpha || chunks.some((c) => c.id === 'ALPH')) flags |= 0x10;
  if (meta.icc) flags |= 0x20;
  if (meta.exif) flags |= 0x08;
  const header = new Uint8Array(10);
  header[0] = flags;
  const w = size[0] - 1;
  const h = size[1] - 1;
  header.set(
    [w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff],
    4,
  );

  const body: Uint8Array[] = [riffChunk('VP8X', header)];
  if (meta.icc) body.push(riffChunk('ICCP', meta.icc));
  for (const c of chunks) {
    if (c.id === 'VP8X' || c.id === 'ICCP' || c.id === 'EXIF') continue;
    body.push(webp.subarray(c.start, c.end));
  }
  if (meta.exif) body.push(riffChunk('EXIF', meta.exif));
  const payload = concat(body);
  const out = new Uint8Array(12 + payload.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(out.buffer).setUint32(4, payload.length + 4, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set(payload, 12);
  return out;
}

/** Removes EXIF and XMP chunks from a WebP file without re-encoding it. */
export function stripWebpMetadata(webp: Uint8Array): Uint8Array {
  const chunks = riffChunks(webp);
  if (!chunks.some((c) => c.id === 'EXIF' || c.id === 'XMP ')) return webp;
  const body: Uint8Array[] = [];
  for (const c of chunks) {
    if (c.id === 'EXIF' || c.id === 'XMP ') continue;
    if (c.id === 'VP8X') {
      const copy = webp.slice(c.start, c.end);
      copy[8] &= ~(0x08 | 0x04);
      body.push(copy);
      continue;
    }
    body.push(webp.subarray(c.start, c.end));
  }
  const payload = concat(body);
  const out = new Uint8Array(12 + payload.length);
  out.set(webp.subarray(0, 4), 0);
  new DataView(out.buffer).setUint32(4, payload.length + 4, true);
  out.set(webp.subarray(8, 12), 8);
  out.set(payload, 12);
  return out;
}

// ---------------------------------------------------------------------------

/** Reads EXIF/ICC/orientation from any supported container. */
export function extractMetadata(bytes: Uint8Array, format: InputFormat): ImageMetadata {
  try {
    switch (format) {
      case 'jpeg':
        return extractJpegMetadata(bytes);
      case 'png':
        return extractPngMetadata(bytes);
      case 'webp':
        return extractWebpMetadata(bytes);
      default:
        return { orientation: 1 };
    }
  } catch {
    return { orientation: 1 };
  }
}
