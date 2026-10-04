/// <reference lib="webworker" />
import { decodePreview, processImage, UserFacingError } from '../lib/pipeline';
import type { WorkerRequest, WorkerResponse } from '../lib/protocol';
import { renderWatermark } from '../lib/watermarkRender';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

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

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.type === 'process') {
      const r = await processImage(new Uint8Array(req.bytes), req.name, req.spec, {
        watermark: renderWatermark,
        progress: (step, attempt) => reply({ type: 'progress', id: req.id, step, attempt }),
      });
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
