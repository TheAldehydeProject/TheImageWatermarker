/**
 * Decoders and encoders. Every codec is loaded on first use, so opening the
 * site only downloads what the chosen files need.
 */
import type { InputFormat, OutputFormat } from './formats';
import { isLosslessWebP } from './formats';
import { applyOrientation, createImage, toRGBA, type RGBAImage } from './image';
import { extractMetadata, type ImageMetadata } from './metadata';
import { encodeTiff } from './tiff';
import { quantize } from './quantize';
import type { Effort } from './settings';

export interface Decoded {
  /** Upright pixels. */
  image: RGBAImage;
  meta: ImageMetadata;
  /** Whether the original stored its pixels losslessly. */
  sourceLossless: boolean;
}

const asBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 &&
  bytes.byteLength === bytes.buffer.byteLength &&
  bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer);

const fromImageData = (d: {
  width: number;
  height: number;
  data: ArrayLike<number>;
}): RGBAImage => ({
  width: d.width,
  height: d.height,
  data: d.data instanceof Uint8ClampedArray ? d.data : new Uint8ClampedArray(d.data),
});

/** Decodes with the browser's own decoder (used for GIF/BMP and as a fallback). */
async function decodeNative(bytes: Uint8Array, applyExifOrientation: boolean): Promise<RGBAImage> {
  const blob = new Blob([asBuffer(bytes)]);
  // Only pass imageOrientation when it matters: older Safari versions reject
  // some of its values, and GIF/BMP files have no orientation flag anyway.
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default',
    ...(applyExifOrientation ? { imageOrientation: 'from-image' as const } : {}),
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return fromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

/** First numeric value of a TIFF tag (tags are stored as arrays). */
function tagNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'length' in v) {
    const first = (v as ArrayLike<unknown>)[0];
    return typeof first === 'number' ? first : undefined;
  }
  return undefined;
}

async function decodeTiff(
  bytes: Uint8Array,
): Promise<{ image: RGBAImage; orientation: number; icc?: Uint8Array }> {
  const mod = await import('utif2');
  // CommonJS module: depending on the bundler the API may sit under `default`.
  const UTIF = 'decode' in mod ? mod : (mod as unknown as { default: typeof mod }).default;
  const buf = asBuffer(bytes);
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('No image in TIFF file');
  // Pick the largest image (some TIFFs start with a thumbnail).
  const area = (ifd: (typeof ifds)[number]) =>
    (tagNumber(ifd.t256) ?? 0) * (tagNumber(ifd.t257) ?? 0);
  const ifd = ifds.reduce((a, b) => (area(b) > area(a) ? b : a));
  UTIF.decodeImage(buf, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const { width, height } = ifd;
  const iccTag = ifd.t34675 as ArrayLike<number> | undefined;
  return {
    image: {
      width,
      height,
      data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4),
    },
    orientation: tagNumber(ifd.t274) ?? 1,
    icc: iccTag && iccTag.length ? Uint8Array.from(iccTag) : undefined,
  };
}

async function decodeRaw(bytes: Uint8Array): Promise<RGBAImage> {
  const LibRaw = (await import('libraw-wasm')).default;
  const raw = new LibRaw();
  try {
    await raw.open(bytes.slice(), {
      useCameraWb: true,
      outputColor: 1, // sRGB
      outputBps: 8,
      userQual: 3, // AHD demosaicing
    });
    const data = await raw.imageData();
    if (!data) throw new Error('This RAW file could not be decoded');
    return toRGBA(
      data.data,
      data.width,
      data.height,
      data.colors === 1 ? 1 : data.colors === 4 ? 4 : 3,
    );
  } finally {
    raw.dispose();
  }
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    cb: (r: unknown) => void,
  ): void;
  free?: () => void;
}
interface HeifLib {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[]; free?: () => void };
}

let heifLib: Promise<HeifLib> | null = null;
async function decodeHeic(bytes: Uint8Array): Promise<RGBAImage> {
  heifLib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) =>
    (m.default as () => Promise<HeifLib> | HeifLib)(),
  );
  const lib = await heifLib;
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(bytes);
  if (!images.length) throw new Error('No image in HEIC file');
  const first = images[0];
  const img = createImage(first.get_width(), first.get_height());
  await new Promise<void>((resolve, reject) =>
    first.display(img, (r) => (r ? resolve() : reject(new Error('HEIC decoding failed')))),
  );
  for (const i of images) i.free?.();
  decoder.free?.();
  return img;
}

export async function decodeImage(bytes: Uint8Array, format: InputFormat): Promise<Decoded> {
  const meta = extractMetadata(bytes, format);
  const done = (image: RGBAImage, sourceLossless: boolean, orientation = 1): Decoded => ({
    image: applyOrientation(image, orientation),
    meta,
    sourceLossless,
  });
  try {
    switch (format) {
      case 'jpeg': {
        const { default: decode } = await import('@jsquash/jpeg/decode.js');
        return done(fromImageData(await decode(asBuffer(bytes))), false, meta.orientation);
      }
      case 'png': {
        const { default: decode } = await import('@jsquash/png/decode.js');
        return done(fromImageData(await decode(asBuffer(bytes))), true);
      }
      case 'webp': {
        const { default: decode } = await import('@jsquash/webp/decode.js');
        return done(fromImageData(await decode(asBuffer(bytes))), isLosslessWebP(bytes));
      }
      case 'avif': {
        const { default: decode } = await import('@jsquash/avif/decode.js');
        const d = await decode(asBuffer(bytes));
        if (!d) throw new Error('AVIF decoding failed');
        return done(fromImageData(d), false);
      }
      case 'jxl': {
        const { default: decode } = await import('@jsquash/jxl/decode.js');
        return done(fromImageData(await decode(asBuffer(bytes))), false);
      }
      case 'tiff': {
        const t = await decodeTiff(bytes);
        if (t.icc) meta.icc = t.icc;
        return done(t.image, true, t.orientation);
      }
      case 'raw':
        return done(await decodeRaw(bytes), false);
      case 'heic':
        return done(await decodeHeic(bytes), false);
      case 'gif':
      case 'bmp':
        return done(await decodeNative(bytes, false), true);
    }
  } catch (err) {
    // Fall back to the browser's own decoder (handles e.g. CMYK JPEGs,
    // animated WebP, and HEIC on Safari). It applies EXIF rotation itself.
    if (typeof createImageBitmap !== 'function') throw err;
    try {
      const image = await decodeNative(bytes, true);
      return { image, meta: { ...meta, orientation: 1 }, sourceLossless: format === 'png' };
    } catch {
      throw err;
    }
  }
}

/** Puts semi-transparent pixels over white (for formats without transparency). */
export function flattenOnWhite(img: RGBAImage): RGBAImage {
  const out = createImage(img.width, img.height);
  const s = img.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3] / 255;
    d[i] = s[i] * a + 255 * (1 - a);
    d[i + 1] = s[i + 1] * a + 255 * (1 - a);
    d[i + 2] = s[i + 2] * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
  return out;
}

export interface EncodeOptions {
  lossless: boolean;
  /** 1–100 */
  quality: number;
  effort: Effort;
  icc?: Uint8Array;
}

const toImageData = (img: RGBAImage) =>
  ({ width: img.width, height: img.height, data: img.data, colorSpace: 'srgb' }) as ImageData;

/** PNG optimiser level for each effort setting. */
export const OXIPNG_LEVEL: Record<Effort, number> = { balanced: 2, maximum: 4 };

export async function optimisePng(png: Uint8Array, effort: Effort): Promise<Uint8Array> {
  const { default: optimise } = await import('@jsquash/oxipng/optimise.js');
  const out = await optimise(asBuffer(png), {
    level: OXIPNG_LEVEL[effort],
    interlace: false,
    optimiseAlpha: false,
  });
  return new Uint8Array(out);
}

export async function encodeImage(
  img: RGBAImage,
  format: OutputFormat,
  o: EncodeOptions,
): Promise<Uint8Array> {
  const max = o.effort === 'maximum';
  switch (format) {
    case 'jpeg': {
      const { default: encode } = await import('@jsquash/jpeg/encode.js');
      const out = await encode(toImageData(flattenOnWhite(img)), {
        quality: o.quality,
        progressive: true,
        optimize_coding: true,
        // Full-resolution colour at high quality keeps edges and text crisp.
        auto_subsample: false,
        chroma_subsample: o.quality >= 90 ? 1 : 2,
        trellis_multipass: max,
      });
      return new Uint8Array(out);
    }
    case 'png': {
      const { default: encode } = await import('@jsquash/png/encode.js');
      const source = o.lossless ? img : quantize(img);
      return optimisePng(new Uint8Array(await encode(toImageData(source))), o.effort);
    }
    case 'webp': {
      const { default: encode } = await import('@jsquash/webp/encode.js');
      const out = o.lossless
        ? await encode(toImageData(img), {
            lossless: 1,
            exact: 1,
            quality: max ? 100 : 75,
            method: max ? 6 : 4,
          })
        : await encode(toImageData(img), {
            quality: o.quality,
            method: max ? 6 : 4,
            use_sharp_yuv: 1,
            alpha_quality: 100,
          });
      return new Uint8Array(out);
    }
    case 'avif': {
      const { default: encode } = await import('@jsquash/avif/encode.js');
      const out = o.lossless
        ? await encode(toImageData(img), { lossless: true, speed: max ? 3 : 6 })
        : await encode(toImageData(img), {
            // AVIF's scale runs lower than JPEG's for the same look.
            quality: Math.max(1, Math.min(100, o.quality - 15)),
            speed: max ? 3 : 6,
            subsample: o.quality >= 90 ? 3 : 1,
          });
      return new Uint8Array(out);
    }
    case 'jxl': {
      const { default: encode } = await import('@jsquash/jxl/encode.js');
      const out = o.lossless
        ? await encode(toImageData(img), { lossless: true, effort: max ? 9 : 7 })
        : await encode(toImageData(img), { quality: o.quality, effort: max ? 9 : 7 });
      return new Uint8Array(out);
    }
    case 'tiff':
      return encodeTiff(img, o.icc);
  }
}
