/**
 * Convert: saves each image in the chosen format, losslessly or at the chosen
 * quality.
 */
import {
  detectOrFail,
  lazyDecoder,
  prepareSave,
  resizeToFit,
  result,
  type ProcessResult,
  type Progress,
} from '../../engine/process';
import type { ConvertSpec } from './settings';

export async function convertImage(
  bytes: Uint8Array,
  name: string,
  spec: ConvertSpec,
  progress?: Progress,
): Promise<ProcessResult> {
  const input = detectOrFail(bytes, name);
  const decoded = await lazyDecoder(bytes, input, progress)();
  const notes: string[] = [];
  const img = resizeToFit(decoded.image, spec.resize, notes, progress);
  const prepared = prepareSave(decoded, img, spec.format, {
    keepExif: !spec.stripMetadata,
    effort: spec.effort,
  });
  notes.push(...prepared.notes);
  progress?.('compressing');
  const encoded = await prepared.save(img, spec.lossless, spec.quality);
  return result(encoded, spec.format, img, spec.lossless, notes);
}
