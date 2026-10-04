import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createImage, type RGBAImage } from '../src/lib/image';

/** Minimal ImageData for Node, which the WebAssembly codecs construct. */
class NodeImageData {
  readonly colorSpace = 'srgb';
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
if (!('ImageData' in globalThis)) {
  (globalThis as Record<string, unknown>).ImageData = NodeImageData;
}

const nodeModules = fileURLToPath(new URL('../node_modules/', import.meta.url));
const wasm = async (path: string) => WebAssembly.compile(await readFile(nodeModules + path));

let ready: Promise<void> | null = null;

/** Loads every WebAssembly codec from disk (in the browser they are fetched). */
export function initCodecs(): Promise<void> {
  ready ??= (async () => {
    const [jpegDec, jpegEnc, pngDec, webpDec, webpEnc, avifDec, avifEnc, jxlDec, jxlEnc, oxipng] =
      await Promise.all([
        import('@jsquash/jpeg/decode.js'),
        import('@jsquash/jpeg/encode.js'),
        import('@jsquash/png/decode.js'),
        import('@jsquash/webp/decode.js'),
        import('@jsquash/webp/encode.js'),
        import('@jsquash/avif/decode.js'),
        import('@jsquash/avif/encode.js'),
        import('@jsquash/jxl/decode.js'),
        import('@jsquash/jxl/encode.js'),
        import('@jsquash/oxipng/optimise.js'),
      ]);
    await Promise.all([
      jpegDec.init(await wasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')),
      jpegEnc.init(await wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
      pngDec.init(await wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm')),
      webpDec.init(await wasm('@jsquash/webp/codec/dec/webp_dec.wasm')),
      webpEnc.init(await wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm')),
      avifDec.init(await wasm('@jsquash/avif/codec/dec/avif_dec.wasm')),
      avifEnc.init(await wasm('@jsquash/avif/codec/enc/avif_enc.wasm')),
      jxlDec.init(await wasm('@jsquash/jxl/codec/dec/jxl_dec.wasm')),
      jxlEnc.init(await wasm('@jsquash/jxl/codec/enc/jxl_enc.wasm')),
      oxipng.init(await wasm('@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm')),
    ]);
  })();
  return ready;
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A photo-like test image: smooth gradients, a few shapes and a little noise,
 * so codecs behave as they would on real pictures.
 */
export function photoLike(width: number, height: number, seed = 1, alpha = false): RGBAImage {
  const img = createImage(width, height);
  const rand = rng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const fx = x / width;
      const fy = y / height;
      const inCircle = (fx - 0.35) ** 2 + (fy - 0.45) ** 2 < 0.04;
      const noise = (rand() - 0.5) * 12;
      img.data[i] = (inCircle ? 220 : 40 + 160 * fx) + noise;
      img.data[i + 1] = (inCircle ? 80 : 60 + 120 * fy) + noise;
      img.data[i + 2] = (fx > 0.7 && fy < 0.3 ? 30 : 120 + 80 * Math.sin(fx * 9)) + noise;
      img.data[i + 3] = alpha ? Math.round(255 * Math.min(1, fx * 1.5)) : 255;
    }
  }
  return img;
}

export function solid(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): RGBAImage {
  const img = createImage(width, height);
  for (let i = 0; i < width * height; i++) img.data.set(rgba, i * 4);
  return img;
}

export const asImageData = (img: RGBAImage) => img as unknown as ImageData;

export function maxChannelDiff(a: RGBAImage, b: RGBAImage): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let max = 0;
  for (let i = 0; i < a.data.length; i++) max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
  return max;
}

export function uniqueColors(img: RGBAImage): number {
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, img.width * img.height);
  return new Set(px).size;
}

let jpegEncoderWasm: Promise<WebAssembly.Module> | null = null;

/**
 * Encodes with a fresh MozJPEG instance every time: the encoder leaks state
 * between calls when `optimize_coding` is off for non-progressive output
 * (see tests/codecs.test.ts), and tests use exactly that to mimic cameras.
 */
export async function encodeJpeg(
  img: RGBAImage,
  options: Record<string, unknown> = {},
): Promise<Uint8Array> {
  await initCodecs();
  jpegEncoderWasm ??= wasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm');
  const { default: encode, init } = await import('@jsquash/jpeg/encode.js');
  await init(await jpegEncoderWasm);
  return new Uint8Array(await encode(asImageData(img), options));
}

export async function decodeJpeg(bytes: Uint8Array): Promise<RGBAImage> {
  await initCodecs();
  const { default: decode } = await import('@jsquash/jpeg/decode.js');
  const d = await decode(bytes.slice().buffer);
  return { width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) };
}

export function hasMarker(jpeg: Uint8Array, marker: number): boolean {
  let off = 2;
  while (off + 4 <= jpeg.length && jpeg[off] === 0xff) {
    const m = jpeg[off + 1];
    if (m === marker) return true;
    if (m === 0xda) return false;
    off += 2 + ((jpeg[off + 2] << 8) | jpeg[off + 3]);
  }
  return false;
}
