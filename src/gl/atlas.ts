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
}

/** Room left round every region, so filtering never reads a neighbour. */
const GUTTER = 2;

interface Shelf { y: number; height: number; x: number }

interface Page {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  pen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  shelves: Shelf[];
  bottom: number;
  dirty?: { x0: number; y0: number; x1: number; y1: number };
}

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

  /** Whether a key is in the atlas, without counting it. */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** The region for a key, without counting it. */
  peek(key: string): Region | undefined {
    return this.cache.get(key);
  }

  /** Lets go of one use. A region nobody uses may be reused for another. */
  release(region: Region | undefined): void {
    if (!region) return;
    region.refs = Math.max(0, region.refs - 1);
  }

  /** Paints into a region, replacing what was there. */
  paint(region: Region, paint: Painter): void {
    const page = this.pages[region.page];
    const { pen } = page;
    const x = region.x - GUTTER;
    const y = region.y - GUTTER;
    const w = region.width + 2 * GUTTER;
    const h = region.height + 2 * GUTTER;
    pen.save();
    pen.clearRect(x, y, w, h);
    pen.beginPath();
    pen.rect(region.x, region.y, region.width, region.height);
    pen.clip();
    pen.translate(region.x, region.y);
    paint(pen, region.width, region.height);
    pen.restore();
    this.markDirty(page, x, y, w, h);
    this.onChange?.();
  }

  /** Takes the dirty rectangle of a page, clearing it. */
  takeDirty(index: number): Page['dirty'] {
    const page = this.pages[index];
    const dirty = page.dirty;
    page.dirty = undefined;
    return dirty;
  }

  private markDirty(page: Page, x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.size, x + w);
    const y1 = Math.min(this.size, y + h);
    const d = page.dirty;
    page.dirty = d
      ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) }
      : { x0, y0, x1, y1 };
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
      const slot = `${region.width}x${region.height}`;
      const list = this.free.get(slot) ?? [];
      list.push(region);
      this.free.set(slot, list);
    }
  }

  private addPage(): void {
    const canvas = makeCanvas(this.size, this.size);
    const pen = canvas.getContext('2d', { willReadFrequently: false }) as Pen | null;
    if (!pen) throw new Error('felt atlas: no 2d context');
    this.pages.push({ canvas, pen, shelves: [], bottom: 0 });
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
