import type { Painter, Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
import { Engine, serviceOf } from '../runtime/engine.js';
import { disposeCourtWorker } from './court-worker.js';
import {
  DEFAULT_DECK_THEME, DeckTheme, cardAssetBase, colorCss, deckThemePath, fontsReady,
} from '../core/index.js';

// The loaded art a card is painted from, and the dependencies between them.
//
// A face is painted out of other pictures - the suit glyph, a court portrait,
// a deck's back - and any of those may not have arrived when the card is made.
// Phaser had a preload phase to make that someone else's problem, and then
// needed a texture-added listener per sprite for the courts, which arrive
// after it. Here there is one rule for all of them: a region is painted with
// whatever is there, notes what it was missing, and is painted again in place
// the moment that arrives. Every card sharing the region updates at once,
// because they are all looking at the same pixels.

type Source = CanvasImageSource & { width: number; height: number };

/**
 * Every canvas the art is kept in is CPU-backed, the same as the scratch
 * canvas faces are painted in. Drawing a GPU canvas into a CPU one is a
 * readback per draw - 5ms for one 40-pixel pip, measured - and a face is a
 * dozen draws. Keeping both ends on the same side makes it a plain copy.
 */
export const CPU: CanvasRenderingContext2DSettings = { willReadFrequently: true };

let measure: CanvasRenderingContext2D | undefined;

/** Milliseconds a frame for repainting pictures nobody is looking at. */
const OFFSCREEN_BUDGET_MS = 4;

/** Which file in assets/cards/suits each suit is drawn from. */
export const STANDARD_SUIT_ART: Readonly<Record<string, string>> = {
  spades: 'spade',
  hearts: 'heart',
  diamonds: 'diamond',
  clubs: 'club',
};

export interface CardArtOptions {
  themes?: readonly DeckTheme[];
  /** suit -> file name in assets/cards/suits, for a game with its own suits. */
  suitArt?: Readonly<Record<string, string>>;
}

/** What a painter reaches for: an asset by key, or a note that it wanted one. */
export interface ArtLookup {
  get(key: string): Source | undefined;
}

/**
 * A picture that will need painting again. `key` is what the region held when
 * it was asked for: a region given back and reused for another picture has
 * another key, and the old painter must not land on the new picture.
 */
interface Dependent {
  region: Region; key: string | undefined; paint: (art: ArtLookup) => Painter;
  /** What its last paint asked for and did not get. */
  missing: string[];
}

/** Where one piece of art is: arriving, here, or never coming. */
export type ArtStatus = 'pending' | 'loaded' | 'failed';

/** What kind of art a key is, for anyone reporting on loading. */
export type ArtKind = 'font' | 'suit' | 'back' | 'court' | 'other';

export function artKind(key: string): ArtKind {
  if (key === FONT_ASSET) return 'font';
  if (key.startsWith('suit:')) return 'suit';
  if (key.startsWith('back:')) return 'back';
  if (key.startsWith('pce-court-')) return 'court';
  return 'other';
}

/** Stands for the faces' fonts having loaded. Nothing is drawn from it. */
export const FONT_ASSET = 'font:faces';

export const suitAssetKey = (suit: string) => `suit:${suit}`;
export const backAssetKey = (theme: DeckTheme) => `back:${theme}`;

/** What the store tells each board's art about. */
interface StoreListener {
  provided(key: string): void;
  failed(key: string): void;
}

/** The court renderer's caches, kept with the rest of the page's art. */
export interface CourtCaches {
  /** Fetched SVG text, by path. */
  sources: Map<string, Promise<string>>;
  /** Rasterised court pages, newest last. */
  pages: Map<string, Promise<ImageBitmap | HTMLImageElement>>;
  /** Portraits being rendered right now, by key. */
  inFlight: Map<string, Promise<string>>;
}

/**
 * The page's art: every CPU-side picture cards are painted from, and where
 * each one is - arriving, here, or never coming.
 *
 * It belongs to the engine, not a board, because none of it touches a GPU:
 * glyphs, backs, portraits, their halvings and the rastered rank text are
 * pixels in CPU canvases, as good for the next board as for this one. A
 * board made for the next screen of a game, or a second board on the page,
 * paints its first deck from art already here.
 */
export class ArtStore {
  private readonly assets = new Map<string, Source>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly inked = new Map<string, Source>();
  /** Art something has started getting, and has not got yet. */
  private readonly expected = new Set<string>();
  /** Art that was asked for and will not come: a 404, a court that threw. */
  private readonly failed = new Set<string>();
  /** Every key ever expected, in the order asked, for progress reports. */
  private readonly known = new Set<string>();
  private readonly listeners = new Set<StoreListener>();
  readonly courts: CourtCaches = { sources: new Map(), pages: new Map(), inFlight: new Map() };
  /** Goes up whenever where any art is changes. */
  version = 0;

  constructor() {
    if (typeof document === 'undefined') return;
    this.expect(FONT_ASSET, fontsReady().then(() => {
      const token = document.createElement('canvas');
      token.width = token.height = 1;
      this.provide(FONT_ASSET, token);
    }));
  }

  static of(owner: Engine): ArtStore {
    return serviceOf(owner, 'art-store', () => new ArtStore());
  }

  listen(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get(key: string): Source | undefined {
    return this.assets.get(key);
  }

  has(key: string): boolean {
    return this.assets.has(key);
  }

  /** Whether a piece of art is on its way and has not arrived. */
  pending(key: string): boolean {
    return this.expected.has(key);
  }

  /**
   * Notes that a piece of art is on its way, by whatever means: a load, a
   * court render. Until it lands or the job ends without it, anything painted
   * without it is not finished. A job that ends without providing it fails it.
   */
  expect(key: string, job: Promise<unknown>): void {
    if (this.assets.has(key)) return;
    this.known.add(key);
    this.failed.delete(key);
    this.expected.add(key);
    this.version++;
    const settle = () => { if (!this.assets.has(key)) this.fail(key); };
    void job.then(settle, settle);
  }

  /** Gives up on a piece of art: cards waiting for it are finished without it. */
  fail(key: string): void {
    if (this.assets.has(key)) return;
    this.expected.delete(key);
    this.failed.add(key);
    this.version++;
    for (const listener of [...this.listeners]) listener.failed(key);
  }

  /** Where a piece of art is, or undefined if nothing ever asked for it. */
  status(key: string): ArtStatus | undefined {
    if (this.assets.has(key)) return 'loaded';
    if (this.failed.has(key)) return 'failed';
    if (this.expected.has(key)) return 'pending';
    return undefined;
  }

  /** Every piece of art asked for so far, and where it is. */
  report(): { key: string; kind: ArtKind; status: ArtStatus }[] {
    return [...this.known].map((key) => ({ key, kind: artKind(key), status: this.status(key)! }));
  }

  /** Puts an asset in, and tells every board's art that was waiting for it. */
  provide(key: string, source: Source): void {
    this.assets.set(key, source);
    this.known.add(key);
    this.expected.delete(key);
    this.failed.delete(key);
    this.version++;
    for (const listener of [...this.listeners]) listener.provided(key);
  }

  /** Loads an image by URL under a key, once. */
  load(key: string, url: string, size?: { width: number; height: number }): Promise<void> {
    if (this.assets.has(key)) return Promise.resolve();
    let pending = this.loading.get(key);
    if (pending) return pending;
    pending = (async () => {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      try {
        await image.decode();
      } catch {
        // A missing picture is a card drawn without it, not a game that stops.
        console.warn(`felt: could not load ${url}`);
        return;
      }
      // Rasterised into a CPU canvas once, at a fixed size for SVGs - they are
      // drawn down to every size a card comes in, and a pip loaded at pip
      // size blurs the moment somebody asks for a big card.
      const width = size?.width ?? image.naturalWidth;
      const height = size?.height ?? image.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d', CPU)!.drawImage(image, 0, 0, width, height);
      this.provide(key, canvas);
    })();
    this.loading.set(key, pending);
    this.expect(key, pending);
    return pending;
  }

  private readonly mips = new WeakMap<object, Source[]>();

  mipFor(source: Source, width: number, height: number): Source {
    let chain = this.mips.get(source);
    if (!chain) this.mips.set(source, (chain = [source]));
    // Only as deep as this draw needs: a portrait shown at card size wants
    // one halving, not six.
    let level = chain[chain.length - 1];
    while (level.width / 2 >= width && level.height / 2 >= height && level.width >= 16) {
      const half = document.createElement('canvas');
      half.width = Math.round(level.width / 2);
      half.height = Math.round(level.height / 2);
      const pen = half.getContext('2d', CPU)!;
      pen.imageSmoothingQuality = 'high';
      pen.drawImage(level, 0, 0, half.width, half.height);
      chain.push(half);
      level = half;
    }
    let best = chain[0];
    for (const candidate of chain) {
      if (candidate.width >= width && candidate.height >= height) best = candidate;
    }
    return best;
  }

  /**
   * Draws a source at `x, y, w, h` in the pen's own units, from the smallest
   * of its halvings that still covers the device pixels that box needs.
   *
   * A face draws a 200-pixel glyph down to a 14-pixel pip ten times over, and
   * a 480-pixel portrait down to the card; resampled straight from the
   * source, each is bilinear samples skipping most of it - slow and soft.
   * From the right halving it is never more than a 2x reduction. The
   * halvings are shared by every size, so a new card size costs nothing -
   * an exact-size copy per size, tried first, made the sizes page slower.
   */
  blit(pen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: Source,
    x: number, y: number, w: number, h: number): void {
    const t = pen.getTransform();
    const scale = Math.hypot(t.a, t.b);
    pen.drawImage(this.mipFor(source, w * scale, h * scale), x, y, w, h);
  }

  private readonly texts = new Map<string, { image: Source; pad: number; width: number }>();

  /**
   * Fills a line of text at `x` (left edge) and `y` (middle), from a cached
   * raster of it.
   *
   * `fillText` rasterises its glyphs on every call - 0.6ms for a card's rank,
   * and 3.7ms at a size it has not drawn before, measured - and a deck draws
   * the same thirteen ranks in four inks over and over. Rastered once per
   * text, font, ink and density, every face after copies it.
   */
  text(pen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string,
    font: string, size: number, color: string, x: number, y: number): number {
    const t = pen.getTransform();
    const scale = Math.hypot(t.a, t.b);
    const key = `${text}|${font}|${color}|${scale.toFixed(3)}`;
    let hit = this.texts.get(key);
    if (!hit) {
      let measured = 0;
      measure ??= document.createElement('canvas').getContext('2d', CPU)!;
      measure.font = font;
      const pad = Math.ceil(size * 0.3);
      measured = measure.measureText(text).width;
      const width = measured + pad * 2;
      const height = size * 1.6;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      const out = canvas.getContext('2d', CPU)!;
      out.scale(scale, scale);
      out.font = font;
      out.fillStyle = color;
      out.textBaseline = 'middle';
      out.textAlign = 'left';
      out.fillText(text, pad, height / 2);
      hit = { image: canvas, pad, width: measured };
      this.texts.set(key, hit);
      if (this.texts.size > 600) this.texts.delete(this.texts.keys().next().value!);
    }
    const { image, pad } = hit;
    pen.drawImage(image, x - pad, y - (image.height / scale) / 2, image.width / scale, image.height / scale);
    return hit.width;
  }

  /**
   * A suit glyph in one color, as a canvas.
   *
   * The SVGs are white on transparency so one file serves red, black and
   * whatever a game's own suit needs; the color is composited in once per
   * suit and ink.
   */
  inkedSuit(suit: string, ink: number, lookup: ArtLookup): Source | undefined {
    const source = lookup.get(suitAssetKey(suit));
    if (!source) return undefined;
    const key = `${suit}-${ink.toString(16)}`;
    let canvas = this.inked.get(key);
    if (canvas && canvas.width === source.width) return canvas;
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const pen = out.getContext('2d', CPU)!;
    pen.drawImage(source, 0, 0);
    // Keep the shape just drawn, replace everything it is made of.
    pen.globalCompositeOperation = 'source-in';
    pen.fillStyle = colorCss(ink);
    pen.fillRect(0, 0, out.width, out.height);
    canvas = out;
    this.inked.set(key, canvas);
    return canvas;
  }

  /** Lets the court worker go with the engine. The pictures go with the store. */
  dispose(): void {
    disposeCourtWorker();
    this.listeners.clear();
  }
}

/**
 * One board's side of the art: which of its atlas regions were painted from
 * what, and which owe a repaint now that something they were missing has
 * arrived. The pictures themselves are the engine's (`ArtStore`).
 */
export class CardArt {
  private readonly waiting = new Map<string, Set<Dependent>>();
  /** Regions owed a repaint, done once each just before the next frame. */
  private readonly owed = new Set<Dependent>();
  private readonly painted = new WeakMap<Region, Dependent>();
  private own = 0;
  readonly store: ArtStore;

  constructor(readonly board: Board) {
    this.store = ArtStore.of(board.engine);
    // Batched: a face waiting on the font and on its court, both of which
    // land in the same second, is painted again once rather than twice - and
    // twelve courts arriving in twelve tasks cost twelve repaints per face
    // waiting on each, not one per frame per arrival.
    board.beforeRender(() => this.flush());
    const unlisten = this.store.listen({
      provided: (key) => {
        const waiting = this.waiting.get(key);
        if (!waiting) return;
        this.waiting.delete(key);
        for (const dependent of waiting) this.owed.add(dependent);
        this.board.touch();
      },
      failed: () => this.board.touch(),
    });
    board.on('destroy', unlisten);
  }

  static of(board: Board): CardArt {
    return serviceOf(board, 'card-art', () => new CardArt(board));
  }

  /** Goes up whenever anything that `finished` answers from changes. */
  get version(): number {
    return this.store.version + this.own;
  }

  get(key: string): Source | undefined { return this.store.get(key); }
  has(key: string): boolean { return this.store.has(key); }
  expect(key: string, job: Promise<unknown>): void { this.store.expect(key, job); }
  fail(key: string): void { this.store.fail(key); }
  status(key: string): ArtStatus | undefined { return this.store.status(key); }
  report(): { key: string; kind: ArtKind; status: ArtStatus }[] { return this.store.report(); }
  provide(key: string, source: Source): void { this.store.provide(key, source); }
  load(key: string, url: string, size?: { width: number; height: number }): Promise<void> {
    return this.store.load(key, url, size);
  }
  blit(pen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, source: Source,
    x: number, y: number, w: number, h: number): void {
    this.store.blit(pen, source, x, y, w, h);
  }
  text(pen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string,
    font: string, size: number, color: string, x: number, y: number): number {
    return this.store.text(pen, text, font, size, color, x, y);
  }
  inkedSuit(suit: string, ink: number, lookup: ArtLookup): Source | undefined {
    return this.store.inkedSuit(suit, ink, lookup);
  }

  /**
   * Whether a region is finished: painted, with nothing it asked for still
   * on its way. Art that failed, or that nobody is getting, does not hold it.
   * A region this never painted (a graphic, a label) is finished.
   */
  finished(region: Region): boolean {
    const dependent = this.painted.get(region);
    if (!dependent) return true;
    if (dependent.key !== region.key) return true;
    if (this.owed.has(dependent)) return false;
    for (const key of dependent.missing) if (this.store.pending(key)) return false;
    return true;
  }

  /**
   * Repaints what is owed one: everything on screen now, and of the rest as
   * much as fits in a few milliseconds, the remainder next frame.
   *
   * Without the split, a deck's twelve portraits landing repainted every
   * warmed cell waiting on them in one frame - most of them cards nobody was
   * looking at - and changing deck cost a frame of nearly a second.
   */
  flush(): void {
    if (!this.owed.size) return;
    const recent = this.board.frames - 2;
    const deadline = performance.now() + OFFSCREEN_BUDGET_MS;
    for (const dependent of [...this.owed]) {
      const region = dependent.region;
      // A region given back to the atlas and reused since is not ours to paint.
      if (region.key !== dependent.key) {
        this.owed.delete(dependent);
        this.own++;
        continue;
      }
      const onScreen = (region.shownAt ?? -Infinity) >= recent;
      if (!onScreen && performance.now() > deadline) continue;
      this.owed.delete(dependent);
      this.repaint(dependent);
    }
    // Something left: come back next frame for it.
    if (this.owed.size) this.board.touch();
  }

  /**
   * Paints a region with a painter that looks things up, and registers it to
   * be painted again for anything it asked for and did not get.
   */
  paintTracked(region: Region, paint: (art: ArtLookup) => Painter): void {
    const dependent: Dependent = { region, key: region.key, paint, missing: [] };
    this.painted.set(region, dependent);
    this.repaint(dependent);
  }

  private repaint(dependent: Dependent): void {
    if (dependent.region.key !== dependent.key) return;
    const missing: string[] = [];
    const lookup: ArtLookup = {
      get: (key) => {
        const found = this.store.get(key);
        if (!found) missing.push(key);
        return found;
      },
    };
    this.board.atlas.paint(dependent.region, dependent.paint(lookup), () => this.repaint(dependent));
    dependent.missing = missing;
    this.own++;
    for (const key of missing) {
      // Arrived between being asked for and now: owed at once, not waited for.
      if (this.store.has(key)) {
        this.owed.add(dependent);
        continue;
      }
      let set = this.waiting.get(key);
      if (!set) this.waiting.set(key, (set = new Set()));
      set.add(dependent);
    }
  }
}

/**
 * Loads the artwork cards are painted from: the suit glyphs, the backs of the
 * named themes, and the faces' fonts.
 *
 * Not required before making a card - a card made early is painted with what
 * is there and repainted as the rest arrives - but awaiting it means the first
 * frame is already the finished one.
 */
export async function loadCardArt(board: Board, options: CardArtOptions = {}): Promise<void> {
  const art = CardArt.of(board);
  const themes = options.themes ?? [DEFAULT_DECK_THEME];
  const suitArt = options.suitArt ?? STANDARD_SUIT_ART;
  await Promise.all([
    fontsReady(),
    ...Object.entries(suitArt).map(([suit, file]) =>
      art.load(suitAssetKey(suit), `${cardAssetBase()}/suits/${file}.svg`, { width: 200, height: 200 })),
    ...themes.map((theme) => art.load(backAssetKey(theme), deckThemePath(theme, 'back.webp'))),
  ]);
}

/** The name phaser-card-engine gave it. Returns the same promise. */
export const preloadCardArt = loadCardArt;

/** Starts loading a theme's back and a suit's glyph if nothing has yet. */
export function ensureArt(board: Board, theme: DeckTheme, suit: string,
  suitArt: Readonly<Record<string, string>> = STANDARD_SUIT_ART): void {
  const art = CardArt.of(board);
  if (!art.has(backAssetKey(theme))) void art.load(backAssetKey(theme), deckThemePath(theme, 'back.webp'));
  const file = suitArt[suit];
  if (file && !art.has(suitAssetKey(suit))) {
    void art.load(suitAssetKey(suit), `${cardAssetBase()}/suits/${file}.svg`, { width: 200, height: 200 });
  }
}

/**
 * A suit pip in any color, as an atlas region `size` units square.
 *
 * For a pip that is not on a card: the faint one printed in an empty
 * foundation to say what belongs there, which is the felt's own marking and
 * takes whatever color it is handed. Draw it with
 * `board.image(suitTexture(board, 'spades', 0xffffff, 40), { x, y, alpha: 0.16 })`.
 */
export function suitTexture(board: Board, suit: string, color: number, size = 48,
  suitArt: Readonly<Record<string, string>> = STANDARD_SUIT_ART): Region {
  const art = CardArt.of(board);
  ensureArt(board, DEFAULT_DECK_THEME, suit, suitArt);
  const px = Math.ceil(size * board.pixelRatio);
  const key = `pip-${suit}-${color.toString(16)}-${px}`;
  const existing = board.atlas.acquire(key);
  if (existing) return existing;
  const region = board.atlas.reserve(key, px, px);
  art.paintTracked(region, (lookup) => (pen, w, h) => {
    const glyph = art.inkedSuit(suit, color, lookup);
    if (glyph) pen.drawImage(glyph, 0, 0, w, h);
  });
  return region;
}
