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

export interface PipelineDeps {
  /** Draws the watermark onto the image in place. */
  watermark: (img: RGBAImage, settings: WatermarkSettings) => Promise<unknown>;
}

/** An error whose message is meant for the person using the site. */
export class UserFacingError extends Error {}

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
): Promise<ProcessResult | null> {
  switch (input) {
    case 'jpeg': {
      const r = optimizeJpeg(bytes, { stripMetadata: spec.stripMetadata });
      const notes = [
        r.huffmanOptimized
          ? 'Re-packed losslessly: every pixel is identical to the original.'
          : 'This JPG uses progressive or arithmetic coding, which is already efficient, so only metadata was cleaned.',
      ];
      return result(r.bytes, 'jpeg', await size(), true, notes);
    }
    case 'png': {
      let out = await optimisePng(bytes, spec.effort);
      if (spec.stripMetadata) {
        out = stripPngMetadata(out);
      } else {
        const { exif } = extractPngMetadata(bytes);
        out = injectPngMetadata(out, { exif });
      }
      return result(out, 'png', await size(), true, [
        'Optimised losslessly: every pixel is identical.',
      ]);
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

  let out: ProcessResult | null = null;
  if (!spec.watermark && !spec.resize && sameFormat && spec.lossless === true) {
    out = await losslessInPlace(bytes, input, spec, async () => {
      const d = await decode();
      return { width: d.image.width, height: d.image.height };
    });
  }

  if (!out) {
    const decoded = await decode();
    let img = decoded.image;
    if (spec.resize) {
      const fit = fitWithin(img.width, img.height, spec.resize.maxWidth, spec.resize.maxHeight);
      if (fit.width < img.width || fit.height < img.height) {
        img = resizeImage(img, fit.width, fit.height);
        notes.push(`Resized to ${fit.width} × ${fit.height}.`);
      }
    }
    if (spec.watermark) await deps.watermark(img, spec.watermark);

    let lossless: boolean;
    if (target === 'png') lossless = spec.lossless !== false;
    else if (target === 'tiff') lossless = true;
    else if (target === 'jpeg') lossless = false;
    else lossless = spec.lossless === 'match-source' ? decoded.sourceLossless : spec.lossless;

    if (spec.lossless === true && target === 'jpeg') {
      notes.push(`JPG can't store images losslessly, so it was saved at quality ${spec.quality}.`);
    }
    if (target === 'png' && !lossless) {
      notes.push(
        'PNG has no quality setting; colours were reduced to 256 (with dithering) to save space.',
      );
    }
    const transparent = hasTransparency(img);
    if (target === 'jpeg' && transparent) {
      notes.push('JPG has no transparency, so transparent areas were filled with white.');
    }

    const icc = decoded.meta.icc && info.icc ? decoded.meta.icc : undefined;
    let encoded = await encodeImage(img, target, {
      lossless,
      quality: spec.quality,
      effort: spec.effort,
      icc,
    });

    const exif =
      !spec.stripMetadata && decoded.meta.exif && info.exif
        ? exifForReencode(decoded.meta.exif)
        : undefined;
    if (target === 'jpeg') encoded = injectJpegMetadata(encoded, { exif, icc });
    if (target === 'png') encoded = injectPngMetadata(encoded, { exif, icc });
    if (target === 'webp') encoded = injectWebpMetadata(encoded, { exif, icc }, transparent);
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
    out = result(encoded, target, img, lossless, notes);
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
