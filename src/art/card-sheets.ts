import type { Painter, Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
import {
  BASE_CARD_WIDTH, CARD_INDEX_FONT, CardFaceMetrics, COURT_PALETTES, CourtPalette, DECK_STOCK,
  DEFAULT_BACK_COLOR, DEFAULT_DECK_THEME, DEFAULT_FACE_STYLE, DeckTheme, FaceStyle, RANKS, Rank,
  SUITS, SuitInk, cardFaceMetrics, colorCss, courtArtRect, courtHighlight, courtPaper, cssColor,
  inkOf, isCourtRank, pipPlaces, themeInk,
} from '../core/index.js';
import {
  ArtLookup, CardArt, FONT_ASSET, STANDARD_SUIT_ART, backAssetKey, ensureArt,
} from './card-art.js';
import { courtTextureKey, renderCourt } from './court-art.js';

// The engine's card sheets: every card picture on the table, owned in one
// place.
//
// A card on the board does not paint itself, does not know what an atlas is,
// and does not track the art it is waiting for. It names a style; the engine
// turns that into a **face sheet** - one cell per suit and rank, for
// everything that changes what a face looks like (size, layout, stock, inks,
// court palette, density) - and a **back sheet**, which is kept apart because
// the back colour is a seat and the face is a deck: four players with four
// backs share one sheet of faces.
//
// The sheets are the engine's to manage:
//
//   - a cell is painted the first time anything shows it, and the rest of a
//     standard deck is painted in the background, a few milliseconds a frame,
//     so turning a card over later never waits on a paint;
//   - art that arrives late (a court portrait, the index font, a suit glyph)
//     repaints the cells that wanted it, in place, and every card showing
//     them updates at once;
//   - a sheet nobody is using is kept - dealing again, or going back to a
//     deck already seen, is free - and only given up when the atlas needs the
//     room, least recently used first.

/** How a card is drawn. Everything is optional; a theme fills in the rest. */
export interface CardStyle {
  /** How wide to draw it. Everything else follows from this. */
  width?: number;
  /** `mobile` (default), `standard` or `jumbo` - see card-face.ts. */
  face?: FaceStyle;
  theme?: DeckTheme;
  /** What the back's ink is printed over. */
  backColor?: number;
  /** The card stock the face is printed on. The court's paper moves with it. */
  paper?: number;
  /** The hairline round a face-up card. Defaults to the paper, darkened. */
  edge?: number;
  /** The ink each suit is drawn in: a map or a function. */
  ink?: SuitInk;
  suitArt?: Readonly<Record<string, string>>;
  /** The court palette, for a deck that is not one of the themes. */
  courtPalette?: CourtPalette;
  /** The raster width the courts were rendered at. Defaults to 480. */
  courtWidth?: number;
  /** Texture pixels per unit. Defaults to the board's own ratio. */
  pixelRatio?: number;
  /** How dark its shadow is, 0-1. Default 1. Not part of any sheet. */
  shadow?: number;
}

// The hairline edge, as a fraction of the paper. At the default near-white
// it lands on #d6d6d6; at any other stock it stays a shade of that stock.
const EDGE_OF_PAPER = 0.846;

function shade(color: number, factor: number): number {
  const part = (shift: number) => Math.round(((color >> shift) & 0xff) * factor) << shift;
  return part(16) | part(8) | part(0);
}

/** Face sheets kept with nobody using them, and back sheets. */
const KEEP_FACES = 8;
const KEEP_BACKS = 16;
/** Milliseconds a frame spent painting cells nobody is showing yet. */
const PREWARM_BUDGET_MS = 3;
/**
 * Frames a sheet has to stay in use before it is warmed. A deck being
 * scrubbed through - a size slider, a theme button pressed five times - is
 * gone before this, and warming fifty-two faces of each was most of what
 * scrubbing cost.
 */
const WARM_AFTER_FRAMES = 20;

export class FaceSheet {
  readonly metrics: CardFaceMetrics;
  readonly paper: number;
  readonly edge: number;
  readonly palette: CourtPalette;
  readonly courtInk: number;
  readonly courtWidth: number;
  readonly ratio: number;
  readonly theme: DeckTheme;
  /** Cards using it. At nought it is kept, not dropped - see CardSheets. */
  users = 0;
  /** The frame from which it may be warmed. */
  warmFrom = 0;
  /** Cells by `suit|rank`. */
  private readonly cells = new Map<string, Region>();
  private readonly ink: SuitInk;
  private readonly suitArt: Readonly<Record<string, string>>;
  private readonly pxW: number;
  private readonly pxH: number;

  constructor(private readonly board: Board, readonly key: string, style: ResolvedStyle) {
    this.metrics = style.metrics;
    this.paper = style.paper;
    this.edge = style.edge;
    this.palette = style.palette;
    this.courtInk = cssColor(style.palette.ink);
    this.courtWidth = style.courtWidth;
    this.ratio = style.ratio;
    this.theme = style.theme;
    this.ink = style.ink;
    this.suitArt = style.suitArt;
    this.pxW = Math.ceil(this.metrics.width * this.ratio);
    this.pxH = Math.ceil(this.metrics.height * this.ratio);
  }

  /** The cell for one face, painted now if it never has been. */
  cell(suit: string, rank: string): Region {
    const id = `${suit}|${rank}`;
    let region = this.cells.get(id);
    if (region) return region;
    ensureArt(this.board, this.theme, suit, this.suitArt);
    const key = `${this.key}|${id}`;
    // Still in the atlas from the last time this sheet existed: the pixels
    // are the same pixels, so take them back rather than paint them again.
    const kept = this.board.atlas.acquire(key);
    if (kept) {
      this.cells.set(id, kept);
      return kept;
    }
    region = this.board.atlas.reserve(key, this.pxW, this.pxH);
    this.cells.set(id, region);
    const ink = inkOf(this.ink, suit);
    const courtKey = isCourtRank(rank)
      ? courtTextureKey(this.palette, rank, suit, this.courtWidth, this.metrics.court.cut) : '';
    const art = CardArt.of(this.board);
    // The portrait is the sheet's to get, not the game's: a court asked for
    // starts its own render, the cell shows the pip until it lands, and the
    // landing repaints it. renderCourts is still there to start a whole deck
    // early; it and this share the work, never doing it twice.
    if (courtKey && !art.has(courtKey) && isCourtRank(rank)) {
      void renderCourt(this.board, rank, suit, this.palette, this.courtWidth, this.metrics.court.cut)
        .catch(() => undefined);
    }
    art.paintTracked(region, (lookup) => this.painter(lookup, art, suit, rank, ink, courtKey));
    return region;
  }

  /** Whether a face has been painted. */
  has(suit: string, rank: string): boolean {
    return this.cells.has(`${suit}|${rank}`);
  }

  /** How many cells it holds. */
  get size(): number {
    return this.cells.size;
  }

  /**
   * Paints standard faces nobody has asked for yet, until `deadline`.
   * Answers whether there is anything left to do.
   */
  prewarm(deadline: number): boolean {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (this.cells.has(`${suit}|${rank}`)) continue;
        if (performance.now() > deadline) return true;
        this.cell(suit, rank);
      }
    }
    return false;
  }

  /** Gives every cell back to the atlas. */
  dispose(): void {
    for (const region of this.cells.values()) this.board.atlas.release(region);
    this.cells.clear();
  }

  private painter(lookup: ArtLookup, art: CardArt, suit: string, rank: string, ink: number,
    courtKey: string): Painter {
    const { metrics, paper, courtInk } = this;
    // Asked for so a face painted before the index font arrived is painted
    // again when it does, rather than set in Helvetica for good.
    lookup.get(FONT_ASSET);
    return (pen, w, h) => {
      pen.scale(w / metrics.width, h / metrics.height);
      // Card units from the card's centre: the frame card-face.ts measures in.
      pen.translate(metrics.width / 2, metrics.height / 2);
      pen.fillStyle = colorCss(paper);
      pen.fillRect(-metrics.width / 2, -metrics.height / 2, metrics.width, metrics.height);

      const glyph = art.inkedSuit(suit, ink, lookup);
      const portrait = courtKey ? lookup.get(courtKey) : undefined;
      if (portrait) {
        // The portrait, sized off its own proportions; on the faces that frame
        // one, the rule round it, drawn over the art where a printed rule is.
        const rect = courtArtRect(metrics, { width: portrait.width, height: portrait.height });
        art.blit(pen, portrait, rect.x - rect.width / 2, rect.y - rect.height / 2, rect.width, rect.height);
        if (metrics.court.cut === 'full') {
          pen.strokeStyle = colorCss(courtInk);
          pen.lineWidth = Math.max(1, metrics.width / 90);
          pen.strokeRect(rect.x - rect.width / 2, rect.y - rect.height / 2, rect.width, rect.height);
        }
      } else if (glyph) {
        // One big suit on the mobile face, a true count of pips on the
        // printed ones. A court still waiting for its portrait is drawn this
        // way too, and repainted when it lands.
        const places = pipPlaces(metrics, rank as Rank);
        if (!places.length) {
          const s = metrics.pip.size;
          art.blit(pen, glyph, -s / 2, metrics.pip.y - s / 2, s, s);
        } else {
          for (const place of places) {
            if (!place.flip) {
              art.blit(pen, glyph, place.x - place.size / 2, place.y - place.size / 2, place.size, place.size);
              continue;
            }
            pen.save();
            pen.translate(place.x, place.y);
            pen.rotate(Math.PI);
            art.blit(pen, glyph, -place.size / 2, -place.size / 2, place.size, place.size);
            pen.restore();
          }
        }
      }
      corner(art, pen, metrics, rank, ink, glyph, false);
      if (metrics.corners === 2) corner(art, pen, metrics, rank, ink, glyph, true);
    };
  }
}

/**
 * One corner: the rank, and its suit beside it or under it. The turned one is
 * the same drawing rotated half a turn about the centre, so the two corners
 * cannot drift apart.
 */
function corner(art: CardArt, pen: Parameters<Painter>[0], metrics: CardFaceMetrics, rank: string,
  ink: number, glyph: ReturnType<CardArt['get']>, turned: boolean): void {
  const { index } = metrics;
  const font = `bold ${index.fontSize}px ${CARD_INDEX_FONT}`;
  pen.save();
  if (turned) pen.rotate(Math.PI);
  const width = art.text(pen, rank, font, index.fontSize, colorCss(ink), index.x, index.y);
  if (glyph) {
    const s = index.suitSize;
    if (index.stacked) art.blit(pen, glyph, index.x + width / 2 - s / 2, index.suitY - s / 2, s, s);
    else art.blit(pen, glyph, index.x + width + index.gap, index.y - s / 2, s, s);
  }
  pen.restore();
}

/** A back: one picture for a theme, a colour and a size. */
export class BackSheet {
  users = 0;
  readonly region: Region;

  constructor(board: Board, readonly key: string, theme: DeckTheme, color: number,
    metrics: CardFaceMetrics, ratio: number) {
    ensureArt(board, theme, 'spades');
    this.board = board;
    const kept = board.atlas.acquire(key);
    if (kept) {
      this.region = kept;
      return;
    }
    this.region = board.atlas.reserve(key, Math.ceil(metrics.width * ratio), Math.ceil(metrics.height * ratio));
    CardArt.of(board).paintTracked(this.region, (lookup) => (pen, w, h) => {
      pen.fillStyle = colorCss(color);
      pen.fillRect(0, 0, w, h);
      const image = lookup.get(backAssetKey(theme));
      if (image) pen.drawImage(image, 0, 0, w, h);
    });
  }

  private readonly board: Board;

  dispose(): void {
    this.board.atlas.release(this.region);
  }
}

/** A style with every default filled in. */
export interface ResolvedStyle {
  metrics: CardFaceMetrics;
  theme: DeckTheme;
  backColor: number;
  paper: number;
  edge: number;
  ink: SuitInk;
  palette: CourtPalette;
  courtWidth: number;
  ratio: number;
  suitArt: Readonly<Record<string, string>>;
}

export function resolveStyle(style: CardStyle, boardRatio: number): ResolvedStyle {
  const theme = style.theme ?? DEFAULT_DECK_THEME;
  const palette = style.courtPalette ?? COURT_PALETTES[theme];
  const paper = style.paper ?? (palette.paper !== undefined ? cssColor(palette.paper) : DECK_STOCK[theme].paper);
  return {
    metrics: cardFaceMetrics(style.width ?? BASE_CARD_WIDTH, style.face ?? DEFAULT_FACE_STYLE),
    theme,
    backColor: style.backColor ?? DEFAULT_BACK_COLOR,
    paper,
    edge: style.edge ?? shade(paper, EDGE_OF_PAPER),
    // The deck's own inks unless the game named others: a matrix card whose
    // spades came out near-black would be a black pip on near-black stock.
    ink: style.ink ?? themeInk(theme),
    palette,
    courtWidth: style.courtWidth ?? 480,
    ratio: style.pixelRatio ?? boardRatio,
    suitArt: style.suitArt ?? STANDARD_SUIT_ART,
  };
}

/** The key two styles share exactly when their faces look the same. */
function faceKey(s: ResolvedStyle): string {
  const m = s.metrics;
  // Inks by the standard suits; a function's answer for an invented suit is
  // still read per cell, and the cell is keyed by the sheet that drew it.
  const inks = SUITS.map((suit) => inkOf(s.ink, suit).toString(16)).join('.');
  const p = s.palette;
  const court = `${p.ink}${p.gold}${p.red}${courtPaper(p)}${courtHighlight(p)}`.replace(/#/g, '');
  const art = Object.entries(s.suitArt).map(([k, v]) => `${k}=${v}`).join(',');
  return `sheet|${m.face}|${m.width}|${s.ratio}|${s.paper.toString(16)}|${inks}|${court}|${s.courtWidth}|${s.theme}|${art}`;
}

function backKey(s: ResolvedStyle): string {
  return `back|${s.theme}|${s.backColor.toString(16)}|${s.metrics.width}|${s.metrics.face}|${s.ratio}`;
}

/** The board's card sheets. One per board; reach it with `CardSheets.of`. */
export class CardSheets {
  private readonly faces = new Map<string, FaceSheet>();
  private readonly backs = new Map<string, BackSheet>();
  /** Sheets in least- to most-recently used order, for keeping and trimming. */
  private readonly idleFaces = new Set<FaceSheet>();
  private readonly idleBacks = new Set<BackSheet>();
  private readonly warming = new Set<FaceSheet>();
  private wake?: () => void;

  constructor(private readonly board: Board) {
    board.beforeRender(() => this.prewarm());
    // When the atlas is full, unused sheets are the first thing to go.
    board.atlas.onPressure = () => this.trim(0, 0);
  }

  static of(board: Board): CardSheets {
    let sheets = board.services.get('card-sheets') as CardSheets | undefined;
    if (!sheets) {
      sheets = new CardSheets(board);
      board.services.set('card-sheets', sheets);
    }
    return sheets;
  }

  /** A face sheet for this style, counted. Release it when done. */
  acquireFaces(style: ResolvedStyle): FaceSheet {
    const key = faceKey(style);
    let sheet = this.faces.get(key);
    if (!sheet) {
      sheet = new FaceSheet(this.board, key, style);
      this.faces.set(key, sheet);
    }
    if (sheet.users++ === 0) this.idleFaces.delete(sheet);
    if (sheet.size < SUITS.length * RANKS.length) this.startWarming(sheet);
    return sheet;
  }

  acquireBack(style: ResolvedStyle): BackSheet {
    const key = backKey(style);
    let sheet = this.backs.get(key);
    if (!sheet) {
      sheet = new BackSheet(this.board, key, style.theme, style.backColor, style.metrics, style.ratio);
      this.backs.set(key, sheet);
    }
    if (sheet.users++ === 0) this.idleBacks.delete(sheet);
    return sheet;
  }

  releaseFaces(sheet: FaceSheet): void {
    if (--sheet.users > 0) return;
    sheet.users = 0;
    this.warming.delete(sheet);
    this.idleFaces.add(sheet);
    this.trim(KEEP_FACES, KEEP_BACKS);
  }

  releaseBack(sheet: BackSheet): void {
    if (--sheet.users > 0) return;
    sheet.users = 0;
    this.idleBacks.add(sheet);
    this.trim(KEEP_FACES, KEEP_BACKS);
  }

  /** How many sheets exist, in use and kept. For anyone measuring. */
  get stats(): { faces: number; backs: number; idleFaces: number; idleBacks: number; warming: number } {
    return {
      faces: this.faces.size, backs: this.backs.size,
      idleFaces: this.idleFaces.size, idleBacks: this.idleBacks.size, warming: this.warming.size,
    };
  }

  /** Drops unused sheets beyond the counts given, oldest first. Answers whether any went. */
  trim(keepFaces: number, keepBacks: number): boolean {
    let dropped = false;
    while (this.idleFaces.size > keepFaces) {
      const sheet = this.idleFaces.values().next().value!;
      this.idleFaces.delete(sheet);
      this.faces.delete(sheet.key);
      sheet.dispose();
      dropped = true;
    }
    while (this.idleBacks.size > keepBacks) {
      const sheet = this.idleBacks.values().next().value!;
      this.idleBacks.delete(sheet);
      this.backs.delete(sheet.key);
      sheet.dispose();
      dropped = true;
    }
    return dropped;
  }

  private startWarming(sheet: FaceSheet): void {
    if (!this.warming.has(sheet)) sheet.warmFrom = this.board.frames + WARM_AFTER_FRAMES;
    this.warming.add(sheet);
    // The board would go to sleep with cells still unpainted; keep it awake
    // only while there is warming to do.
    this.wake ??= this.board.keepAwake();
  }

  /**
   * Paints the cells of sheets in use that nobody is showing yet, within a
   * small budget a frame. Newest sheet first: it is the one about to be dealt.
   */
  private prewarm(): void {
    if (!this.warming.size) return;
    const deadline = performance.now() + PREWARM_BUDGET_MS;
    const order = [...this.warming].reverse();
    for (const sheet of order) {
      if (sheet.users === 0) {
        this.warming.delete(sheet);
        continue;
      }
      if (this.board.frames < sheet.warmFrom) continue;
      if (!sheet.prewarm(deadline)) this.warming.delete(sheet);
      if (performance.now() > deadline) break;
    }
    if (!this.warming.size && this.wake) {
      this.wake();
      this.wake = undefined;
    }
  }
}
