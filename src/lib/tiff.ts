import { zlibSync } from 'fflate';
import { hasTransparency, type RGBAImage } from './image';

/**
 * Writes a lossless TIFF: 8-bit RGB(A), Deflate compression with the
 * horizontal-differencing predictor (the best lossless option widely
 * supported by TIFF readers).
 */
export function encodeTiff(img: RGBAImage, icc?: Uint8Array): Uint8Array {
  const { width, height } = img;
  const alpha = hasTransparency(img);
  const spp = alpha ? 4 : 3;
  const rowBytes = width * spp;
  const rowsPerStrip = Math.max(1, Math.floor((256 * 1024) / rowBytes));
  const stripCount = Math.ceil(height / rowsPerStrip);

  const strips: Uint8Array[] = [];
  for (let s = 0; s < stripCount; s++) {
    const y0 = s * rowsPerStrip;
    const rows = Math.min(rowsPerStrip, height - y0);
    const raw = new Uint8Array(rows * rowBytes);
    for (let y = 0; y < rows; y++) {
      const src = (y0 + y) * width * 4;
      const dst = y * rowBytes;
      // Predictor 2: store each sample as the difference from the one to its left.
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < spp; c++) {
          const cur = img.data[src + x * 4 + c];
          const left = x === 0 ? 0 : img.data[src + (x - 1) * 4 + c];
          raw[dst + x * spp + c] = (cur - left) & 0xff;
        }
      }
    }
    strips.push(zlibSync(raw, { level: 9 }));
  }

  type Entry = { tag: number; type: number; values: number[] | Uint8Array };
  const SHORT = 3;
  const LONG = 4;
  const RATIONAL = 5;
  const UNDEFINED = 7;
  const ASCII = 2;
  const software = new TextEncoder().encode('The Image Watermarker\0');
  const entries: Entry[] = [
    { tag: 256, type: LONG, values: [width] },
    { tag: 257, type: LONG, values: [height] },
    { tag: 258, type: SHORT, values: new Array(spp).fill(8) },
    { tag: 259, type: SHORT, values: [8] }, // Deflate
    { tag: 262, type: SHORT, values: [2] }, // RGB
    { tag: 273, type: LONG, values: new Array(stripCount).fill(0) }, // patched below
    { tag: 274, type: SHORT, values: [1] },
    { tag: 277, type: SHORT, values: [spp] },
    { tag: 278, type: LONG, values: [rowsPerStrip] },
    { tag: 279, type: LONG, values: strips.map((s) => s.length) },
    { tag: 282, type: RATIONAL, values: [72, 1] },
    { tag: 283, type: RATIONAL, values: [72, 1] },
    { tag: 284, type: SHORT, values: [1] },
    { tag: 296, type: SHORT, values: [2] },
    { tag: 305, type: ASCII, values: software },
    { tag: 317, type: SHORT, values: [2] }, // horizontal predictor
  ];
  if (alpha) entries.push({ tag: 338, type: SHORT, values: [2] }); // unassociated alpha
  if (icc) entries.push({ tag: 34675, type: UNDEFINED, values: icc });
  entries.sort((a, b) => a.tag - b.tag);

  const typeSize = (t: number) => (t === SHORT ? 2 : t === LONG ? 4 : t === RATIONAL ? 8 : 1);
  const count = (e: Entry) => (e.type === RATIONAL ? e.values.length / 2 : e.values.length);
  const byteLen = (e: Entry) => count(e) * typeSize(e.type);

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraOffset = ifdOffset + ifdSize;
  const extraOffsets = new Map<Entry, number>();
  for (const e of entries) {
    if (byteLen(e) > 4) {
      extraOffsets.set(e, extraOffset);
      extraOffset += byteLen(e) + (byteLen(e) & 1);
    }
  }
  let dataOffset = extraOffset;
  const stripOffsets: number[] = [];
  for (const s of strips) {
    stripOffsets.push(dataOffset);
    dataOffset += s.length;
  }
  entries.find((e) => e.tag === 273)!.values = stripOffsets;

  const out = new Uint8Array(dataOffset);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, entries.length, true);

  const writeValues = (e: Entry, at: number) => {
    const vals = e.values;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (e.type === SHORT) dv.setUint16(at + i * 2, v, true);
      else if (e.type === LONG || e.type === RATIONAL) dv.setUint32(at + i * 4, v, true);
      else out[at + i] = v;
    }
  };

  entries.forEach((e, i) => {
    const p = ifdOffset + 2 + i * 12;
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, count(e), true);
    const extra = extraOffsets.get(e);
    if (extra === undefined) {
      writeValues(e, p + 8);
    } else {
      dv.setUint32(p + 8, extra, true);
      writeValues(e, extra);
    }
  });
  dv.setUint32(ifdOffset + 2 + entries.length * 12, 0, true);
  strips.forEach((s, i) => out.set(s, stripOffsets[i]));
  return out;
}
