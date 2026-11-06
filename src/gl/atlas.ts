// Every picture on the table, on a few big sheets.
//
// A card face, a back, a pip, a label - each is rasterised once with Canvas
// 2D, at the density it will be shown at, into a region of one of these
// pages. The pages are layers of a single texture array, so the renderer
// binds one texture for the whole table and every card can be drawn in one
// instanced call no matter which deck, which size or which side it shows.
//
// Regions are cached by a key that says what is in them - `face-press-60-...
// -hearts-Q` - and counted, so a hundred cards of one deck share fifty-two
// faces and one back, and a deck nobody is looking at any more gives its room
// back. A freed region is kept on a free list by size and reused whole: card
// faces come in a handful of exact sizes, so the same slot is wanted again.

/** One picture's place in the atlas. Coordinates are texture pixels. */
export interface Region {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The same rectangle as 0-1 texture coordinates. */
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  /** The cache key it was made under, if any. */
  key?: string;
  refs: number;
  /**
   * The last frame anything on the board showed it, stamped by the card that
   * did. What lets the engine repaint the pictures on screen at once and the
   * rest when it has a moment.
   */
  shownAt?: number;
  /**
   * How to paint it again. The pixels live on the GPU and nowhere else, so
   * when the GPU loses them - a lost context, a texture that could not be
   * grown - this is how every picture comes back.
   */
  replay?: () => void;
}

/** Room left round every region, so filtering never reads a neighbour. */
const GUTTER = 2;

interface Shelf { y: number; height: number; x: number }

/**
 * A page is packing bookkeeping only. Its pixels live on the GPU and nowhere
 * else: a picture is painted into a small scratch canvas the size of its
 * region and that is what is uploaded. The first version kept a 2048 canvas
 * per page and uploaded a dirty rectangle of it, and on a real browser a
 * sub-rectangle of an accelerated canvas is a readback of the whole thing -
 * 140ms a frame whenever a new face was painted.
 */
interface Page {
  shelves: Shelf[];
  bottom: number;
}

/** Where painted pixels go: the renderer, which uploads them at once. */
export type AtlasSink = (page: number, x: number, y: number, width: number, height: number,
  pixels: Uint8Array) => void;

type Pen = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type Painter = (pen: Pen, width: number, height: number) => void;

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}

export class Atlas {
  readonly pages: Page[] = [];
  private readonly cache = new Map<string, Region>();
  private readonly free = new Map<string, Region[]>();
  /** Bumped whenever a page is added, so the renderer knows to grow. */
  generation = 0;
  /** Called when anything is drawn, so the board can schedule a frame. */
  onChange?: () => void;
  /**
   * Asked to let go of pictures before the atlas evicts or grows - the card
   * sheets drop the decks nobody is using. Answers whether it freed anything.
   */
  onPressure?: () => boolean;
  /** Receives every painted picture. Without one (in node) paints go nowhere. */
  sink?: AtlasSink;
  private scratch?: HTMLCanvasElement | OffscreenCanvas;
  private scratchPen?: Pen;
  /** Paints so far, for anyone measuring. */
  paints = 0;

  constructor(readonly size = 2048, readonly maxPages = 16) {}

  /** The cached region for this key, counted, or undefined. */
  acquire(key: string): Region | undefined {
    const region = this.cache.get(key);
    if (region) region.refs++;
    return region;
  }

  /**
   * The region for this key, made and painted if it is not there yet.
   *
   * `width` and `height` are texture pixels. The painter is handed a pen
   * already translated to the region and clipped to it.
   */
  obtain(key: string, width: number, height: number, paint: Painter): Region {
    const hit = this.acquire(key);
    if (hit) return hit;
    const region = this.allocate(width, height);
    region.key = key;
    region.refs = 1;
    this.cache.set(key, region);
    this.paint(region, paint);
    return region;
  }

  /**
   * A region for this key, counted, made but not painted - for a caller that
   * paints it itself straight after. `obtain` with an empty painter paints
   * and uploads a blank first, which doubled the cost of every new face.
   */
  reserve(key: string, width: number, height: number): Region {
    const hit = this.acquire(key);
    if (hit) return hit;
    const region = this.allocate(width, height);
    region.key = key;
    region.refs = 1;
    this.cache.set(key, region);
    return region;
  }

  /** Whether a key is in the atlas, without counting it. */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** The region for a key, without counting it. */
  peek(key: string): Region | undefined {
    return this.cache.get(key);
  }

  /**
   * Paints every picture in the atlas again, from how each was last painted.
   * After a lost context the GPU's copy is gone, and this is the only copy.
   */
  repaintAll(): void {
    for (const region of [...this.cache.values()]) region.replay?.();
  }

  /** Lets go of one use. A region nobody uses may be reused for another. */
  release(region: Region | undefined): void {
    if (!region) return;
    region.refs = Math.max(0, region.refs - 1);
  }

  /**
   * Paints into a region, replacing what was there, and hands the pixels -
   * the region and its transparent gutter, nothing more - to the sink.
   */
  paint(region: Region, paint: Painter, replay?: () => void): void {
    this.paints++;
    region.replay = replay ?? (() => this.paint(region, paint));
    if (!this.sink) {
      this.onChange?.();
      return;
    }
    const w = region.width + 2 * GUTTER;
    const h = region.height + 2 * GUTTER;
    if (!this.scratch) {
      this.scratch = makeCanvas(w, h);
      // CPU-backed on purpose: it is painted and immediately read for upload,
      // which on a GPU canvas is a readback every time.
      this.scratchPen = this.scratch.getContext('2d', { willReadFrequently: true }) as Pen;
    }
    const canvas = this.scratch;
    const pen = this.scratchPen!;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    } else {
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.clearRect(0, 0, w, h);
    }
    pen.save();
    pen.beginPath();
    pen.rect(GUTTER, GUTTER, region.width, region.height);
    pen.clip();
    pen.translate(GUTTER, GUTTER);
    paint(pen, region.width, region.height);
    pen.restore();
    // Read back as bytes and premultiplied here, rather than handing the
    // canvas to texSubImage: a canvas source goes through the browser's
    // image-conversion path, which measured at 3ms for one card face against
    // a fraction of that for the bytes.
    const data = pen.getImageData(0, 0, w, h).data;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < bytes.length; i += 4) {
      const a = bytes[i + 3];
      if (a === 255) continue;
      if (a === 0) { bytes[i] = 0; bytes[i + 1] = 0; bytes[i + 2] = 0; continue; }
      const k = a / 255;
      bytes[i] = bytes[i] * k + 0.5;
      bytes[i + 1] = bytes[i + 1] * k + 0.5;
      bytes[i + 2] = bytes[i + 2] * k + 0.5;
    }
    this.sink(region.page, region.x - GUTTER, region.y - GUTTER, w, h, bytes);
    this.onChange?.();
  }

  private allocate(width: number, height: number): Region {
    width = Math.max(1, Math.ceil(width));
    height = Math.max(1, Math.ceil(height));
    if (width + 2 * GUTTER > this.size || height + 2 * GUTTER > this.size) {
      throw new Error(`felt atlas: ${width}x${height} will not fit a ${this.size} page`);
    }
    const reused = this.reuse(width, height);
    if (reused) return reused;
    for (let i = 0; i < this.pages.length; i++) {
      const placed = this.place(i, width, height);
      if (placed) return placed;
    }
    // Before growing, give back what nobody is looking at: a deck nobody is
    // using any more, a card size the slider has moved past. A new page is a
    // reallocation of the whole texture on the GPU, and is the last resort.
    this.onPressure?.();
    this.evictUnused();
    const recycled = this.reuse(width, height, true);
    if (recycled) return recycled;
    // A page with nothing left on it that anyone uses is empty, whatever its
    // free list says: start it again from the top. Without this a card size
    // that only grows never fits the slots its smaller sizes left, and every
    // step of a size slider took fresh pages - sixteen layers of 2048 square,
    // a quarter of a gigabyte of texture, which a real GPU may not give.
    for (const i of this.reclaimPages()) {
      const placed = this.place(i, width, height);
      if (placed) return placed;
    }
    if (this.pages.length < this.maxPages) {
      this.addPage();
      const placed = this.place(this.pages.length - 1, width, height);
      if (placed) return placed;
    }
    // Full. Give back everything nobody is using and try the free list again.
    this.evictUnused();
    const second = this.reuse(width, height, true);
    if (second) return second;
    throw new Error('felt atlas: out of room - too many distinct pictures on one table');
  }

  private reuse(width: number, height: number, anyFit = false): Region | undefined {
    const exact = this.free.get(`${width}x${height}`);
    if (exact?.length) return exact.pop();
    if (!anyFit) return undefined;
    // The smallest free slot it fits in.
    let best: Region | undefined;
    let bestKey = '';
    for (const [key, list] of this.free) {
      for (const region of list) {
        if (region.width >= width && region.height >= height
          && (!best || region.width * region.height < best.width * best.height)) {
          best = region;
          bestKey = key;
        }
      }
    }
    if (!best) return undefined;
    const list = this.free.get(bestKey)!;
    list.splice(list.indexOf(best), 1);
    return this.region(best.page, best.x, best.y, width, height);
  }

  private evictUnused(): void {
    for (const [key, region] of this.cache) {
      if (region.refs > 0) continue;
      this.cache.delete(key);
      region.key = undefined;
      region.replay = undefined;
      const slot = `${region.width}x${region.height}`;
      const list = this.free.get(slot) ?? [];
      list.push(region);
      this.free.set(slot, list);
    }
  }

  /** Empties every page no live picture is on. Answers which. */
  private reclaimPages(): number[] {
    const live = new Set<number>();
    for (const region of this.cache.values()) live.add(region.page);
    const emptied: number[] = [];
    this.pages.forEach((page, i) => {
      if (live.has(i) || !page.shelves.length) return;
      page.shelves = [];
      page.bottom = 0;
      emptied.push(i);
    });
    if (emptied.length) {
      for (const [slot, list] of this.free) this.free.set(slot, list.filter((r) => !emptied.includes(r.page)));
    }
    // An empty page that was never written is as good as a reclaimed one.
    this.pages.forEach((page, i) => { if (!page.shelves.length && !emptied.includes(i)) emptied.push(i); });
    return emptied;
  }

  private addPage(): void {
    this.pages.push({ shelves: [], bottom: 0 });
    this.generation++;
  }

  /** Shelf packing: the first shelf tall enough with room, or a new one. */
  private place(index: number, width: number, height: number): Region | undefined {
    const page = this.pages[index];
    const w = width + 2 * GUTTER;
    const h = height + 2 * GUTTER;
    for (const shelf of page.shelves) {
      // A shelf much taller than the item wastes the difference on every row.
      if (h <= shelf.height && h >= shelf.height * 0.6 && shelf.x + w <= this.size) {
        const region = this.region(index, shelf.x + GUTTER, shelf.y + GUTTER, width, height);
        shelf.x += w;
        return region;
      }
    }
    if (page.bottom + h > this.size) return undefined;
    const shelf = { y: page.bottom, height: h, x: w };
    page.shelves.push(shelf);
    page.bottom += h;
    return this.region(index, GUTTER, shelf.y + GUTTER, width, height);
  }

  private region(page: number, x: number, y: number, width: number, height: number): Region {
    return {
      page, x, y, width, height,
      u0: x / this.size, v0: y / this.size,
      u1: (x + width) / this.size, v1: (y + height) / this.size,
      refs: 0,
    };
  }
}
