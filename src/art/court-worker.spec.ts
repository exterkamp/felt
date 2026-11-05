import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CourtJob, CourtReply, CourtWorkerLike, CourtWorkerPool, Slots, courtWorkerSource,
  courtWorkerSupported,
} from './court-worker.js';
import { partBackgroundPixels } from '../core/court-pixels.js';

class FakeWorker implements CourtWorkerLike {
  onmessage: ((event: { data: CourtReply }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  sent: CourtJob[] = [];
  throwOnPost = false;
  postMessage(message: CourtJob): void {
    if (this.throwOnPost) throw new Error('DataCloneError');
    this.sent.push(message);
  }
  terminate(): void { this.terminated = true; }
  reply(reply: CourtReply): void { this.onmessage?.({ data: reply }); }
}

const job = (): Omit<CourtJob, 'id'> => ({
  bitmap: {} as ImageBitmap, pageWidth: 1, pageHeight: 1, wipes: [], wipeColor: '#fff',
  crop: { x: 0, y: 0, width: 1, height: 1 }, width: 1, height: 1, part: null,
});

describe('courtWorkerSupported', () => {
  const full = {
    Worker: function () {}, OffscreenCanvas: function () {}, createImageBitmap: () => 0,
    Blob: function () {}, URL: { createObjectURL: () => '' },
  };
  it('wants all of Worker, OffscreenCanvas, createImageBitmap, Blob and blob URLs', () => {
    expect(courtWorkerSupported(full)).toBe(true);
    for (const missing of Object.keys(full)) {
      expect(courtWorkerSupported({ ...full, [missing]: undefined })).toBe(false);
    }
  });
  it('is false in a bare environment', () => {
    expect(courtWorkerSupported({})).toBe(false);
  });
});

describe('courtWorkerSource', () => {
  it('stands alone: it runs with nothing from this module in scope', () => {
    const posted: unknown[] = [];
    const scope: { onmessage?: (e: unknown) => void } = {};
    const run = new Function('self', 'OffscreenCanvas', courtWorkerSource());
    run(scope, class {});
    expect(typeof scope.onmessage).toBe('function');
    // A job with no usable canvas must answer with an error, not throw.
    (scope as { postMessage?: unknown }).postMessage = (m: unknown) => posted.push(m);
    scope.onmessage?.({ data: { id: 7, bitmap: { close() {} }, pageWidth: 1, pageHeight: 1,
      wipes: [], crop: {}, width: 1, height: 1, part: null } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ id: 7 });
    expect(posted[0]).toHaveProperty('error');
  });
  it('carries the same pixel function the main-thread path uses', () => {
    expect(courtWorkerSource()).toContain(partBackgroundPixels.toString());
  });
});

describe('CourtWorkerPool', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts no worker until the first job', () => {
    const start = vi.fn(() => new FakeWorker());
    const pool = new CourtWorkerPool(start);
    expect(start).not.toHaveBeenCalled();
    expect(pool.running).toBe(false);
  });

  it('answers each job with its own reply', async () => {
    const worker = new FakeWorker();
    const pool = new CourtWorkerPool(() => worker);
    const a = pool.run(job());
    const b = pool.run(job());
    expect(worker.sent.map((s) => s.id)).toEqual([1, 2]);
    const bitmapB = { tag: 'b' } as unknown as ImageBitmap;
    const bitmapA = { tag: 'a' } as unknown as ImageBitmap;
    worker.reply({ id: 2, bitmap: bitmapB });
    worker.reply({ id: 1, bitmap: bitmapA });
    expect(await a).toBe(bitmapA);
    expect(await b).toBe(bitmapB);
  });

  it('terminates the worker once it has been idle, and starts a new one after', async () => {
    const workers: FakeWorker[] = [];
    const pool = new CourtWorkerPool(() => { const w = new FakeWorker(); workers.push(w); return w; }, 1000);
    const first = pool.run(job());
    workers[0].reply({ id: 1, bitmap: {} as ImageBitmap });
    await first;
    vi.advanceTimersByTime(999);
    expect(workers[0].terminated).toBe(false);
    vi.advanceTimersByTime(2);
    expect(workers[0].terminated).toBe(true);
    expect(pool.running).toBe(false);
    expect(pool.usable).toBe(true);
    void pool.run(job());
    expect(workers).toHaveLength(2);
  });

  it('does not let a busy worker idle out', () => {
    const worker = new FakeWorker();
    const pool = new CourtWorkerPool(() => worker, 1000);
    void pool.run(job());
    vi.advanceTimersByTime(10_000);
    expect(worker.terminated).toBe(false);
  });

  it('rejects a job the worker answers with an error, and stays usable', async () => {
    const worker = new FakeWorker();
    const pool = new CourtWorkerPool(() => worker);
    const p = pool.run(job());
    worker.reply({ id: 1, error: 'no 2d context' });
    await expect(p).rejects.toThrow('no 2d context');
    expect(pool.usable).toBe(true);
  });

  it('retires itself and rejects everything waiting when the worker errors', async () => {
    const worker = new FakeWorker();
    const pool = new CourtWorkerPool(() => worker);
    const a = pool.run(job());
    const b = pool.run(job());
    worker.onerror?.({ message: 'script error' });
    await expect(a).rejects.toThrow('script error');
    await expect(b).rejects.toThrow('script error');
    expect(worker.terminated).toBe(true);
    expect(pool.usable).toBe(false);
    await expect(pool.run(job())).rejects.toThrow('unavailable');
  });

  it('retires itself when a message cannot be cloned', async () => {
    const worker = new FakeWorker();
    worker.throwOnPost = true;
    const pool = new CourtWorkerPool(() => worker);
    await expect(pool.run(job())).rejects.toThrow('DataCloneError');
    expect(pool.usable).toBe(false);
  });

  it('retires itself when the worker cannot start', async () => {
    const pool = new CourtWorkerPool(() => { throw new Error('blocked by CSP'); });
    await expect(pool.run(job())).rejects.toThrow('blocked by CSP');
    expect(pool.usable).toBe(false);
  });

  it('dispose terminates and rejects what is waiting; disposeIfIdle spares a busy one', async () => {
    const worker = new FakeWorker();
    const pool = new CourtWorkerPool(() => worker);
    const p = pool.run(job());
    pool.disposeIfIdle();
    expect(worker.terminated).toBe(false);
    pool.dispose();
    await expect(p).rejects.toThrow('disposed');
    expect(worker.terminated).toBe(true);
    expect(pool.inFlight).toBe(0);
  });
});

describe('partBackgroundPixels', () => {
  it('turns a pale background the stock color and leaves the figure alone', () => {
    const width = 16, height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data.set([250, 250, 250, 255], i * 4);
    }
    // a dark figure in the middle
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) data.set([10, 10, 10, 255], (y * width + x) * 4);
    partBackgroundPixels(data, width, height, [250, 250, 250], [20, 30, 40]);
    expect([...data.slice(0, 3)]).toEqual([20, 30, 40]);
    const mid = (8 * width + 8) * 4;
    expect([...data.slice(mid, mid + 3)]).toEqual([10, 10, 10]);
  });
});

describe('Slots', () => {
  it('hands out its places, then makes askers wait their turn', async () => {
    const slots = new Slots(2);
    const order: string[] = [];
    const a = await slots.take();
    const b = await slots.take();
    const c = slots.take().then((give) => { order.push('c'); return give; });
    const d = slots.take().then((give) => { order.push('d'); return give; });
    await Promise.resolve();
    expect(order).toEqual([]);
    a();
    const giveC = await c;
    expect(order).toEqual(['c']);
    b();
    const giveD = await d;
    expect(order).toEqual(['c', 'd']);
    giveC(); giveD();
    // everything is back: two more can go straight in
    await slots.take(); await slots.take();
  });
});
