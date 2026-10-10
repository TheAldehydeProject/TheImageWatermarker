/// <reference lib="webworker" />
/**
 * Runs inside a tool's web worker: answers preview requests and hands each
 * file to that tool's own processing function.
 */
import { decodePreview, UserFacingError, type ProcessResult, type Progress } from './process';
import type { WorkerRequest, WorkerResponse } from './protocol';

export type ProcessFile<Spec> = (
  bytes: Uint8Array,
  name: string,
  spec: Spec,
  progress: Progress,
) => Promise<ProcessResult>;

/** Copies a byte view into its own ArrayBuffer so it can be transferred. */
function ownBuffer(bytes: Uint8Array | Uint8ClampedArray): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export function serveWorker<Spec>(processFile: ProcessFile<Spec>): void {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  const reply = (msg: WorkerResponse, transfer: Transferable[] = []) =>
    scope.postMessage(msg, transfer);

  scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const req = event.data;
    try {
      if (req.type === 'process') {
        const r = await processFile(
          new Uint8Array(req.bytes),
          req.name,
          req.spec as Spec,
          (step, attempt) => reply({ type: 'progress', id: req.id, step, attempt }),
        );
        const bytes = ownBuffer(r.bytes);
        reply(
          {
            type: 'process-done',
            id: req.id,
            file: {
              bytes,
              format: r.format,
              extension: r.extension,
              mime: r.mime,
              width: r.width,
              height: r.height,
              lossless: r.lossless,
              keptOriginal: r.keptOriginal,
              notes: r.notes,
            },
          },
          [bytes],
        );
      } else {
        const p = await decodePreview(new Uint8Array(req.bytes), req.name, req.maxSize);
        const pixels = ownBuffer(p.image.data);
        reply(
          {
            type: 'preview-done',
            id: req.id,
            preview: {
              pixels,
              width: p.image.width,
              height: p.image.height,
              fullWidth: p.width,
              fullHeight: p.height,
              format: p.format,
            },
          },
          [pixels],
        );
      }
    } catch (err) {
      if (!(err instanceof UserFacingError)) console.error(err);
      const message =
        err instanceof UserFacingError
          ? err.message
          : `Something went wrong while processing this file (${err instanceof Error ? err.message : String(err)}).`;
      reply({ type: 'error', id: req.id, message });
    }
  };
}
