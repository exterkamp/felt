import {
  CourtPalette,
  courtHighlight,
  courtPaper,
  CourtRank,
  COURT_RANKS,
  CourtCut,
  courtArtHeight,
  courtCropRect,
  courtSourcePath,
  courtSeeds,
  courtSourceSize,
  courtWipeRects,
  prepareCourt,
  partBackgroundPixels,
} from '../core/index.js';
import type { Board } from '../scene/board.js';
import { CPU, CardArt } from './card-art.js';
import { courtWorkerPool, courtSlots } from './court-worker.js';

// Court portraits, rendered while the game is running.
//
// Ported from phaser-card-engine with one change of destination: a finished
// portrait is handed to the board's CardArt rather than Phaser's texture
// manager, which repaints every face that was waiting for it in place.
//
// The alternative, and what this package shipped until v0.13, is to bake
// them: run the twelve sources through a renderer at build time, once per
// palette, and ship the WebP. That is faster to start, and it was 84 files
// and 4.1MB. What it cannot do is a palette nobody thought of - a game with
// its own colors has to go and rebuild the art - and that is the whole of
// why this replaced it.
//
// Measured, on the twelve at 480px, outside a scene: 280ms on a desktop and
// about a second on a mid-range phone. Inside a running scene it is roughly
// three times that, for the reason in renderCourts below. Either way it is
// once per palette - they are cached in the texture manager afterwards - and
// the recolor is only 12ms of it. The rasterising is the cost, so the same
// palette at two sizes costs twice.

/** Fetched once per file and kept, so changing palette never refetches. */
const sources = new Map<string, Promise<string>>();

function sourceSvg(rank: CourtRank, suit: string): Promise<string> {
  const path = courtSourcePath(rank, suit);
  let pending = sources.get(path);
  if (!pending) {
    pending = fetch(path).then((response) => {
      if (!response.ok) throw new Error(`court art ${path}: ${response.status}`);
      return response.text();
    });
    sources.set(path, pending);
  }
  return pending;
}

/**
 * The texture one court lands in.
 *
 * Keyed by the palette as well as the size, so two decks can be on screen at
 * once - which a four-handed game where everyone picked their own deck needs,
 * and which the baked themes used to get for free by being separate
 * directories.
 */
export function courtTextureKey(
  palette: CourtPalette, rank: string, suit: string, width: number,
  cut: CourtCut = 'half',
): string {
  const ink = `${palette.ink}${palette.gold}${palette.red}`
    + `${courtPaper(palette)}${courtHighlight(palette)}`;
  const key = ink.replace(/#/g, '');
  return `pce-court-svg-${key}-${Math.round(width)}-${cut}-${rank}-${suit}`;
}

/**
 * Renders one court into a texture and returns its key.
 *
 * Resolves immediately if that exact palette and size is already rendered.
 */
export async function renderCourt(
  board: Board, rank: CourtRank, suit: string,
  palette: CourtPalette, width: number, cut: CourtCut = 'half',
): Promise<string> {
  const key = courtTextureKey(palette, rank, suit, width, cut);
  const art = CardArt.of(board);
  if (art.has(key)) return key;
  // One render per portrait however many ask: a deck's sheet asks for each
  // court as it paints it, and renderCourts may be asking for the same ones.
  let flying = inFlight.get(board);
  if (!flying) inFlight.set(board, (flying = new Map()));
  const pending = flying.get(key);
  if (pending) return pending;
  const job = renderCourtOnce(board, key, rank, suit, palette, width, cut);
  flying.set(key, job);
  return job.finally(() => flying.delete(key));
}

const inFlight = new WeakMap<Board, Map<string, Promise<string>>>();

async function renderCourtOnce(
  board: Board, key: string, rank: CourtRank, suit: string,
  palette: CourtPalette, width: number, cut: CourtCut,
): Promise<string> {
  const art = CardArt.of(board);

  // With a worker doing the heavy part, what is left on the main thread is
  // the decode and the resize, and twelve decks' worth of those started at
  // once land as one long frame. A few at a time lets the game loop in
  // between them. Without a worker the old all-at-once behaviour stands, for
  // the reasons given on `renderCourts`.
  if (!courtWorkerPool()) return paintCourt(board, key, rank, suit, palette, width, cut);
  const release = await courtSlots().take();
  try {
    if (board.isDestroyed) return key;
    if (art.has(key)) return key;
    return await paintCourt(board, key, rank, suit, palette, width, cut);
  } finally {
    release();
  }
}

type Page = ImageBitmap | HTMLImageElement;

/** Rasterised pages, by palette, court and size. A few decks' worth. */
const pages = new Map<string, Promise<Page>>();
const PAGES_KEPT = 48;

/**
 * One court's whole page, recoloured and rasterised at the size a cut of it
 * needs - once, however many cuts are taken from it.
 *
 * The half and the full figure are two windows on the same page, and before
 * this each of them recoloured the 2MB of SVG, made a blob of it, decoded it
 * and rasterised it on its own: a page drawing all three faces paid for every
 * court twice. Measured, that was most of what changing deck cost.
 */
function courtPage(rank: CourtRank, suit: string, palette: CourtPalette, width: number): Promise<Page> {
  const size = courtSourceSize(width);
  const key = `${courtTextureKey(palette, rank, suit, width)}-${size.width}x${size.height}`;
  let pending = pages.get(key);
  if (pending) {
    pages.delete(key);
    pages.set(key, pending);
    return pending;
  }
  pending = (async () => {
    const svg = prepareCourt(await sourceSvg(rank, suit), palette);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (typeof createImageBitmap !== 'function') return image;
      return await createImageBitmap(image, {
        resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high',
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  })();
  pending.catch(() => pages.delete(key));
  pages.set(key, pending);
  while (pages.size > PAGES_KEPT) {
    const oldest = pages.keys().next().value!;
    const gone = pages.get(oldest);
    pages.delete(oldest);
    void gone?.then((page) => { if ('close' in page) page.close(); }, () => undefined);
  }
  return pending;
}

async function paintCourt(
  board: Board, key: string, rank: CourtRank, suit: string,
  palette: CourtPalette, width: number, cut: CourtCut,
): Promise<string> {
  {
    const image = await courtPage(rank, suit, palette, width);

    // Off the main thread where the browser allows it. Anything that goes
    // wrong over there - no worker, a dead one, a message that would not
    // clone - drops to the path below, which is the one this function had
    // before there was a worker, so a failure costs frames and never a card.
    const pool = courtWorkerPool();
    if (pool) {
      try {
        if (board.isDestroyed) return key;
        await paintInWorker(pool, image, rank, suit, palette, width, cut, board, key);
        return key;
      } catch {
        if (board.isDestroyed) return key;
        if (CardArt.of(board).has(key)) return key;
      }
    }

    // The whole page first, big enough that the window cut out of it lands at
    // the size asked for.
    const source = courtSourceSize(width);
    const page = document.createElement('canvas');
    page.width = source.width;
    page.height = source.height;
    const pen = page.getContext('2d', CPU);
    if (!pen) throw new Error('court art: no 2d context');
    pen.drawImage(image, 0, 0, source.width, source.height);

    // Then the source's own marks go. In the highlight rather than the stock,
    // because at this point the whole background is the highlight and the
    // wipe has to join it - a patch of stock here would be an island the
    // flood below never reaches, and would stay the wrong color if the two
    // ever differ.
    const highlight = courtHighlight(palette);
    const paper = courtPaper(palette);
    pen.fillStyle = highlight;
    for (const wipe of courtWipeRects(source, cut)) {
      pen.fillRect(wipe.x, wipe.y, wipe.width, wipe.height);
    }

    const crop = courtCropRect(source, cut);
    const out = document.createElement('canvas');
    out.width = Math.round(width);
    out.height = courtArtHeight(width, cut);
    const cropPen = out.getContext('2d', CPU);
    if (!cropPen) throw new Error('court art: no 2d context');
    cropPen.drawImage(page, crop.x, crop.y, crop.width, crop.height,
      0, 0, out.width, out.height);

    // And the background goes back to the stock, where they differ. A deck
    // that has not asked for the two to differ pays nothing for this.
    //
    // After the crop, not before. Some of the background is walled off from
    // the card's margin by the figure itself - the wedge under a Queen's
    // headdress is closed at the page but open at the edge of the cut - so
    // running this on the finished art is what lets the edges reach it.
    if (paper.toLowerCase() !== highlight.toLowerCase()) {
      partBackground(cropPen, out.width, out.height, highlight, paper,
        courtSeeds(rank, suit, cut));
    }

    const art = CardArt.of(board);
    if (!board.isDestroyed && !art.has(key)) art.provide(key, out);
    return key;
  }
}



/**
 * The worker's half of `renderCourt`: the page decodes and resizes, the worker
 * draws, wipes, crops and parts the background, and what comes back is blitted
 * onto a canvas for the board's art.
 */
async function paintInWorker(
  pool: NonNullable<ReturnType<typeof courtWorkerPool>>,
  image: Page, rank: CourtRank, suit: string,
  palette: CourtPalette, width: number, cut: CourtCut,
  board: Board, key: string,
): Promise<void> {
  const source = courtSourceSize(width);
  const highlight = courtHighlight(palette);
  const paper = courtPaper(palette);
  // A copy, because the worker is handed it to keep and the page is shared
  // with the other cut. Copying a bitmap is cheap; rasterising an SVG is not.
  const bitmap = image instanceof ImageBitmap
    ? await createImageBitmap(image)
    : await createImageBitmap(image, {
      resizeWidth: source.width, resizeHeight: source.height, resizeQuality: 'high',
    });
  const outWidth = Math.round(width);
  const outHeight = courtArtHeight(width, cut);
  const painted = await pool.run({
    bitmap,
    pageWidth: source.width,
    pageHeight: source.height,
    wipes: courtWipeRects(source, cut),
    wipeColor: highlight,
    crop: courtCropRect(source, cut),
    width: outWidth,
    height: outHeight,
    part: paper.toLowerCase() !== highlight.toLowerCase()
      ? { from: cssRgb(highlight), to: cssRgb(paper), seeds: courtSeeds(rank, suit, cut) }
      : null,
  });
  try {
    const art = CardArt.of(board);
    if (board.isDestroyed || art.has(key)) return;
    const out = document.createElement('canvas');
    out.width = outWidth;
    out.height = outHeight;
    const pen = out.getContext('2d', CPU);
    if (!pen) throw new Error('court art: no 2d context');
    pen.drawImage(painted, 0, 0);
    art.provide(key, out);
  } finally {
    painted.close();
  }
}

/** The canvas end of `partBackgroundPixels`, which says what it does and why. */
function partBackground(
  pen: CanvasRenderingContext2D, width: number, height: number,
  from: string, to: string, extra: readonly { x: number; y: number }[] = [],
): void {
  const image = pen.getImageData(0, 0, width, height);
  partBackgroundPixels(image.data, width, height, cssRgb(from), cssRgb(to), extra);
  pen.putImageData(image, 0, 0);
}

/** `'#rrggbb'` as three numbers. */
function cssRgb(css: string): [number, number, number] {
  const hex = css.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

export interface RenderCourtsOptions {
  /** Which suits to draw courts for. Defaults to the standard four. */
  suits?: readonly string[];
  /** The raster width, in texture pixels. */
  width?: number;
  /**
   * One figure or both - see `CourtCut`.
   *
   * It has to match the face the cards are drawn in, because the cut is part
   * of the texture's key: a board that renders half courts and then deals
   * standard cards asks for a texture nobody made and gets a pip. A game
   * drawing more than one face renders both, which is what `faces.html` does.
   */
  cut?: CourtCut | readonly CourtCut[];
}

const DEFAULT_SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;

/**
 * Renders a whole deck's worth of courts, and resolves when they are all in
 * the texture manager.
 *
 * Await this before creating any CardSprite that might be a court: a sprite
 * built while its portrait is still rendering falls back to the big centre
 * pip and does not go back and check. That is a deliberate fallback rather
 * than a bug - a court with no art is still a playable card - but it is not
 * what you want on purpose.
 *
 * All twelve at once, and this went in the other way round first. The
 * reasoning for doing them one at a time was that they contend for the same
 * main thread anyway and a burst of twelve decodes would stall a phone; the
 * reasoning was wrong, because the contention is not what dominates. Each
 * await hands a frame back to the game loop, and a loop redrawing a board
 * costs far more than the decode it is waiting on. Measured on the demo page:
 *
 *   sequential   3.5s, and 5.0s at 4x CPU throttle
 *   parallel     0.8s, and 2.3s
 *
 * Outside a running scene the whole job is about 280ms, which is what the
 * rasterising actually costs - the rest is the loop, and the way to not pay
 * it is to not go round the loop twelve times.
 */
export async function renderCourts(
  board: Board, palette: CourtPalette, options: RenderCourtsOptions = {},
): Promise<void> {
  const suits = options.suits ?? DEFAULT_SUITS;
  const width = options.width ?? 480;
  const cuts = typeof options.cut === 'string' ? [options.cut] : options.cut ?? ['half'];
  const wanted = cuts.flatMap((cut) =>
    COURT_RANKS.flatMap((rank) => suits.map((suit) => ({ rank, suit, cut }))));
  try {
    await Promise.all(wanted.map(({ rank, suit, cut }) =>
      renderCourt(board, rank, suit, palette, width, cut)));
  } finally {
    // A board torn down mid-paint has no use for the worker; let it go now
    // rather than at the idle timeout, unless something else is using it.
    if (board.isDestroyed) courtWorkerPool()?.disposeIfIdle();
  }
}
