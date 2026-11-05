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

interface Dependent { region: Region; paint: (art: ArtLookup) => Painter }

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

  constructor(readonly board: Board) {
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
    for (const dependent of waiting) this.repaint(dependent);
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
      let source: Source = image;
      // SVGs are rasterised large once, because they are drawn down to every
      // size a card comes in and a pip loaded at pip size blurs the moment
      // somebody asks for a big card.
      if (size) {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext('2d')!.drawImage(image, 0, 0, size.width, size.height);
        source = canvas;
      }
      this.provide(key, source);
    })();
    this.loading.set(key, pending);
    return pending;
  }

  /**
   * Paints a region with a painter that looks things up, and registers it to
   * be painted again for anything it asked for and did not get.
   */
  paintTracked(region: Region, paint: (art: ArtLookup) => Painter): void {
    this.repaint({ region, paint });
  }

  private repaint(dependent: Dependent): void {
    const missing: string[] = [];
    const lookup: ArtLookup = {
      get: (key) => {
        const found = this.assets.get(key);
        if (!found) missing.push(key);
        return found;
      },
    };
    this.board.atlas.paint(dependent.region, dependent.paint(lookup));
    for (const key of missing) {
      let set = this.waiting.get(key);
      if (!set) this.waiting.set(key, (set = new Set()));
      set.add(dependent);
    }
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
    const pen = out.getContext('2d')!;
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
  const region = board.atlas.obtain(key, px, px, () => { /* painted below */ });
  art.paintTracked(region, (lookup) => (pen, w, h) => {
    const glyph = art.inkedSuit(suit, color, lookup);
    if (glyph) pen.drawImage(glyph, 0, 0, w, h);
  });
  return region;
}
