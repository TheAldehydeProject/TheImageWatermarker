import type { InputFormat, OutputFormat } from './formats';
import type { ProcessStep } from './process';

/**
 * Messages from a page to its processing worker. `spec` is the tool's own job
 * description (see src/tools/<tool>/settings.ts); the engine passes it through.
 */
export type WorkerRequest =
  | { type: 'process'; id: number; name: string; bytes: ArrayBuffer; spec: unknown }
  | { type: 'preview'; id: number; name: string; bytes: ArrayBuffer; maxSize: number };

export interface ProcessedFile {
  bytes: ArrayBuffer;
  format: OutputFormat;
  extension: string;
  mime: string;
  width: number;
  height: number;
  lossless: boolean;
  keptOriginal: boolean;
  notes: string[];
}

export interface PreviewImage {
  /** RGBA pixels of the (possibly downscaled) preview. */
  pixels: ArrayBuffer;
  width: number;
  height: number;
  /** Size of the full image. */
  fullWidth: number;
  fullHeight: number;
  format: InputFormat;
}

/** Messages from a worker back to the page. */
export type WorkerResponse =
  | { type: 'progress'; id: number; step: ProcessStep; attempt?: number }
  | { type: 'process-done'; id: number; file: ProcessedFile }
  | { type: 'preview-done'; id: number; preview: PreviewImage }
  | { type: 'error'; id: number; message: string };

type Payload<T> = T extends { id: number } ? Omit<T, 'id'> : never;
export type WorkerJob = Payload<WorkerRequest>;
