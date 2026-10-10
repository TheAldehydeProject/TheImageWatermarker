/**
 * Processing building blocks shared by every tool: reading files with
 * friendly errors, resizing, saving with metadata and fitting a file-size
 * target. Each tool's pipeline (src/tools/<tool>/pipeline.ts) combines them in
 * its own way.
 */
import { decodeImage, encodeImage, type Decoded } from './codecs';
import { fitToSize } from './fitSize';
import {
  detectFormat,
  INPUT_FORMAT_LABELS,
  OUTPUT_FORMATS,
  type Effort,
  type InputFormat,
  type OutputFormat,
} from './formats';
import { hasTransparency, type RGBAImage } from './image';
import {
  exifForReencode,
  injectJpegMetadata,
  injectPngMetadata,
  injectWebpMetadata,
} from './metadata';
import { fitWithin, resizeImage } from './resize';

export interface ProcessResult {
  bytes: Uint8Array;
  format: OutputFormat;
  extension: string;
  mime: string;
  width: number;
  height: number;
  /** Whether the saved pixels are an exact copy of the processed image. */
  lossless: boolean;
  /** True when the original file was handed back unchanged. */
  keptOriginal: boolean;
  notes: string[];
}

/** The steps a file goes through, reported as they start. */
export type ProcessStep = 'reading' | 'resizing' | 'watermarking' | 'compressing' | 'fitting';

/** Hears each step as it starts. `attempt` counts the tries while fitting a target size. */
export type Progress = (step: ProcessStep, attempt?: number) => void;

/** An error whose message is meant for the person using the site. */
export class UserFacingError extends Error {}

export function result(
  bytes: Uint8Array,
  format: OutputFormat,
  size: { width: number; height: number },
  lossless: boolean,
  notes: string[],
  keptOriginal = false,
): ProcessResult {
  const info = OUTPUT_FORMATS[format];
  return {
    bytes,
    format,
    extension: info.extension,
    mime: info.mime,
    width: size.width,
    height: size.height,
    lossless,
    keptOriginal,
    notes,
  };
}

/** The file's format, or a friendly error if it isn't a supported image. */
export function detectOrFail(bytes: Uint8Array, name: string): InputFormat {
  const format = detectFormat(bytes, name);
  if (!format) throw new UserFacingError('This file type is not supported.');
  return format;
}

/** Decodes the file the first time it is needed, reporting the 'reading' step. */
export function lazyDecoder(
  bytes: Uint8Array,
  input: InputFormat,
  progress?: Progress,
): () => Promise<Decoded> {
  let decoded: Promise<Decoded> | null = null;
  return () => {
    decoded ??= (async () => {
      progress?.('reading');
      try {
        return await decodeImage(bytes, input);
      } catch (err) {
        throw new UserFacingError(
          `Could not read this ${INPUT_FORMAT_LABELS[input]} file (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    })();
    return decoded;
  };
}

/** Shrinks an image to fit within the limits (never enlarges), noting it if it changed. */
export function resizeToFit(
  img: RGBAImage,
  limits: { maxWidth: number; maxHeight: number } | null,
  notes: string[],
  progress?: Progress,
): RGBAImage {
  if (!limits) return img;
  const fit = fitWithin(img.width, img.height, limits.maxWidth, limits.maxHeight);
  if (fit.width >= img.width && fit.height >= img.height) return img;
  progress?.('resizing');
  notes.push(`Resized to ${fit.width} × ${fit.height}.`);
  return resizeImage(img, fit.width, fit.height);
}

/** Note for files whose own format can't be written (RAW, HEIC, GIF, BMP). */
export const SOURCE_ONLY_NOTE = (input: InputFormat, target: OutputFormat) =>
  `${INPUT_FORMAT_LABELS[input]} files can't be saved as ${INPUT_FORMAT_LABELS[input]}, so this was saved as ${OUTPUT_FORMATS[target].label}.`;

/** Saves an image in a format, with the original's metadata where the format allows. */
export type Saver = (
  img: RGBAImage,
  lossless: boolean,
  quality: number,
  effort?: Effort,
) => Promise<Uint8Array>;

/**
 * Prepares saving in `format`: which metadata to carry over, and notes about
 * anything that can't be kept. Sizes from the returned saver are final.
 */
export function prepareSave(
  decoded: Decoded,
  img: RGBAImage,
  format: OutputFormat,
  o: { keepExif: boolean; effort: Effort; jpegChroma?: 1 | 2 },
): { save: Saver; notes: string[] } {
  const info = OUTPUT_FORMATS[format];
  const notes: string[] = [];
  const icc = decoded.meta.icc && info.icc ? decoded.meta.icc : undefined;
  const exif =
    o.keepExif && decoded.meta.exif && info.exif ? exifForReencode(decoded.meta.exif) : undefined;
  if (o.keepExif && decoded.meta.exif && !info.exif) {
    notes.push(`${info.label} files can't carry camera metadata here, so it was left out.`);
  }
  if (decoded.meta.icc && !info.icc) {
    notes.push(
      `The colour profile can't be stored in ${info.label} here; colours may look slightly different.`,
    );
  }
  const transparent = hasTransparency(img);
  if (format === 'jpeg' && transparent) {
    notes.push('JPG has no transparency, so transparent areas were filled with white.');
  }
  const save: Saver = async (image, lossless, quality, effort = o.effort) => {
    let bytes = await encodeImage(image, format, {
      lossless,
      quality,
      effort,
      icc,
      jpegChroma: o.jpegChroma,
    });
    if (format === 'jpeg') bytes = injectJpegMetadata(bytes, { exif, icc });
    if (format === 'png') bytes = injectPngMetadata(bytes, { exif, icc });
    if (format === 'webp') bytes = injectWebpMetadata(bytes, { exif, icc }, transparent);
    return bytes;
  };
  return { save, notes };
}

// ---------------------------------------------------------------------------
// Fitting a file-size target

/**
 * Typical bits per pixel at each quality, measured on real photos. Only used
 * to choose where the search for a target size starts.
 */
const TYPICAL_BPP: Partial<Record<OutputFormat, [number, number][]>> = {
  jpeg: [
    [40, 0.48],
    [50, 0.57],
    [60, 0.66],
    [70, 0.79],
    [80, 1.03],
    [85, 1.21],
    [90, 2.12],
    [95, 3],
    [100, 5],
  ],
  webp: [
    [20, 0.31],
    [30, 0.38],
    [40, 0.45],
    [50, 0.52],
    [60, 0.59],
    [70, 0.66],
    [80, 0.86],
    [90, 1.41],
    [95, 2.09],
    [100, 3],
  ],
  avif: [
    [40, 0.18],
    [50, 0.26],
    [60, 0.38],
    [70, 0.55],
    [80, 0.74],
    [85, 0.82],
    [90, 1.1],
    [95, 1.28],
    [100, 1.6],
  ],
  jxl: [
    [40, 0.39],
    [50, 0.44],
    [60, 0.52],
    [70, 0.63],
    [80, 0.81],
    [85, 0.97],
    [90, 1.23],
    [95, 1.74],
    [100, 3],
  ],
};

/** Typical file size in bytes at a quality, interpolated on a log scale. */
export function typicalSize(format: OutputFormat, pixels: number, quality: number): number | null {
  const table = TYPICAL_BPP[format];
  if (!table) return null;
  let i = 1;
  while (i < table.length - 1 && table[i][0] < quality) i++;
  const [[q0, b0], [q1, b1]] = [table[i - 1], table[i]];
  const t = (quality - q0) / (q1 - q0);
  const bpp = Math.exp(Math.log(b0) + t * (Math.log(b1) - Math.log(b0)));
  return (bpp * pixels) / 8;
}

/** The image is never made smaller than this on its longer side to reach a target. */
const TARGET_MIN_SIDE = 64;

export interface TargetOptions {
  /** Qualities to search. For PNG, 1 = lossless and 0 = 256 colours. */
  minQuality: number;
  maxQuality: number;
  /** Whether the image may be made smaller when even the lowest quality is too big. */
  allowShrink: boolean;
  /** Stop once a result is at least this share of the target (default 0.95). */
  closeEnough?: number;
}

export interface Fitted {
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number;
  /** 1 when the image kept its size. */
  scale: number;
  lossless: boolean;
  /** False when even the smallest version tried is over the target. */
  fits: boolean;
}

/** Saves at the highest quality that fits the target, shrinking the image only if allowed and needed. */
export async function encodeToTarget(
  img: RGBAImage,
  format: OutputFormat,
  targetBytes: number,
  save: Saver,
  o: TargetOptions,
  progress?: Progress,
): Promise<Fitted> {
  const losslessAt = (q: number) => (format === 'png' ? q >= 1 : format === 'tiff');
  let scaled = img;
  const atScale = (scale: number) => {
    if (scale >= 1) return img;
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    if (scaled.width !== width || scaled.height !== height) {
      scaled = resizeImage(img, width, height);
    }
    return scaled;
  };
  const pixels = img.width * img.height;
  const typical =
    typicalSize(format, pixels, 50) === null
      ? undefined
      : (q: number) => typicalSize(format, pixels, q)!;
  const r = await fitToSize(
    targetBytes,
    async (quality, scale) => {
      const image = atScale(scale);
      const bytes = await save(image, losslessAt(quality), quality);
      return { size: bytes.length, value: { bytes, width: image.width, height: image.height } };
    },
    {
      minQuality: o.minQuality,
      maxQuality: o.maxQuality,
      minScale: o.allowShrink ? Math.min(1, TARGET_MIN_SIDE / Math.max(img.width, img.height)) : 1,
      closeEnough: o.closeEnough,
      onAttempt: (n) => progress?.('fitting', n),
      typicalSize: typical,
    },
  );
  const { quality, scale, value } = r.best;
  return {
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    quality,
    scale,
    lossless: losslessAt(quality),
    fits: r.fits,
  };
}

/** Decodes a file into a (possibly downscaled) preview image. */
export async function decodePreview(
  bytes: Uint8Array,
  name: string,
  maxSize: number,
): Promise<{ image: RGBAImage; width: number; height: number; format: InputFormat }> {
  const format = detectOrFail(bytes, name);
  const decoded = await lazyDecoder(bytes, format)();
  const { width, height } = decoded.image;
  const fit = maxSize > 0 ? fitWithin(width, height, maxSize, maxSize) : { width, height };
  const image = resizeImage(decoded.image, fit.width, fit.height);
  return { image, width, height, format };
}
