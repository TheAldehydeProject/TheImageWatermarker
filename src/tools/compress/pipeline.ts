/**
 * Compress: makes files smaller. Either keeps each file's format (lossless,
 * visually lossless or a target size) or saves everything as WebP at a
 * target size. Never hands back a file bigger than the original.
 */
import { optimisePng } from '../../engine/codecs';
import { formatBytes } from '../../engine/filename';
import {
  INPUT_FORMAT_LABELS,
  isLosslessWebP,
  writableAs,
  type InputFormat,
  type OutputFormat,
} from '../../engine/formats';
import {
  extractPngMetadata,
  injectPngMetadata,
  stripPngMetadata,
  stripWebpMetadata,
} from '../../engine/metadata';
import {
  detectOrFail,
  encodeToTarget,
  lazyDecoder,
  prepareSave,
  resizeToFit,
  result,
  SOURCE_ONLY_NOTE,
  type Fitted,
  type ProcessResult,
  type Progress,
} from '../../engine/process';
import { optimizeJpeg } from './jpegOptimize';
import type { CompressSpec, TooBig } from './settings';

/**
 * Lowest quality used to reach a target before the image is made smaller.
 * 'shrink' keeps a clean look: these floors look about the same in every
 * format (like JPG quality 50; measured with SSIMULACRA2 on real photos).
 * 'lower-quality' lets it drop to about WebP quality 20 first. PNG has no
 * quality: 1 = lossless, 0 = 256 colours. TIFF is always lossless.
 */
export const QUALITY_FLOOR: Record<TooBig, Record<OutputFormat, number>> = {
  shrink: { jpeg: 50, webp: 50, avif: 62, jxl: 54, png: 0, tiff: 1 },
  'lower-quality': { jpeg: 20, webp: 20, avif: 47, jxl: 20, png: 0, tiff: 1 },
};
const QUALITY_MAX: Record<OutputFormat, number> = {
  jpeg: 100,
  webp: 100,
  avif: 100,
  jxl: 100,
  png: 1,
  tiff: 1,
};

/**
 * Lossless compression that works on the file itself rather than on decoded
 * pixels, where that is possible. Returns null to use the general path.
 */
async function losslessInPlace(
  bytes: Uint8Array,
  input: InputFormat,
  spec: CompressSpec,
  size: () => Promise<{ width: number; height: number }>,
  progress?: Progress,
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
      if (isLosslessWebP(bytes)) return null; // re-encoded below with lossless settings
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

/** Explains how a target size was reached (or why it couldn't be). */
function fitNotes(f: Fitted, format: OutputFormat, goal: number): string[] {
  const limit = formatBytes(goal);
  const dims = `${f.width} × ${f.height}`;
  const how =
    format === 'png' && !f.lossless
      ? 'by reducing it to 256 colours (with dithering)'
      : f.lossless
        ? 'without any loss'
        : `at quality ${f.quality}`;
  if (!f.fits) {
    return [
      `Couldn't get under ${limit}: even at ${dims} ${how} it is ${formatBytes(f.bytes.length)}. Try a larger target or another format.`,
    ];
  }
  if (f.scale >= 1) return [`Fits under ${limit} ${how}.`];
  if (format === 'tiff') {
    return [`TIFF has no lossy mode, so it was resized to ${dims} to fit under ${limit}.`];
  }
  return [
    `The lowest quality allowed was still too big for ${limit}, so it was also resized to ${dims} (${how}).`,
  ];
}

export async function compressImage(
  bytes: Uint8Array,
  name: string,
  spec: CompressSpec,
  progress?: Progress,
): Promise<ProcessResult> {
  const input = detectOrFail(bytes, name);
  const writable = writableAs(input);
  const webp = spec.output === 'webp';
  const target: OutputFormat = webp ? 'webp' : (writable ?? spec.fallbackFormat);
  const notes: string[] = [];
  if (!webp && !writable) notes.push(SOURCE_ONLY_NOTE(input, target));
  const sameFormat = target === writable;
  const decode = lazyDecoder(bytes, input, progress);
  const size = async () => {
    const d = await decode();
    return { width: d.image.width, height: d.image.height };
  };

  // Aiming for a size the original already fits in its own format: never lose
  // quality, only tidy up losslessly where possible.
  if (spec.targetBytes !== null && sameFormat && !spec.resize && bytes.length <= spec.targetBytes) {
    const already = `Already under ${formatBytes(spec.targetBytes)}`;
    const tidy =
      input === 'jpeg' || input === 'png'
        ? await losslessInPlace(bytes, input, spec, size, progress)
        : null;
    if (tidy && tidy.bytes.length <= bytes.length) {
      tidy.notes = [...notes, `${already}, so it was only optimised losslessly.`, ...tidy.notes];
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
  if (spec.mode === 'lossless' && sameFormat && !spec.resize) {
    out = await losslessInPlace(bytes, input, spec, size, progress);
  }

  if (out) {
    out.notes.unshift(...notes);
  } else {
    const decoded = await decode();
    const img = resizeToFit(decoded.image, spec.resize, notes, progress);
    // WebP output always uses the most efficient settings (see the README).
    const effort = webp ? 'maximum' : spec.effort;
    const prepared = prepareSave(decoded, img, target, { keepExif: !spec.stripMetadata, effort });
    notes.push(...prepared.notes);

    if (spec.targetBytes !== null) {
      // Compress never makes a file bigger, so the original's size caps the target.
      const goal = Math.min(spec.targetBytes, bytes.length);
      if (goal < spec.targetBytes) {
        notes.push(
          `The original is only ${formatBytes(bytes.length)}, so it was kept under that instead of ${formatBytes(spec.targetBytes)}: Compress never makes a file bigger.`,
        );
      }
      // Graphics and other lossless images are often small enough as lossless
      // WebP. Only worth a try when the original isn't far bigger than the goal.
      if (webp && decoded.sourceLossless && bytes.length <= goal * 4) {
        progress?.('compressing');
        const exact = await prepared.save(img, true, 100, 'balanced');
        if (exact.length <= goal) {
          return result(exact, 'webp', img, true, [
            ...notes,
            `Fits under ${formatBytes(goal)} without any loss.`,
          ]);
        }
      }
      const fitted = await encodeToTarget(
        img,
        target,
        goal,
        prepared.save,
        {
          minQuality: QUALITY_FLOOR[spec.tooBig][target],
          maxQuality: QUALITY_MAX[target],
          allowShrink: true,
        },
        progress,
      );
      out = result(fitted.bytes, target, fitted, fitted.lossless, [
        ...notes,
        ...fitNotes(fitted, target, goal),
      ]);
    } else {
      let lossless: boolean;
      if (target === 'png') lossless = spec.mode !== 'visual';
      else if (target === 'tiff') lossless = true;
      else if (target === 'jpeg') lossless = false;
      else lossless = spec.mode === 'lossless';
      if (spec.mode === 'lossless' && target === 'jpeg') {
        notes.push(
          `JPG can't store images losslessly, so it was saved at quality ${spec.quality}.`,
        );
      }
      if (target === 'png' && !lossless) {
        notes.push(
          'PNG has no quality setting; colours were reduced to 256 (with dithering) to save space.',
        );
      }
      if (input === 'webp' && sameFormat && lossless && decoded.sourceLossless) {
        notes.push('Re-compressed losslessly: every pixel is identical.');
      }
      progress?.('compressing');
      const encoded = await prepared.save(img, lossless, spec.quality);
      out = result(encoded, target, img, lossless, notes);
    }
  }

  if (sameFormat && !out.keptOriginal && out.bytes.length >= bytes.length) {
    return result(
      bytes,
      target,
      await size(),
      out.lossless,
      ['The original is already as small as this setting can make it, so it was kept unchanged.'],
      true,
    );
  }
  return out;
}
