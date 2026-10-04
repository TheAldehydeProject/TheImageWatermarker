import { createImage, type RGBAImage } from './image';

/**
 * Reduces an image to at most `maxColors` colours (median cut + Floyd–Steinberg
 * dithering). Used for PNG "visually lossless" mode, where the PNG optimiser
 * then stores the result as a compact palette image. If the image already has
 * few enough colours it is returned unchanged (that case is lossless).
 */
export function quantize(img: RGBAImage, maxColors = 256): RGBAImage {
  const n = img.width * img.height;
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, n);

  // Exact palette if the image already fits.
  const exact = new Set<number>();
  for (let i = 0; i < n && exact.size <= maxColors; i++) exact.add(px[i]);
  if (exact.size <= maxColors) return img;

  // Histogram at 5 bits per colour channel and 4 bits of alpha.
  const BINS = 1 << 19;
  const count = new Uint32Array(BINS);
  const sum = new Float64Array(BINS * 4);
  const d = img.data;
  const binOf = (r: number, g: number, b: number, a: number) =>
    ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const bin = binOf(d[o], d[o + 1], d[o + 2], d[o + 3]);
    count[bin]++;
    sum[bin * 4] += d[o];
    sum[bin * 4 + 1] += d[o + 1];
    sum[bin * 4 + 2] += d[o + 2];
    sum[bin * 4 + 3] += d[o + 3];
  }
  interface Entry {
    c: [number, number, number, number];
    w: number;
  }
  const entries: Entry[] = [];
  for (let bin = 0; bin < BINS; bin++) {
    const w = count[bin];
    if (!w) continue;
    entries.push({
      c: [sum[bin * 4] / w, sum[bin * 4 + 1] / w, sum[bin * 4 + 2] / w, sum[bin * 4 + 3] / w],
      w,
    });
  }

  // Median cut.
  type Box = { items: Entry[]; score: number; channel: number };
  const makeBox = (items: Entry[]): Box => {
    let best = 0;
    let channel = 0;
    let weight = 0;
    for (let c = 0; c < 4; c++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const e of items) {
        if (e.c[c] < lo) lo = e.c[c];
        if (e.c[c] > hi) hi = e.c[c];
      }
      if (hi - lo > best) {
        best = hi - lo;
        channel = c;
      }
    }
    for (const e of items) weight += e.w;
    return { items, score: items.length > 1 ? best * Math.sqrt(weight) : 0, channel };
  };
  const boxes: Box[] = [makeBox(entries)];
  while (boxes.length < maxColors) {
    let idx = -1;
    let bestScore = 0;
    boxes.forEach((b, i) => {
      if (b.score > bestScore) {
        bestScore = b.score;
        idx = i;
      }
    });
    if (idx < 0) break;
    const box = boxes[idx];
    const ch = box.channel;
    box.items.sort((a, b) => a.c[ch] - b.c[ch]);
    const total = box.items.reduce((s, e) => s + e.w, 0);
    let acc = 0;
    let split = 1;
    for (let i = 0; i < box.items.length - 1; i++) {
      acc += box.items[i].w;
      if (acc >= total / 2) {
        split = i + 1;
        break;
      }
    }
    boxes.splice(idx, 1, makeBox(box.items.slice(0, split)), makeBox(box.items.slice(split)));
  }
  const palette = boxes.map((b) => {
    const t = b.items.reduce((s, e) => s + e.w, 0);
    const c = [0, 0, 0, 0];
    for (const e of b.items) for (let k = 0; k < 4; k++) c[k] += e.c[k] * e.w;
    return c.map((v) => Math.round(v / t));
  });
  // Fully transparent pixels should stay fully transparent.
  for (const p of palette) if (p[3] < 8) p[0] = p[1] = p[2] = p[3] = 0;

  const cache = new Int16Array(BINS).fill(-1);
  const nearest = (r: number, g: number, b: number, a: number) => {
    const bin = binOf(r, g, b, a);
    const hit = cache[bin];
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = p[0] - r;
      const dg = p[1] - g;
      const db = p[2] - b;
      const da = p[3] - a;
      const dist = 2 * dr * dr + 4 * dg * dg + db * db + 3 * da * da;
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    cache[bin] = best;
    return best;
  };

  // Floyd–Steinberg dithering, serpentine order.
  const w = img.width;
  const h = img.height;
  const out = createImage(w, h);
  let errCur = new Float32Array((w + 2) * 4);
  let errNext = new Float32Array((w + 2) * 4);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let step = 0; step < w; step++) {
      const x = ltr ? step : w - 1 - step;
      const o = (y * w + x) * 4;
      const e = (x + 1) * 4;
      const r = clamp(d[o] + errCur[e]);
      const g = clamp(d[o + 1] + errCur[e + 1]);
      const b = clamp(d[o + 2] + errCur[e + 2]);
      const a = d[o + 3] === 0 || d[o + 3] === 255 ? d[o + 3] : clamp(d[o + 3] + errCur[e + 3]);
      const p = palette[nearest(r, g, b, a)];
      out.data[o] = p[0];
      out.data[o + 1] = p[1];
      out.data[o + 2] = p[2];
      out.data[o + 3] = p[3];
      const errs = [r - p[0], g - p[1], b - p[2], a - p[3]];
      const fwd = ltr ? 4 : -4;
      for (let k = 0; k < 4; k++) {
        const er = errs[k];
        errCur[e + fwd + k] += (er * 7) / 16;
        errNext[e - fwd + k] += (er * 3) / 16;
        errNext[e + k] += (er * 5) / 16;
        errNext[e + fwd + k] += er / 16;
      }
    }
    [errCur, errNext] = [errNext, errCur];
    errNext.fill(0);
  }
  return out;
}
