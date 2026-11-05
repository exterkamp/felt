import type { Painter, Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
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
interface Dependent { region: Region; key: string | undefined; paint: (art: ArtLookup) => Painter }

/** Stands for the faces' fonts having loaded. Nothing is drawn from it. */
export const FONT_ASSET = 'font:faces';

export const suitAssetKey = (suit: string) => `suit:${suit}`;
export const backAssetKey = (theme: DeckTheme) => `back:${theme}`;

/** The board's art: loaded images, and the regions waiting on them. */
export class CardArt {
  private readonly assets = new Map<string, Source>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly waiting = new Map<string, Set<Dependent>>();
  private readonly inked = new Map<string, Source>();
  /** Regions owed a repaint, done once each just before the next frame. */
  private readonly owed = new Set<Dependent>();

  constructor(readonly board: Board) {
    // Batched: a face waiting on the font and on its court, both of which
    // land in the same second, is painted again once rather than twice - and
    // twelve courts arriving in twelve tasks cost twelve repaints per face
    // waiting on each, not one per frame per arrival.
    board.beforeRender(() => this.flush());
    void fontsReady().then(() => {
      const token = document.createElement('canvas');
      token.width = token.height = 1;
      this.provide(FONT_ASSET, token);
    });
  }

  static of(board: Board): CardArt {
    let art = board.services.get('card-art') as CardArt | undefined;
    if (!art) {
      art = new CardArt(board);
      board.services.set('card-art', art);
    }
    return art;
  }

  get(key: string): Source | undefined {
    return this.assets.get(key);
  }

  has(key: string): boolean {
    return this.assets.has(key);
  }

  /** Puts an asset in, and repaints everything that was waiting for it. */
  provide(key: string, source: Source): void {
    this.assets.set(key, source);
    const waiting = this.waiting.get(key);
    if (!waiting) return;
    this.waiting.delete(key);
    for (const dependent of waiting) this.owed.add(dependent);
    this.board.touch();
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
    return pending;
  }

  /**
   * Paints a region with a painter that looks things up, and registers it to
   * be painted again for anything it asked for and did not get.
   */
  paintTracked(region: Region, paint: (art: ArtLookup) => Painter): void {
    this.repaint({ region, key: region.key, paint });
  }

  private repaint(dependent: Dependent): void {
    if (dependent.region.key !== dependent.key) return;
    const missing: string[] = [];
    const lookup: ArtLookup = {
      get: (key) => {
        const found = this.assets.get(key);
        if (!found) missing.push(key);
        return found;
      },
    };
    this.board.atlas.paint(dependent.region, dependent.paint(lookup), () => this.repaint(dependent));
    for (const key of missing) {
      let set = this.waiting.get(key);
      if (!set) this.waiting.set(key, (set = new Set()));
      set.add(dependent);
    }
  }

  private readonly mips = new WeakMap<object, Source[]>();

  private mipFor(source: Source, width: number, height: number): Source {
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
