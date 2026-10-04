import { describe, expect, it } from 'vitest';
import { batchFraction, stepLabel, stepShare, type FileStep } from '../src/lib/progress';
import type { WorkerJob, WorkerRequest, WorkerResponse } from '../src/lib/protocol';
import { WorkerPool, type ProgressMessage } from '../src/lib/workerPool';

describe('batch progress', () => {
  it('counts finished files', () => {
    expect(batchFraction(3, 10, [])).toBeCloseTo(0.3);
    expect(batchFraction(10, 10, [])).toBe(1);
    expect(batchFraction(0, 0, [])).toBe(0);
  });

  it('moves forward as running files reach later steps', () => {
    const order: FileStep[] = ['queued', 'reading', 'resizing', 'watermarking', 'compressing'];
    const values = order.map((step) => batchFraction(1, 4, [{ step }]));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    // A file part-way through never counts as a whole one.
    expect(values.at(-1)!).toBeLessThan(2 / 4);
    expect(batchFraction(0, 1, [{ step: 'queued' }])).toBe(0);
  });

  it('keeps moving while trying sizes, without reaching done', () => {
    const tries = [1, 2, 3, 5, 8, 40].map((attempt) => stepShare('fitting', attempt));
    for (let i = 1; i < tries.length; i++) expect(tries[i]).toBeGreaterThanOrEqual(tries[i - 1]);
    expect(tries[0]).toBeGreaterThan(stepShare('compressing'));
    expect(Math.max(...tries)).toBeLessThan(1);
  });

  it('never goes past 100%', () => {
    expect(batchFraction(2, 2, [{ step: 'compressing' }])).toBe(1);
  });

  it('labels every step', () => {
    expect(stepLabel('queued')).toBe('Waiting…');
    expect(stepLabel('reading')).toBe('Reading…');
    expect(stepLabel('watermarking')).toBe('Adding the watermark…');
    expect(stepLabel('compressing')).toBe('Compressing…');
    expect(stepLabel('fitting', 3)).toBe('Fitting to the target size (try 3)…');
  });
});

/** A stand-in worker that answers each job with the messages the test gives it. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  received: WorkerRequest[] = [];
  postMessage(msg: WorkerRequest) {
    this.received.push(msg);
  }
  send(msg: WorkerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }
  terminate() {}
}

const job: WorkerJob = { type: 'preview', name: 'x.png', bytes: new ArrayBuffer(1), maxSize: 1 };
const prepare = async () => ({ job, transfer: [] });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('WorkerPool', () => {
  it('passes progress reports on and resolves only on the final reply', async () => {
    const workers: FakeWorker[] = [];
    const pool = new WorkerPool(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    }, 1);
    const seen: ProgressMessage[] = [];
    let finished = false;
    const first = pool
      .run(prepare, (p) => seen.push(p))
      .then((r) => {
        finished = true;
        return r;
      });
    const second = pool.run(prepare);
    await settle();
    expect(workers).toHaveLength(1);
    const [w] = workers;
    const id = w.received[0].id;

    w.send({ type: 'progress', id, step: 'reading' });
    w.send({ type: 'progress', id, step: 'fitting', attempt: 2 });
    await settle();
    expect(seen.map((p) => [p.step, p.attempt])).toEqual([
      ['reading', undefined],
      ['fitting', 2],
    ]);
    expect(finished).toBe(false);
    // The worker is still busy, so the second job hasn't started.
    expect(w.received).toHaveLength(1);

    const preview = {
      pixels: new ArrayBuffer(4),
      width: 1,
      height: 1,
      fullWidth: 1,
      fullHeight: 1,
    };
    w.send({ type: 'preview-done', id, preview: { ...preview, format: 'png' } });
    expect((await first).type).toBe('preview-done');
    await settle();
    // The same worker moves on to the queued job.
    expect(w.received).toHaveLength(2);
    w.send({ type: 'error', id: w.received[1].id, message: 'nope' });
    await expect(second).rejects.toThrow('nope');
  });
});
