// Art kept between visits.
//
// The court portraits are the slow part of starting up - a second or more of
// recolouring and rasterising SVG on every page load, measured, for twelve
// pictures that come out the same every time. So once rendered, each is kept
// in IndexedDB as a PNG, and the next load draws it from there instead.
//
// IndexedDB rather than Cache Storage, because Cache Storage only exists in a
// secure context, and a phone trying the demo over the LAN at http://192.168…
// is not one. Everything here is best-effort: no IndexedDB, a full disk, a
// private window that throws - the court is rendered as it always was.

/**
 * Bumped whenever what a court looks like for the same key changes - the
 * renderer, the recolouring, the crop - so old pictures are never shown.
 */
export const PERSISTED_ART_VERSION = 1;
const DB = 'felt-art';
const STORE = 'pictures';
/** How many pictures are kept; the least recently written go first. */
const KEEP = 160;

type Source = CanvasImageSource & { width: number; height: number };

export class PersistedArt {
  /** Pictures drawn from the store instead of being made. */
  hits = 0;
  /** Asked for and not there. */
  misses = 0;
  /** Pictures written. */
  writes = 0;
  private db?: Promise<IDBDatabase | undefined>;

  constructor(readonly enabled = typeof indexedDB !== 'undefined') {}

  private open(): Promise<IDBDatabase | undefined> {
    if (!this.enabled) return Promise.resolve(undefined);
    this.db ??= new Promise<IDBDatabase | undefined>((resolve) => {
      try {
        const request = indexedDB.open(DB, PERSISTED_ART_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          // A new version is a clean slate: what the old one drew is stale.
          for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
          db.createObjectStore(STORE).createIndex('at', 'at');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    return this.db;
  }

  /** The picture kept under a key, as a CPU canvas, or undefined. */
  async get(key: string): Promise<HTMLCanvasElement | undefined> {
    const db = await this.open();
    if (!db) return undefined;
    const record = await new Promise<{ blob: Blob } | undefined>((resolve) => {
      try {
        const request = db.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result as { blob: Blob } | undefined);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    if (!record) {
      this.misses++;
      return undefined;
    }
    try {
      const bitmap = await createImageBitmap(record.blob);
      // Into a CPU canvas: everything faces are painted from is, so painting
      // never reads back from the GPU.
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(bitmap, 0, 0);
      bitmap.close();
      this.hits++;
      return canvas;
    } catch {
      this.misses++;
      return undefined;
    }
  }

  /** Keeps a picture for next time. Encoded off the critical path; failures are ignored. */
  async put(key: string, source: Source): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const blob = await encode(source);
    if (!blob) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ blob, at: Date.now() }, key);
        tx.oncomplete = () => { this.writes++; resolve(); };
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
    await this.trim(db);
  }

  /** Forgets everything kept. */
  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async trim(db: IDBDatabase): Promise<void> {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const count = store.count();
        count.onsuccess = () => {
          let extra = count.result - KEEP;
          if (extra <= 0) return;
          const cursor = store.index('at').openCursor();
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at || extra-- <= 0) return;
            at.delete();
            at.continue();
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/**
 * PNG encoding is slow - 38 ms a court on the main thread, measured, which
 * was a third of a cold start - so it is done in a worker on a bitmap copy.
 * The main thread pays for the copy only. Without workers or OffscreenCanvas,
 * it waits for an idle moment and encodes there.
 */
let encoder: { worker: Worker; next: number; waiting: Map<number, (blob: Blob | undefined) => void> } | undefined;

const ENCODER_SOURCE = `
self.onmessage = async (event) => {
  const { id, bitmap } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, blob: null });
  }
};`;

function encoderWorker(): typeof encoder {
  if (encoder) return encoder;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined'
    || typeof createImageBitmap !== 'function') return undefined;
  try {
    const url = URL.createObjectURL(new Blob([ENCODER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const waiting = new Map<number, (blob: Blob | undefined) => void>();
    worker.onmessage = (event: MessageEvent<{ id: number; blob: Blob | null }>) => {
      waiting.get(event.data.id)?.(event.data.blob ?? undefined);
      waiting.delete(event.data.id);
    };
    worker.onerror = () => {
      for (const resolve of waiting.values()) resolve(undefined);
      waiting.clear();
    };
    encoder = { worker, next: 1, waiting };
    return encoder;
  } catch {
    return undefined;
  }
}

async function encode(source: Source): Promise<Blob | undefined> {
  const pool = encoderWorker();
  if (pool) {
    try {
      const bitmap = await createImageBitmap(source);
      const id = pool.next++;
      return await new Promise((resolve) => {
        pool.waiting.set(id, resolve);
        pool.worker.postMessage({ id, bitmap }, [bitmap]);
      });
    } catch {
      // Fall through to the main thread.
    }
  }
  const canvas = source as HTMLCanvasElement;
  if (typeof canvas.toBlob !== 'function') return undefined;
  await idle();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/png'));
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 200);
  });
}
