import type { ProcessStep } from './pipeline';

/** Where a file is in a batch: waiting for a free worker, or one of the processing steps. */
export type FileStep = 'queued' | ProcessStep;

/** Roughly how much of one file's work is behind it when it reaches each step. */
const STEP_SHARE: Record<FileStep, number> = {
  queued: 0,
  reading: 0.1,
  resizing: 0.3,
  watermarking: 0.35,
  compressing: 0.45,
  fitting: 0.5,
};

export function stepShare(step: FileStep, attempt = 0): number {
  // Each try at a target size moves it along a little more.
  if (step === 'fitting') return Math.min(0.95, STEP_SHARE.fitting + Math.max(0, attempt) * 0.05);
  return STEP_SHARE[step];
}

/**
 * How much of a batch is finished, from 0 to 1. Files still being processed
 * count for the steps they have reached, so the bar keeps moving on big files.
 */
export function batchFraction(
  done: number,
  total: number,
  running: { step: FileStep; attempt?: number }[],
): number {
  if (total <= 0) return 0;
  const partial = running.reduce((sum, r) => sum + stepShare(r.step, r.attempt), 0);
  return Math.min(1, Math.max(0, (done + partial) / total));
}

/** What the file list shows for a file at each step. */
export function stepLabel(step: FileStep, attempt = 0): string {
  switch (step) {
    case 'queued':
      return 'Waiting…';
    case 'reading':
      return 'Reading…';
    case 'resizing':
      return 'Resizing…';
    case 'watermarking':
      return 'Adding the watermark…';
    case 'compressing':
      return 'Compressing…';
    case 'fitting':
      return attempt > 0
        ? `Fitting to the target size (try ${attempt})…`
        : 'Fitting to the target size…';
  }
}
