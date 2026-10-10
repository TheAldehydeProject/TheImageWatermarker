/**
 * Watermark: adds the molecule and otherwise leaves the image as it was
 * uploaded. Same format, dimensions and camera data; lossless files stay
 * lossless, and lossy files are saved at the highest quality that keeps the
 * file no bigger than the original.
 */
import { formatBytes } from '../../engine/filename';
import { writableAs, type OutputFormat } from '../../engine/formats';
import type { RGBAImage } from '../../engine/image';
import { jpegChromaSubsampling } from '../../engine/metadata';
import {
  detectOrFail,
  encodeToTarget,
  lazyDecoder,
  prepareSave,
  result,
  SOURCE_ONLY_NOTE,
  type ProcessResult,
  type Progress,
} from '../../engine/process';
import type { WatermarkSpec } from './settings';
import type { WatermarkSettings } from './watermark';

export interface WatermarkDeps {
  /** Draws the watermark onto the image in place (the canvas renderer in the browser). */
  draw: (img: RGBAImage, settings: WatermarkSettings) => Promise<unknown>;
  progress?: Progress;
}

/** The slowest encoders (AVIF, JPEG XL) keep their usual speed; the others use their best settings. */
const effortFor = (format: OutputFormat) =>
  format === 'avif' || format === 'jxl' ? 'balanced' : 'maximum';

export async function watermarkImage(
  bytes: Uint8Array,
  name: string,
  spec: WatermarkSpec,
  deps: WatermarkDeps,
): Promise<ProcessResult> {
  const { progress } = deps;
  const input = detectOrFail(bytes, name);
  const writable = writableAs(input);
  const target: OutputFormat = writable ?? spec.fallbackFormat;
  const notes: string[] = [];
  if (!writable) notes.push(SOURCE_ONLY_NOTE(input, target));

  const decoded = await lazyDecoder(bytes, input, progress)();
  const img = decoded.image;
  progress?.('watermarking');
  await deps.draw(img, spec.watermark);

  const lossless =
    target === 'png' || target === 'tiff'
      ? true
      : target === 'jpeg'
        ? false
        : decoded.sourceLossless;
  const prepared = prepareSave(decoded, img, target, {
    keepExif: true,
    effort: 'balanced',
    // A JPG keeps its own colour resolution, like everything else about it.
    jpegChroma: input === 'jpeg' ? (jpegChromaSubsampling(bytes) ?? undefined) : undefined,
  });
  notes.push(...prepared.notes);
  const original = formatBytes(bytes.length);

  if (lossless) {
    progress?.('compressing');
    let out = await prepared.save(img, true, 100, 'balanced');
    if (out.length > bytes.length) {
      // Try harder before accepting a bigger file.
      const tighter = await prepared.save(img, true, 100, 'maximum');
      if (tighter.length < out.length) out = tighter;
    }
    notes.push('Saved losslessly: apart from the watermark, every pixel is identical.');
    if (out.length > bytes.length) {
      notes.push(
        `That makes it ${formatBytes(out.length - bytes.length)} bigger than the original (${original}): a lossless file can't be capped without losing quality.`,
      );
    }
    return result(out, target, img, true, notes);
  }

  // Lossy: the highest quality whose file is no bigger than the original.
  const effort = effortFor(target);
  const fitted = await encodeToTarget(
    img,
    target,
    bytes.length,
    (image, asLossless, quality) => prepared.save(image, asLossless, quality, effort),
    { minQuality: 1, maxQuality: 100, allowShrink: false, closeEnough: 0.98 },
    progress,
  );
  notes.push(
    fitted.fits
      ? `Saved at quality ${fitted.quality} so it is no bigger than the original: ${formatBytes(fitted.bytes.length)} (the original is ${original}).`
      : `Even at the lowest quality it is ${formatBytes(fitted.bytes.length)}, a little bigger than the original (${original}).`,
  );
  return result(fitted.bytes, target, img, false, notes);
}
