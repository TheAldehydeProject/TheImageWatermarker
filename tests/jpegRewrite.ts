/**
 * Test helper: rewrites the entropy-coded data of a single-scan baseline JPEG.
 *
 * - `restartInterval` inserts restart markers every N MCUs (common in camera
 *   files; the encoders available in tests can't produce them).
 * - `standardTables` re-codes the file with the generic Huffman tables from
 *   the JPEG standard (Annex K.3), which is what most cameras write.
 *
 * The output is validated against the MozJPEG decoder in the tests.
 */

interface Table {
  counts: number[];
  values: number[];
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// JPEG standard Annex K.3 tables, as used by libjpeg (jcparam.c).
const STD_DC_LUMA: Table = {
  counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  values: range(12),
};
const STD_DC_CHROMA: Table = {
  counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  values: range(12),
};
const STD_AC_LUMA: Table = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  values: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
};
const STD_AC_CHROMA: Table = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  values: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
};

function codesFor(t: Table): Map<number, { code: number; len: number }> {
  const out = new Map<number, { code: number; len: number }>();
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < t.counts[l - 1]; i++) out.set(t.values[k++], { code: code++, len: l });
    code <<= 1;
  }
  return out;
}

function dht(slot: number, t: Table): number[] {
  const payload = [((slot >> 2) << 4) | (slot & 3), ...t.counts, ...t.values];
  return [0xff, 0xc4, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
}

export interface RewriteOptions {
  restartInterval?: number;
  standardTables?: boolean;
}

export function rewriteJpeg(jpeg: Uint8Array, opts: RewriteOptions): Uint8Array {
  const interval = opts.restartInterval ?? 0;
  const tables = new Map<number, Table>();
  let width = 0;
  let height = 0;
  const comps: { id: number; h: number; v: number }[] = [];
  const header: number[] = [0xff, 0xd8];
  let off = 2;
  let sos: number[] = [];
  let dataStart = -1;
  while (off < jpeg.length) {
    const marker = jpeg[off + 1];
    const len = (jpeg[off + 2] << 8) | jpeg[off + 3];
    const p = off + 4;
    const seg = Array.from(jpeg.subarray(off, off + 2 + len));
    if (marker === 0xc4) {
      let q = p;
      while (q < off + 2 + len) {
        const slot = (jpeg[q] >> 4) * 4 + (jpeg[q] & 15);
        const counts = Array.from(jpeg.subarray(q + 1, q + 17));
        const n = counts.reduce((a, b) => a + b, 0);
        tables.set(slot, { counts, values: Array.from(jpeg.subarray(q + 17, q + 17 + n)) });
        q += 17 + n;
      }
      if (opts.standardTables) {
        off += 2 + len;
        continue;
      }
    }
    if (marker === 0xc0) {
      height = (jpeg[p + 1] << 8) | jpeg[p + 2];
      width = (jpeg[p + 3] << 8) | jpeg[p + 4];
      for (let i = 0; i < jpeg[p + 5]; i++) {
        const c = p + 6 + i * 3;
        comps.push({ id: jpeg[c], h: jpeg[c + 1] >> 4, v: jpeg[c + 1] & 15 });
      }
    }
    if (marker === 0xc2) throw new Error('progressive input not supported by this helper');
    if (marker === 0xda) {
      sos = seg;
      dataStart = off + 2 + len;
      break;
    }
    header.push(...seg);
    off += 2 + len;
  }

  const ns = sos[4];
  const scanComps: {
    comp: (typeof comps)[number];
    dcIn: number;
    acIn: number;
    dcOut: number;
    acOut: number;
  }[] = [];
  for (let i = 0; i < ns; i++) {
    const id = sos[5 + i * 2];
    const td = sos[6 + i * 2];
    const comp = comps.find((c) => c.id === id)!;
    const std = i === 0 ? 0 : 1;
    if (opts.standardTables) sos[6 + i * 2] = (std << 4) | std;
    scanComps.push({
      comp,
      dcIn: td >> 4,
      acIn: 4 + (td & 15),
      dcOut: opts.standardTables ? std : td >> 4,
      acOut: opts.standardTables ? 4 + std : 4 + (td & 15),
    });
  }
  const outTables = opts.standardTables
    ? new Map([
        [0, STD_DC_LUMA],
        [1, STD_DC_CHROMA],
        [4, STD_AC_LUMA],
        [5, STD_AC_CHROMA],
      ])
    : tables;
  if (opts.standardTables) for (const [slot, t] of outTables) header.push(...dht(slot, t));
  if (interval) header.push(0xff, 0xdd, 0, 4, interval >> 8, interval & 0xff);

  const hmax = Math.max(...comps.map((c) => c.h));
  const vmax = Math.max(...comps.map((c) => c.v));

  // Bit reader over the entropy data.
  let pos = dataStart;
  let buf = 0;
  let cnt = 0;
  const readBit = () => {
    if (cnt === 0) {
      buf = jpeg[pos++];
      if (buf === 0xff) pos++; // skip stuffed zero
      cnt = 8;
    }
    cnt--;
    return (buf >> cnt) & 1;
  };
  const readBits = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | readBit();
    return v;
  };
  const decoders = new Map<number, Map<string, number>>();
  for (const [slot, t] of tables) {
    const m = new Map<string, number>();
    for (const [sym, c] of codesFor(t)) m.set(`${c.len}:${c.code}`, sym);
    decoders.set(slot, m);
  }
  const decode = (slot: number) => {
    const m = decoders.get(slot)!;
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | readBit();
      const s = m.get(`${l}:${code}`);
      if (s !== undefined) return s;
    }
    throw new Error('bad code');
  };
  const encoders = new Map([...outTables].map(([slot, t]) => [slot, codesFor(t)]));

  // Bit writer.
  const out: number[] = [];
  let acc = 0;
  let accLen = 0;
  const put = (code: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      accLen++;
      if (accLen === 8) {
        out.push(acc);
        if (acc === 0xff) out.push(0);
        acc = 0;
        accLen = 0;
      }
    }
  };
  const flush = () => {
    while (accLen !== 0) put(1, 1);
  };

  const extend = (v: number, s: number) => (s === 0 ? 0 : v < 1 << (s - 1) ? v - (1 << s) + 1 : v);
  const category = (d: number) => (d === 0 ? 0 : Math.floor(Math.log2(Math.abs(d))) + 1);

  const mcusX = Math.ceil(width / (8 * hmax));
  const mcusY = Math.ceil(height / (8 * vmax));
  const pred = new Map<number, number>();
  const newPred = new Map<number, number>();
  let rst = 0;
  for (let m = 0; m < mcusX * mcusY; m++) {
    if (interval && m > 0 && m % interval === 0) {
      flush();
      out.push(0xff, 0xd0 + rst);
      rst = (rst + 1) & 7;
      newPred.clear();
    }
    for (const sc of scanComps) {
      for (let b = 0; b < sc.comp.h * sc.comp.v; b++) {
        const s = decode(sc.dcIn);
        const abs = (pred.get(sc.comp.id) ?? 0) + extend(readBits(s), s);
        pred.set(sc.comp.id, abs);
        const diff = abs - (newPred.get(sc.comp.id) ?? 0);
        newPred.set(sc.comp.id, abs);
        const cat = category(diff);
        const c = encoders.get(sc.dcOut)!.get(cat)!;
        put(c.code, c.len);
        put(diff >= 0 ? diff : diff + (1 << cat) - 1, cat);
        for (let k = 1; k < 64;) {
          const rs = decode(sc.acIn);
          const size = rs & 15;
          const bits = readBits(size);
          const ac = encoders.get(sc.acOut)!.get(rs)!;
          put(ac.code, ac.len);
          put(bits, size);
          if (size === 0) {
            if (rs >> 4 !== 15) break;
            k += 16;
          } else {
            k += (rs >> 4) + 1;
          }
        }
      }
    }
  }
  flush();
  return new Uint8Array([...header, ...sos, ...out, 0xff, 0xd9]);
}
