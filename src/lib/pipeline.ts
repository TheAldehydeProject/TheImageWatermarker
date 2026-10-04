import { decodeImage, encodeImage, optimisePng } from './codecs';
import {
  detectFormat,
  INPUT_FORMAT_LABELS,
  isLosslessWebP,
  OUTPUT_FORMATS,
  writableAs,
  type InputFormat,
  type OutputFormat,
} from './formats';
import { hasTransparency, type RGBAImage } from './image';
import { formatBytes } from './filename';
import { fitToSize } from './fitSize';
import { optimizeJpeg } from './jpegOptimize';
import {
  exifForReencode,
  extractPngMetadata,
  injectJpegMetadata,
  injectPngMetadata,
  injectWebpMetadata,
  stripPngMetadata,
  stripWebpMetadata,
} from './metadata';
import { fitWithin, resizeImage } from './resize';
import type { JobSpec } from './settings';
import type { WatermarkSettings } from './watermark';

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

export interface PipelineDeps {
  /** Draws the watermark onto the image in place. */
  watermark: (img: RGBAImage, settings: WatermarkSettings) => Promise<unknown>;
  /** Called as each step starts. `attempt` counts the tries while fitting a target size. */
  progress?: (step: ProcessStep, attempt?: number) => void;
}

/** An error whose message is meant for the person using the site. */
export class UserFacingError extends Error {}

/**
 * Qualities searched when aiming for a file size. The lowest is the floor
 * below which the image is made smaller instead. The floors look about the
 * same in every format (as JPG quality 50 does; measured with SSIMULACRA2 on
 * real photos, see the README). PNG has no quality: 1 = lossless, 0 = 256
 * colours. TIFF is always lossless.
 */
export const TARGET_QUALITY: Record<OutputFormat, { min: number; max: number }> = {
  jpeg: { min: 50, max: 100 },
  webp: { min: 50, max: 100 },
  avif: { min: 62, max: 100 },
  jxl: { min: 54, max: 100 },
  png: { min: 0, max: 1 },
  tiff: { min: 1, max: 1 },
};

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
    [40, 0.47],
    [50, 0.54],
    [60, 0.61],
    [70, 0.69],
    [80, 0.89],
    [85, 1.1],
    [90, 1.44],
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
function typicalSize(table: [number, number][], pixels: number, quality: number): number {
  let i = 1;
  while (i < table.length - 1 && table[i][0] < quality) i++;
  const [[q0, b0], [q1, b1]] = [table[i - 1], table[i]];
  const t = (quality - q0) / (q1 - q0);
  const bpp = Math.exp(Math.log(b0) + t * (Math.log(b1) - Math.log(b0)));
  return (bpp * pixels) / 8;
}

/** The image is never made smaller than this on its longer side to reach a target. */
const TARGET_MIN_SIDE = 64;

interface Fitted {
  bytes: Uint8Array;
  width: number;
  height: number;
  lossless: boolean;
  notes: string[];
}

/** Encodes at the highest quality that fits the target, shrinking the image only if needed. */
async function encodeToTarget(
  img: RGBAImage,
  format: OutputFormat,
  targetBytes: number,
  encode: (img: RGBAImage, lossless: boolean, quality: number) => Promise<Uint8Array>,
  progress: PipelineDeps['progress'],
): Promise<Fitted> {
  const range = TARGET_QUALITY[format];
  const table = TYPICAL_BPP[format];
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
  const r = await fitToSize(
    targetBytes,
    async (quality, scale) => {
      const image = atScale(scale);
      const bytes = await encode(image, losslessAt(quality), quality);
      return { size: bytes.length, value: { bytes, width: image.width, height: image.height } };
    },
    {
      minQuality: range.min,
      maxQuality: range.max,
      minScale: Math.min(1, TARGET_MIN_SIDE / Math.max(img.width, img.height)),
      onAttempt: (n) => progress?.('fitting', n),
      typicalSize: table && ((q) => typicalSize(table, img.width * img.height, q)),
    },
  );
  const { quality, scale, value } = r.best;
  const lossless = losslessAt(quality);
  const limit = formatBytes(targetBytes);
  const dims = `${value.width} × ${value.height}`;
  const how =
    format === 'png'
      ? lossless
        ? 'without any loss'
        : 'by reducing it to 256 colours (with dithering)'
      : lossless
        ? 'without any loss'
        : `at quality ${quality}`;
  const notes: string[] = [];
  if (!r.fits) {
    notes.push(
      `Couldn't get under ${limit}: even at ${dims} ${how} it is ${formatBytes(value.bytes.length)}. Try a larger target or another format.`,
    );
  } else if (scale >= 1) {
    notes.push(`Fits under ${limit} ${how}.`);
  } else if (format === 'tiff') {
    notes.push(`TIFF has no lossy mode, so it was resized to ${dims} to fit under ${limit}.`);
  } else {
    notes.push(
      `Even the lowest quality allowed was too big for ${limit}, so it was also resized to ${dims} (${how}).`,
    );
  }
  return { bytes: value.bytes, width: value.width, height: value.height, lossless, notes };
}

const SOURCE_ONLY_NOTE = (input: InputFormat, target: OutputFormat) =>
  `${INPUT_FORMAT_LABELS[input]} files can't be saved as ${INPUT_FORMAT_LABELS[input]}, so this was saved as ${OUTPUT_FORMATS[target].label}.`;

function result(
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

/**
 * Lossless compression that works on the file itself rather than on
 * decoded pixels, where that is possible. Returns null to use the general path.
 */
async function losslessInPlace(
  bytes: Uint8Array,
  input: InputFormat,
  spec: JobSpec,
  size: () => Promise<{ width: number; height: number }>,
  progress: PipelineDeps['progress'],
): Promise<ProcessResult | null> {
  switch (input) {
    case 'jpeg': {
      const dims = await size();
      progress?.('compressing');
      const r = optimizeJpeg(bytes, { stripMetadata: spec.stripMetadata });
      const notes = [
        r.huffmanOptimized
          ? 'Re-packed losslessly: every pixel is identical to the original.'
          : 'This JPG uses progressive or arithmetic coding, which is already efficient, so only metadata was cleaned.',
      ];
      return result(r.bytes, 'jpeg', dims, true, notes);
    }
    case 'png': {
      const dims = await size();
      progress?.('compressing');
      let out = await optimisePng(bytes, spec.effort);
      if (spec.stripMetadata) {
        out = stripPngMetadata(out);
      } else {
        const { exif } = extractPngMetadata(bytes);
        out = injectPngMetadata(out, { exif });
      }
      return result(out, 'png', dims, true, ['Optimised losslessly: every pixel is identical.']);
    }
    case 'webp': {
      if (isLosslessWebP(bytes)) return null; // re-encoded below with maximum lossless settings
      const out = spec.stripMetadata ? stripWebpMetadata(bytes) : bytes;
      return result(out, 'webp', await size(), false, [
        'This WebP is already lossy-compressed; it cannot get smaller without losing more quality. Try "Visually lossless".',
      ]);
    }
    case 'avif':
    case 'jxl':
      return result(
        bytes,
        input,
        await size(),
        false,
        [
          `${INPUT_FORMAT_LABELS[input]} files are already compressed; lossless mode cannot make them smaller. Try "Visually lossless".`,
        ],
        true,
      );
    default:
      return null;
  }
}

export async function processImage(
  bytes: Uint8Array,
  name: string,
  spec: JobSpec,
  deps: PipelineDeps,
): Promise<ProcessResult> {
  const input = detectFormat(bytes, name);
  if (!input) throw new UserFacingError('This file type is not supported.');
  const writable = writableAs(input);
  const target: OutputFormat =
    spec.target === 'keep' ? (writable ?? spec.fallbackFormat) : spec.target;
  const info = OUTPUT_FORMATS[target];
  const notes: string[] = [];
  if (spec.target === 'keep' && !writable) notes.push(SOURCE_ONLY_NOTE(input, target));
  const sameFormat = target === writable;

  let decodedOnce: Awaited<ReturnType<typeof decodeImage>> | null = null;
  const decode = async () => {
    if (!decodedOnce) {
      deps.progress?.('reading');
      try {
        decodedOnce = await decodeImage(bytes, input);
      } catch (err) {
        throw new UserFacingError(
          `Could not read this ${INPUT_FORMAT_LABELS[input]} file (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    }
    return decodedOnce;
  };

  // Aiming for a size the original already fits: never lose quality, only
  // tidy up losslessly where possible.
  if (
    spec.targetBytes !== null &&
    sameFormat &&
    !spec.watermark &&
    !spec.resize &&
    bytes.length <= spec.targetBytes
  ) {
    const size = async () => {
      const d = await decode();
      return { width: d.image.width, height: d.image.height };
    };
    const already = `Already under ${formatBytes(spec.targetBytes)}`;
    const tidy =
      input === 'jpeg' || input === 'png'
        ? await losslessInPlace(bytes, input, spec, size, deps.progress)
        : null;
    if (tidy && tidy.bytes.length <= bytes.length) {
      tidy.notes = [`${already}, so it was only optimised losslessly.`, ...tidy.notes];
      tidy.notes.unshift(...notes);
      return tidy;
    }
    return result(
      bytes,
      target,
      await size(),
      true,
      [...notes, `${already}, so it was kept unchanged.`],
      true,
    );
  }

  let out: ProcessResult | null = null;
  if (!spec.watermark && !spec.resize && sameFormat && spec.lossless === true) {
    out = await losslessInPlace(
      bytes,
      input,
      spec,
      async () => {
        const d = await decode();
        return { width: d.image.width, height: d.image.height };
      },
      deps.progress,
    );
  }

  if (!out) {
    const decoded = await decode();
    let img = decoded.image;
    if (spec.resize) {
      const fit = fitWithin(img.width, img.height, spec.resize.maxWidth, spec.resize.maxHeight);
      if (fit.width < img.width || fit.height < img.height) {
        deps.progress?.('resizing');
        img = resizeImage(img, fit.width, fit.height);
        notes.push(`Resized to ${fit.width} × ${fit.height}.`);
      }
    }
    if (spec.watermark) {
      deps.progress?.('watermarking');
      await deps.watermark(img, spec.watermark);
    }

    let lossless: boolean;
    if (target === 'png') lossless = spec.lossless !== false;
    else if (target === 'tiff') lossless = true;
    else if (target === 'jpeg') lossless = false;
    else lossless = spec.lossless === 'match-source' ? decoded.sourceLossless : spec.lossless;

    if (spec.lossless === true && target === 'jpeg') {
      notes.push(`JPG can't store images losslessly, so it was saved at quality ${spec.quality}.`);
    }
    const transparent = hasTransparency(img);
    if (target === 'jpeg' && transparent) {
      notes.push('JPG has no transparency, so transparent areas were filled with white.');
    }

    const icc = decoded.meta.icc && info.icc ? decoded.meta.icc : undefined;
    const exif =
      !spec.stripMetadata && decoded.meta.exif && info.exif
        ? exifForReencode(decoded.meta.exif)
        : undefined;
    // Encodes and adds the metadata, so sizes checked against a target are final.
    const encodeFinal = async (image: RGBAImage, asLossless: boolean, quality: number) => {
      let encoded = await encodeImage(image, target, {
        lossless: asLossless,
        quality,
        effort: spec.effort,
        icc,
      });
      if (target === 'jpeg') encoded = injectJpegMetadata(encoded, { exif, icc });
      if (target === 'png') encoded = injectPngMetadata(encoded, { exif, icc });
      if (target === 'webp') encoded = injectWebpMetadata(encoded, { exif, icc }, transparent);
      return encoded;
    };

    let encoded: Uint8Array;
    let saved = { width: img.width, height: img.height };
    if (spec.targetBytes !== null) {
      const fitted = await encodeToTarget(
        img,
        target,
        spec.targetBytes,
        encodeFinal,
        deps.progress,
      );
      encoded = fitted.bytes;
      saved = { width: fitted.width, height: fitted.height };
      lossless = fitted.lossless;
      notes.push(...fitted.notes);
    } else {
      if (target === 'png' && !lossless) {
        notes.push(
          'PNG has no quality setting; colours were reduced to 256 (with dithering) to save space.',
        );
      }
      deps.progress?.('compressing');
      encoded = await encodeFinal(img, lossless, spec.quality);
    }

    if (!spec.stripMetadata && decoded.meta.exif && !info.exif) {
      notes.push(`${info.label} files can't carry camera metadata here, so it was left out.`);
    }
    if (decoded.meta.icc && !info.icc) {
      notes.push(
        `The colour profile can't be stored in ${info.label} here; colours may look slightly different.`,
      );
    }
    if (input === 'webp' && sameFormat && spec.lossless === true && decoded.sourceLossless) {
      notes.push('Re-compressed losslessly: every pixel is identical.');
    }
    out = result(encoded, target, saved, lossless, notes);
  } else {
    out.notes.unshift(...notes);
  }

  if (spec.neverBigger && sameFormat && !out.keptOriginal && out.bytes.length >= bytes.length) {
    const keep = await decode().catch(() => null);
    return result(
      bytes,
      target,
      keep ? keep.image : { width: out.width, height: out.height },
      out.lossless,
      ['The original is already as small as this setting can make it, so it was kept unchanged.'],
      true,
    );
  }
  return out;
}

/** Decodes a file into a (possibly downscaled) preview image. */
export async function decodePreview(
  bytes: Uint8Array,
  name: string,
  maxSize: number,
): Promise<{ image: RGBAImage; width: number; height: number; format: InputFormat }> {
  const format = detectFormat(bytes, name);
  if (!format) throw new UserFacingError('This file type is not supported.');
  let decoded;
  try {
    decoded = await decodeImage(bytes, format);
  } catch (err) {
    throw new UserFacingError(
      `Could not read this ${INPUT_FORMAT_LABELS[format]} file (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  const { width, height } = decoded.image;
  const fit = maxSize > 0 ? fitWithin(width, height, maxSize, maxSize) : { width, height };
  const image = resizeImage(decoded.image, fit.width, fit.height);
  return { image, width, height, format };
}
