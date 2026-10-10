/**
 * Lossless JPEG optimisation.
 *
 * Re-writes the Huffman (entropy) coding of baseline/extended sequential
 * JPEGs with tables built for this exact image, which is what
 * `jpegtran -optimize` does. The quantised DCT coefficients are untouched,
 * so the decoded pixels are bit-for-bit identical. Metadata can be stripped
 * at the same time. Progressive and arithmetic-coded files keep their
 * existing coding and only get the metadata treatment.
 */
import { jpegExifSegment, exifOrientation, orientationOnlyExif } from '../../engine/metadata';

export interface JpegOptimizeOptions {
  /** Remove EXIF, XMP, IPTC, comments and similar. ICC profiles are always kept. */
  stripMetadata: boolean;
}

export interface JpegOptimizeResult {
  bytes: Uint8Array;
  /** False when the file's coding could not be optimised (e.g. progressive). */
  huffmanOptimized: boolean;
}

interface Segment {
  marker: number;
  bytes: Uint8Array;
}

interface Scan {
  sos: Uint8Array;
  data: Uint8Array;
}

type Item = { kind: 'segment'; seg: Segment } | { kind: 'scan'; scan: Scan };

class JpegError extends Error {}

function parse(bytes: Uint8Array): Item[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new JpegError('Not a JPEG');
  const items: Item[] = [];
  let off = 2;
  while (off < bytes.length) {
    if (bytes[off] !== 0xff) throw new JpegError('Expected marker');
    while (bytes[off + 1] === 0xff) off++; // fill bytes
    const marker = bytes[off + 1];
    if (marker === 0xd9) return items; // EOI: anything after it is dropped
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw new JpegError('Unexpected standalone marker');
    }
    const len = (bytes[off + 2] << 8) | bytes[off + 3];
    const end = off + 2 + len;
    if (len < 2 || end > bytes.length) throw new JpegError('Truncated segment');
    const segBytes = bytes.subarray(off, end);
    if (marker === 0xda) {
      // Entropy-coded data runs until the next marker that is not a restart.
      let p = end;
      while (p + 1 < bytes.length) {
        if (bytes[p] === 0xff) {
          const n = bytes[p + 1];
          if (n !== 0x00 && n !== 0xff && !(n >= 0xd0 && n <= 0xd7)) break;
        }
        p++;
      }
      if (p + 1 >= bytes.length) p = bytes.length;
      items.push({ kind: 'scan', scan: { sos: segBytes, data: bytes.subarray(end, p) } });
      off = p;
    } else {
      items.push({ kind: 'segment', seg: { marker, bytes: segBytes } });
      off = end;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Huffman tables

interface DecodeTable {
  maxcode: Int32Array; // index 1..17
  valptr: Int32Array;
  mincode: Int32Array;
  values: Uint8Array;
  /** 9-bit lookahead: (length << 8) | symbol, or 0 if longer than 9 bits. */
  lut: Uint16Array;
}

const LOOKAHEAD = 9;

function buildDecodeTable(counts: Uint8Array, values: Uint8Array): DecodeTable {
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  const lut = new Uint16Array(1 << LOOKAHEAD);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    const n = counts[l - 1];
    if (n) {
      valptr[l] = k;
      mincode[l] = code;
      for (let i = 0; i < n; i++) {
        if (l <= LOOKAHEAD) {
          const shift = LOOKAHEAD - l;
          const base = code << shift;
          for (let j = 0; j < 1 << shift; j++) lut[base + j] = (l << 8) | values[k];
        }
        code++;
        k++;
      }
      maxcode[l] = code - 1;
    }
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  return { maxcode, valptr, mincode, values, lut };
}

/** Optimal code lengths for the given symbol frequencies (JPEG Annex K.2, as in libjpeg). */
export function optimalTable(freqIn: ArrayLike<number>): {
  counts: Uint8Array;
  values: Uint8Array;
} {
  const freq = new Float64Array(257);
  let any = false;
  for (let i = 0; i < 256; i++) {
    freq[i] = freqIn[i] ?? 0;
    if (freq[i] > 0) any = true;
  }
  if (!any) freq[0] = 1;
  freq[256] = 1; // reserved so no code is all ones
  const codesize = new Int32Array(257);
  const others = new Int32Array(257).fill(-1);
  for (;;) {
    let c1 = -1;
    let v = Infinity;
    for (let i = 0; i <= 256; i++) {
      if (freq[i] && freq[i] <= v) {
        v = freq[i];
        c1 = i;
      }
    }
    let c2 = -1;
    v = Infinity;
    for (let i = 0; i <= 256; i++) {
      if (freq[i] && freq[i] <= v && i !== c1) {
        v = freq[i];
        c2 = i;
      }
    }
    if (c2 < 0) break;
    freq[c1] += freq[c2];
    freq[c2] = 0;
    codesize[c1]++;
    while (others[c1] >= 0) {
      c1 = others[c1];
      codesize[c1]++;
    }
    others[c1] = c2;
    codesize[c2]++;
    while (others[c2] >= 0) {
      c2 = others[c2];
      codesize[c2]++;
    }
  }
  // A tree over 257 symbols is at most 256 levels deep.
  const MAX_DEPTH = 257;
  const bits = new Int32Array(MAX_DEPTH + 1);
  for (let i = 0; i <= 256; i++) {
    if (codesize[i]) bits[codesize[i]]++;
  }
  // Limit code lengths to 16 bits.
  for (let i = MAX_DEPTH; i > 16; i--) {
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i] -= 2;
      bits[i - 1]++;
      bits[j + 1] += 2;
      bits[j]--;
    }
  }
  // Remove the reserved code point from the longest length.
  let i = 16;
  while (bits[i] === 0) i--;
  bits[i]--;
  const counts = new Uint8Array(16);
  for (let l = 1; l <= 16; l++) counts[l - 1] = bits[l];
  const values: number[] = [];
  for (let l = 1; l <= MAX_DEPTH; l++) {
    for (let s = 0; s < 256; s++) if (codesize[s] === l) values.push(s);
  }
  return { counts, values: new Uint8Array(values) };
}

function encodeCodes(
  counts: Uint8Array,
  values: Uint8Array,
): { code: Uint16Array; size: Uint8Array } {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let c = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < counts[l - 1]; i++) {
      code[values[k]] = c++;
      size[values[k]] = l;
      k++;
    }
    c <<= 1;
  }
  return { code, size };
}

// ---------------------------------------------------------------------------
// Bit I/O

class BitReader {
  private pos = 0;
  private buf = 0;
  private cnt = 0;
  constructor(private data: Uint8Array) {}

  private fill(): void {
    while (this.cnt <= 24) {
      let b = 0;
      if (this.pos < this.data.length) {
        b = this.data[this.pos];
        if (b === 0xff) {
          const n = this.data[this.pos + 1];
          if (n === 0x00) {
            this.pos += 2;
          } else {
            b = 0; // hit a marker: feed zeros without consuming it
          }
        } else {
          this.pos++;
        }
      }
      this.buf = ((this.buf << 8) | b) >>> 0;
      this.cnt += 8;
    }
  }

  peek(n: number): number {
    if (this.cnt < n) this.fill();
    return (this.buf >>> (this.cnt - n)) & ((1 << n) - 1);
  }

  skip(n: number): void {
    this.cnt -= n;
    this.buf &= this.cnt === 0 ? 0 : 0xffffffff >>> (32 - this.cnt);
  }

  bits(n: number): number {
    if (n === 0) return 0;
    const v = this.peek(n);
    this.skip(n);
    return v;
  }

  decode(t: DecodeTable): number {
    const look = this.peek(LOOKAHEAD);
    const e = t.lut[look];
    if (e) {
      this.skip(e >> 8);
      return e & 0xff;
    }
    let code = this.bits(1);
    let l = 1;
    while (code > t.maxcode[l]) {
      code = (code << 1) | this.bits(1);
      l++;
      if (l > 16) throw new JpegError('Bad Huffman code');
    }
    return t.values[t.valptr[l] + code - t.mincode[l]];
  }

  /** Discards buffered bits and consumes the expected RSTn marker. */
  restart(n: number): void {
    this.buf = 0;
    this.cnt = 0;
    while (this.pos < this.data.length && this.data[this.pos] !== 0xff) this.pos++;
    while (this.data[this.pos] === 0xff && this.data[this.pos + 1] === 0xff) this.pos++;
    if (this.data[this.pos] !== 0xff || this.data[this.pos + 1] !== 0xd0 + n) {
      throw new JpegError('Missing restart marker');
    }
    this.pos += 2;
  }
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private cur = new Uint8Array(1 << 16);
  private len = 0;

  byte(b: number): void {
    if (this.len === this.cur.length) {
      this.chunks.push(this.cur);
      this.cur = new Uint8Array(this.cur.length * 2);
      this.len = 0;
    }
    this.cur[this.len++] = b;
  }

  bytes(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0) + this.len;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    out.set(this.cur.subarray(0, this.len), off);
    return out;
  }
}

class BitWriter {
  private acc = 0;
  private cnt = 0;
  constructor(private out: ByteWriter) {}

  put(code: number, size: number): void {
    if (size === 0) return;
    this.acc = ((this.acc << size) | (code & ((1 << size) - 1))) >>> 0;
    this.cnt += size;
    while (this.cnt >= 8) {
      const b = (this.acc >>> (this.cnt - 8)) & 0xff;
      this.out.byte(b);
      if (b === 0xff) this.out.byte(0);
      this.cnt -= 8;
      this.acc &= (1 << this.cnt) - 1;
    }
  }

  flush(): void {
    if (this.cnt > 0) this.put((1 << (8 - this.cnt)) - 1, 8 - this.cnt);
  }
}

// ---------------------------------------------------------------------------
// Scan decoding into a compact symbol stream

interface Component {
  id: number;
  h: number;
  v: number;
}

interface Frame {
  width: number;
  height: number;
  components: Component[];
  hmax: number;
  vmax: number;
}

function parseFrame(seg: Uint8Array): Frame {
  const height = (seg[5] << 8) | seg[6];
  const width = (seg[7] << 8) | seg[8];
  const n = seg[9];
  const components: Component[] = [];
  for (let i = 0; i < n; i++) {
    const o = 10 + i * 3;
    components.push({ id: seg[o], h: seg[o + 1] >> 4, v: seg[o + 1] & 15 });
  }
  if (!width || !height || !n) throw new JpegError('Unsupported frame');
  return {
    width,
    height,
    components,
    hmax: Math.max(...components.map((c) => c.h)),
    vmax: Math.max(...components.map((c) => c.v)),
  };
}

/** Growable Uint32Array of packed events: value(16) | extraLen(5) | symbol(8) | table(3). */
class EventList {
  data = new Uint32Array(1 << 16);
  length = 0;
  push(table: number, symbol: number, extraLen: number, value: number): void {
    if (this.length === this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = ((value & 0xffff) << 16) | (extraLen << 11) | (symbol << 3) | table;
  }
}

interface DecodedScan {
  events: EventList;
  /** Event indices where a restart marker precedes the event. */
  restarts: number[];
  /** Table slots used: 0–3 DC, 4–7 AC. */
  slots: Set<number>;
}

function decodeScan(
  scan: Scan,
  frame: Frame,
  tables: (DecodeTable | null)[],
  restartInterval: number,
): DecodedScan {
  const sos = scan.sos;
  const ns = sos[4];
  const comps: { comp: Component; dc: number; ac: number }[] = [];
  for (let i = 0; i < ns; i++) {
    const id = sos[5 + i * 2];
    const td = sos[6 + i * 2];
    const comp = frame.components.find((c) => c.id === id);
    if (!comp) throw new JpegError('Unknown component');
    comps.push({ comp, dc: td >> 4, ac: 4 + (td & 15) });
  }
  const ss = sos[5 + ns * 2];
  const se = sos[6 + ns * 2];
  if (ss !== 0 || se !== 63) throw new JpegError('Not a sequential scan');

  const slots = new Set<number>();
  for (const c of comps) {
    if (!tables[c.dc] || !tables[c.ac]) throw new JpegError('Missing Huffman table');
    slots.add(c.dc);
    slots.add(c.ac);
  }

  let mcusX: number;
  let mcusY: number;
  let blocksPerMcu: { slotDc: number; slotAc: number }[];
  if (ns === 1) {
    const c = comps[0].comp;
    mcusX = Math.ceil(Math.ceil((frame.width * c.h) / frame.hmax) / 8);
    mcusY = Math.ceil(Math.ceil((frame.height * c.v) / frame.vmax) / 8);
    blocksPerMcu = [{ slotDc: comps[0].dc, slotAc: comps[0].ac }];
  } else {
    mcusX = Math.ceil(frame.width / (8 * frame.hmax));
    mcusY = Math.ceil(frame.height / (8 * frame.vmax));
    blocksPerMcu = [];
    for (const c of comps) {
      for (let b = 0; b < c.comp.h * c.comp.v; b++)
        blocksPerMcu.push({ slotDc: c.dc, slotAc: c.ac });
    }
  }

  const reader = new BitReader(scan.data);
  const events = new EventList();
  const restarts: number[] = [];
  const total = mcusX * mcusY;
  let rst = 0;
  for (let m = 0; m < total; m++) {
    if (restartInterval && m > 0 && m % restartInterval === 0) {
      reader.restart(rst);
      rst = (rst + 1) & 7;
      restarts.push(events.length);
    }
    for (const blk of blocksPerMcu) {
      const s = reader.decode(tables[blk.slotDc]!);
      if (s > 16) throw new JpegError('Bad DC symbol');
      events.push(blk.slotDc, s, s, reader.bits(s));
      const ac = tables[blk.slotAc]!;
      for (let k = 1; k < 64;) {
        const rs = reader.decode(ac);
        const size = rs & 15;
        const run = rs >> 4;
        events.push(blk.slotAc, rs, size, reader.bits(size));
        if (size === 0) {
          if (run !== 15) break; // EOB
          k += 16;
        } else {
          k += run + 1;
        }
        if (k > 64) throw new JpegError('Coefficient overflow');
      }
    }
  }
  return { events, restarts, slots };
}

function dhtSegment(
  entries: { slot: number; counts: Uint8Array; values: Uint8Array }[],
): Uint8Array {
  const payload: number[] = [];
  for (const e of entries) {
    const tc = e.slot >= 4 ? 1 : 0;
    payload.push((tc << 4) | (e.slot & 3), ...e.counts, ...e.values);
  }
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xc4, len >> 8, len & 0xff, ...payload]);
}

function encodeScan(decoded: DecodedScan, out: ByteWriter): Uint8Array {
  const freqs = new Map<number, Float64Array>();
  for (const slot of decoded.slots) freqs.set(slot, new Float64Array(256));
  const ev = decoded.events.data;
  for (let i = 0; i < decoded.events.length; i++) {
    const e = ev[i];
    freqs.get(e & 7)![(e >>> 3) & 0xff]++;
  }
  const codes = new Map<number, { code: Uint16Array; size: Uint8Array }>();
  const dhtEntries: { slot: number; counts: Uint8Array; values: Uint8Array }[] = [];
  for (const [slot, f] of [...freqs.entries()].sort((a, b) => a[0] - b[0])) {
    const t = optimalTable(f);
    dhtEntries.push({ slot, ...t });
    codes.set(slot, encodeCodes(t.counts, t.values));
  }
  const bw = new BitWriter(out);
  let nextRestart = 0;
  let rst = 0;
  for (let i = 0; i < decoded.events.length; i++) {
    if (nextRestart < decoded.restarts.length && decoded.restarts[nextRestart] === i) {
      bw.flush();
      out.byte(0xff);
      out.byte(0xd0 + rst);
      rst = (rst + 1) & 7;
      nextRestart++;
    }
    const e = ev[i];
    const slot = e & 7;
    const sym = (e >>> 3) & 0xff;
    const extraLen = (e >>> 11) & 31;
    const c = codes.get(slot)!;
    if (!c.size[sym]) throw new JpegError('Symbol missing from table');
    bw.put(c.code[sym], c.size[sym]);
    bw.put(e >>> 16, extraLen);
  }
  bw.flush();
  return dhtSegment(dhtEntries);
}

// ---------------------------------------------------------------------------

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

function keepSegment(seg: Segment, strip: boolean): boolean {
  const m = seg.marker;
  // APP2 "MPF" points at secondary images after EOI by absolute offset; once
  // the main image changes size those offsets are wrong, so it always goes.
  if (m === 0xe2 && ascii(seg.bytes, 4, 4) === 'MPF\0') return false;
  if (!strip) return true;
  if (m === 0xe0) return true; // JFIF / JFXX
  if (m === 0xe2) return ascii(seg.bytes, 4, 12) === 'ICC_PROFILE\0';
  if (m === 0xee) return true; // Adobe: colour transform flag, needed to decode
  if (m >= 0xe1 && m <= 0xef) return false; // EXIF, XMP, IPTC, …
  if (m === 0xfe) return false; // comments
  return true;
}

function readOrientation(items: Item[]): number {
  for (const it of items) {
    if (it.kind !== 'segment' || it.seg.marker !== 0xe1) continue;
    const b = it.seg.bytes;
    if (ascii(b, 4, 6) === 'Exif\0\0') return exifOrientation(b.subarray(10));
  }
  return 1;
}

function assemble(items: Item[], opts: JpegOptimizeOptions, optimise: boolean): Uint8Array {
  const out = new ByteWriter();
  out.byte(0xff);
  out.byte(0xd8);
  const writeAll = (b: Uint8Array) => {
    for (let i = 0; i < b.length; i++) out.byte(b[i]);
  };
  let frame: Frame | null = null;
  const tables: (DecodeTable | null)[] = new Array(8).fill(null);
  let restartInterval = 0;
  // When stripping, an orientation flag still has to survive or the photo
  // would show up rotated; keep just that one tag.
  const orientation = opts.stripMetadata ? readOrientation(items) : 1;
  let wroteOrientation = orientation === 1;
  const writeOrientation = () => {
    if (wroteOrientation) return;
    wroteOrientation = true;
    const seg = jpegExifSegment(orientationOnlyExif(orientation));
    if (seg) writeAll(seg);
  };

  for (const it of items) {
    if (it.kind === 'segment') {
      const { seg } = it;
      if (seg.marker !== 0xe0) writeOrientation();
      if (seg.marker === 0xc4) {
        // Record the table(s); optimised files get fresh ones per scan.
        let p = 4;
        while (p < seg.bytes.length) {
          const tc = seg.bytes[p] >> 4;
          const th = seg.bytes[p] & 15;
          const counts = seg.bytes.subarray(p + 1, p + 17);
          const n = counts.reduce((a, c) => a + c, 0);
          const values = seg.bytes.subarray(p + 17, p + 17 + n);
          if (th > 3 || tc > 1) throw new JpegError('Bad DHT');
          tables[tc * 4 + th] = buildDecodeTable(counts, values);
          p += 17 + n;
        }
        if (!optimise) writeAll(seg.bytes);
        continue;
      }
      if (seg.marker === 0xdd) restartInterval = (seg.bytes[4] << 8) | seg.bytes[5];
      if (seg.marker === 0xdc) throw new JpegError('DNL not supported');
      if (
        seg.marker >= 0xc0 &&
        seg.marker <= 0xcf &&
        seg.marker !== 0xc4 &&
        seg.marker !== 0xc8 &&
        seg.marker !== 0xcc
      ) {
        frame = parseFrame(seg.bytes);
      }
      if (keepSegment(seg, opts.stripMetadata)) writeAll(seg.bytes);
    } else {
      writeOrientation();
      const { scan } = it;
      if (optimise) {
        if (!frame) throw new JpegError('Scan before frame');
        const decoded = decodeScan(scan, frame, tables, restartInterval);
        const data = new ByteWriter();
        const dht = encodeScan(decoded, data);
        writeAll(dht);
        writeAll(scan.sos);
        writeAll(data.bytes());
      } else {
        writeAll(scan.sos);
        writeAll(scan.data);
      }
    }
  }
  out.byte(0xff);
  out.byte(0xd9);
  return out.bytes();
}

export function optimizeJpeg(input: Uint8Array, opts: JpegOptimizeOptions): JpegOptimizeResult {
  const items = parse(input);
  const sof = items.find(
    (it) =>
      it.kind === 'segment' &&
      it.seg.marker >= 0xc0 &&
      it.seg.marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(it.seg.marker),
  );
  const sofMarker = sof && sof.kind === 'segment' ? sof.seg.marker : -1;
  const canOptimise = sofMarker === 0xc0 || sofMarker === 0xc1;
  if (canOptimise) {
    try {
      return { bytes: assemble(items, opts, true), huffmanOptimized: true };
    } catch (e) {
      if (!(e instanceof JpegError)) throw e;
      // Fall through to a metadata-only rewrite.
    }
  }
  return { bytes: assemble(items, opts, false), huffmanOptimized: false };
}
