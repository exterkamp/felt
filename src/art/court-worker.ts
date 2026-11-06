import { partBackgroundPixels } from '../core/court-pixels.js';

// The court painter's worker.
//
// Painting a court is a decode, a draw of the decoded SVG onto a page, a
// handful of fills, a crop, and - on a deck whose stock differs from its
// highlight - a flood fill over every pixel. All of it is main-thread work when
// done in the page, and it lands in the same frames as whatever the game is
// animating. This moves the draw, the fills, the crop and the flood off it.
//
// What cannot move is the decode: `new Image()` needs a document. So the page
// decodes the SVG, hands the browser's own rasteriser the resize
// (`createImageBitmap`, asynchronous and off-thread in every browser that has
// OffscreenCanvas), and transfers the bitmap here. What comes back is a bitmap
// of the finished crop, which the page blits onto a canvas and gives to
// Phaser - the texture is the same kind of texture as before.
//
// The worker has no file of its own. A package that is compiled with tsc and
// consumed by whatever bundler the game uses cannot count on that bundler
// knowing how to emit a worker out of node_modules, so the worker is built at
// run time from the source text of the one function that is its whole body,
// and started from a blob: URL. The price is that `courtWorkerBody` has to be
// self-contained, which court-pixels.ts is already for the same reason. Where
// a page forbids blob workers, starting one fails and painting falls back.

/** What the page asks of the worker for one court. */
export interface CourtJob {
  id: number;
  /** The decoded SVG, already at `pageWidth` x `pageHeight`. Transferred. */
  bitmap: ImageBitmap;
  pageWidth: number;
  pageHeight: number;
  /** Painted over the page in `wipeColor`, before the crop. */
  wipes: readonly { x: number; y: number; width: number; height: number }[];
  wipeColor: string;
  crop: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  /** Set when the background has to go from one color to another. */
  part: null | {
    from: readonly number[];
    to: readonly number[];
    seeds: readonly { x: number; y: number }[];
  };
}

export type CourtReply =
  | { id: number; bitmap: ImageBitmap }
  /** Pixels rather than a bitmap: see the worker body. */
  | { id: number; pixels: ImageData }
  | { id: number; error: string };

/** The whole of the worker. Self-contained: it is stringified. */
function courtWorkerBody(partBackgroundPixels: (
  data: Uint8ClampedArray, width: number, height: number,
  source: readonly number[], target: readonly number[],
  extra: readonly { x: number; y: number }[],
) => void): void {
  const scope = self as unknown as {
    onmessage: (event: MessageEvent<CourtJob>) => void;
    postMessage(message: unknown, transfer: Transferable[]): void;
  };
  scope.onmessage = (event) => {
    const job = event.data;
    try {
      const page = new OffscreenCanvas(job.pageWidth, job.pageHeight);
      const pen = page.getContext('2d');
      if (!pen) throw new Error('court worker: no 2d context');
      pen.drawImage(job.bitmap, 0, 0, job.pageWidth, job.pageHeight);
      job.bitmap.close();
      pen.fillStyle = job.wipeColor;
      for (const wipe of job.wipes) pen.fillRect(wipe.x, wipe.y, wipe.width, wipe.height);

      const out = new OffscreenCanvas(job.width, job.height);
      const outPen = out.getContext('2d');
      if (!outPen) throw new Error('court worker: no 2d context');
      const { crop } = job;
      outPen.drawImage(page, crop.x, crop.y, crop.width, crop.height,
        0, 0, job.width, job.height);
      // Pixels, read here, rather than a bitmap of the canvas: the bitmap may
      // live on the GPU, and the page draws courts into CPU canvases, so it
      // would be read back there - on the main thread, in the middle of
      // painting faces. Measured, that was 400 ms of a cold start.
      const image = outPen.getImageData(0, 0, job.width, job.height);
      if (job.part) {
        partBackgroundPixels(image.data, job.width, job.height,
          job.part.from, job.part.to, job.part.seeds);
      }
      scope.postMessage({ id: job.id, pixels: image }, [image.data.buffer]);
    } catch (error) {
      scope.postMessage({ id: job.id, error: String(error) }, []);
    }
  };
}

/** The worker's source text. Exported so a test can check it stands alone. */
export function courtWorkerSource(): string {
  return `(${courtWorkerBody.toString()})(${partBackgroundPixels.toString()});`;
}

/** What the browser needs to have for a worker to be worth trying. */
export function courtWorkerSupported(env: Record<string, unknown> = globalThis): boolean {
  return typeof env['Worker'] === 'function'
    && typeof env['OffscreenCanvas'] === 'function'
    && typeof env['createImageBitmap'] === 'function'
    && typeof env['Blob'] === 'function'
    && typeof (env['URL'] as { createObjectURL?: unknown } | undefined)?.createObjectURL
      === 'function';
}

/** The slice of Worker the pool uses, so a test can stand in for it. */
export interface CourtWorkerLike {
  onmessage: ((event: { data: CourtReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: CourtJob, transfer: Transferable[]): void;
  terminate(): void;
}

interface Pending {
  resolve: (painted: ImageBitmap | ImageData) => void;
  reject: (error: Error) => void;
}

/**
 * One worker, started on the first job and let go when it has been idle for a
 * while.
 *
 * One rather than several because the jobs are short and the page-side steps
 * (decode, resize) are what pace them; a pool would add start-up cost for no
 * extra frames. Once it fails, it stays failed: a worker that could not start,
 * or died, or could not take a message is not going to do better on the next
 * deck, and the main-thread path is always there.
 */
export class CourtWorkerPool {
  private worker: CourtWorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private broken = false;

  constructor(
    private readonly start: () => CourtWorkerLike,
    private readonly idleMs = 3000,
  ) {}

  /** False once a worker has failed. */
  get usable(): boolean { return !this.broken; }
  /** Whether a worker is currently alive. */
  get running(): boolean { return this.worker !== null; }
  /** Jobs sent and not yet answered. */
  get inFlight(): number { return this.pending.size; }

  /** Runs one job. Rejects if the worker fails, which also retires the pool. */
  run(job: Omit<CourtJob, 'id'>): Promise<ImageBitmap | ImageData> {
    if (this.broken) return Promise.reject(new Error('court worker: unavailable'));
    let worker: CourtWorkerLike;
    try {
      worker = this.worker ?? this.spawn();
    } catch (error) {
      this.fail(error);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.cancelIdle();
    const id = this.nextId++;
    return new Promise<ImageBitmap | ImageData>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...job, id }, [job.bitmap]);
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** Lets go of the worker now, failing anything still waiting on it. */
  dispose(): void {
    this.cancelIdle();
    this.worker?.terminate();
    this.worker = null;
    this.rejectAll(new Error('court worker: disposed'));
  }

  /** Lets go of the worker if nothing is waiting on it. */
  disposeIfIdle(): void {
    if (!this.pending.size) this.dispose();
  }

  private spawn(): CourtWorkerLike {
    const worker = this.start();
    worker.onmessage = (event) => {
      const reply = event.data;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if ('error' in reply) waiting.reject(new Error(reply.error));
      else waiting.resolve('pixels' in reply ? reply.pixels : reply.bitmap);
      if (!this.pending.size) this.armIdle();
    };
    worker.onerror = (event) => this.fail(event);
    worker.onmessageerror = (event) => this.fail(event);
    this.worker = worker;
    return worker;
  }

  private fail(reason: unknown): void {
    this.broken = true;
    this.cancelIdle();
    this.worker?.terminate();
    this.worker = null;
    const message = reason instanceof Error ? reason.message
      : (reason as { message?: string } | null)?.message ?? String(reason);
    this.rejectAll(new Error(`court worker: ${message}`));
  }

  private rejectAll(error: Error): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const one of waiting) one.reject(error);
  }

  private armIdle(): void {
    this.cancelIdle();
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.pending.size) return;
      this.worker?.terminate();
      this.worker = null;
    }, this.idleMs);
  }

  private cancelIdle(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = null;
  }
}

let shared: CourtWorkerPool | null = null;

/** The page's one pool, or null where workers are not an option. */
export function courtWorkerPool(): CourtWorkerPool | null {
  if (!courtWorkerSupported()) return null;
  shared ??= new CourtWorkerPool(() => {
    const url = URL.createObjectURL(
      new Blob([courtWorkerSource()], { type: 'text/javascript' }));
    const worker = new Worker(url) as unknown as CourtWorkerLike;
    // Kept until the worker is let go: revoking while it may still be
    // fetching its script is a race, and a few hundred bytes is cheap.
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => { terminate(); URL.revokeObjectURL(url); };
    return worker;
  });
  return shared.usable ? shared : null;
}

/** Lets go of the page's worker now. The next job starts a fresh one. */
export function disposeCourtWorker(): void {
  shared?.dispose();
}

/**
 * A counting semaphore: `take()` resolves with a function that gives the place
 * back, once there is one. Places go in the order they were asked for.
 */
export class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(places: number) { this.free = places; }

  take(): Promise<() => void> {
    const give = () => {
      const next = this.waiting.shift();
      if (next) next(); else this.free++;
    };
    if (this.free > 0) {
      this.free--;
      return Promise.resolve(give);
    }
    return new Promise((resolve) => this.waiting.push(() => resolve(give)));
  }
}

/** How many courts may be decoding on the page at once when a worker paints. */
export const COURT_DECODES_AT_ONCE = 2;

let slots: Slots | null = null;

/** The page's places for courts in flight. */
export function courtSlots(): Slots {
  slots ??= new Slots(COURT_DECODES_AT_ONCE);
  return slots;
}
