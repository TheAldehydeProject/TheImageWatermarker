import type { WorkerJob, WorkerRequest, WorkerResponse } from './protocol';

type Success = Exclude<WorkerResponse, { type: 'error' | 'progress' }>;
export type ProgressMessage = Extract<WorkerResponse, { type: 'progress' }>;

/** Builds a job only once a worker is free, so large files aren't all read into memory at once. */
export type PrepareJob = () => Promise<{ job: WorkerJob; transfer: Transferable[] }>;

interface Pending {
  prepare: PrepareJob;
  resolve: (r: Success) => void;
  reject: (e: Error) => void;
  onProgress?: (p: ProgressMessage) => void;
}

/**
 * Runs jobs on a small set of web workers so several images are processed
 * at once without freezing the page.
 */
export class WorkerPool {
  private idle: Worker[] = [];
  private queue: Pending[] = [];
  private running = new Map<number, { worker: Worker; pending: Pending }>();
  private busy = new Set<Worker>();
  private nextId = 1;

  constructor(
    private readonly create: () => Worker,
    private readonly size: number,
  ) {}

  /** `onProgress` receives the worker's step-by-step reports while the job runs. */
  run(prepare: PrepareJob, onProgress?: (p: ProgressMessage) => void): Promise<Success> {
    return new Promise((resolve, reject) => {
      this.queue.push({ prepare, resolve, reject, onProgress });
      this.pump();
    });
  }

  private spawn(): Worker {
    const worker = this.create();
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.finish(worker, e.data);
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      for (const [id, entry] of this.running) {
        if (entry.worker !== worker) continue;
        this.running.delete(id);
        entry.pending.reject(
          new Error(e.message || 'The processing worker crashed (possibly out of memory).'),
        );
      }
      this.busy.delete(worker);
      worker.terminate();
      this.pump();
    };
    return worker;
  }

  private pump(): void {
    while (this.queue.length) {
      let worker = this.idle.pop();
      if (!worker) {
        if (this.busy.size >= this.size) return;
        worker = this.spawn();
      }
      const pending = this.queue.shift()!;
      this.busy.add(worker);
      void this.start(worker, pending);
    }
  }

  private async start(worker: Worker, pending: Pending): Promise<void> {
    let prepared: Awaited<ReturnType<PrepareJob>>;
    try {
      prepared = await pending.prepare();
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
      this.release(worker);
      return;
    }
    const id = this.nextId++;
    this.running.set(id, { worker, pending });
    worker.postMessage({ ...prepared.job, id } as WorkerRequest, prepared.transfer);
  }

  private release(worker: Worker): void {
    this.busy.delete(worker);
    this.idle.push(worker);
    this.pump();
  }

  private finish(worker: Worker, msg: WorkerResponse): void {
    const entry = this.running.get(msg.id);
    if (!entry) return;
    if (msg.type === 'progress') {
      entry.pending.onProgress?.(msg);
      return;
    }
    this.running.delete(msg.id);
    if (msg.type === 'error') entry.pending.reject(new Error(msg.message));
    else entry.pending.resolve(msg);
    this.release(worker);
  }
}
