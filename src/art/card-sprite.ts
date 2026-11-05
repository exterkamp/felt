import type { Painter, Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
import { FLOATS, Node, packColor, writeRegion } from '../scene/node.js';
import {
  Card, CardFaceMetrics, COURT_PALETTES, CARD_INDEX_FONT, CourtPalette, DECK_STOCK,
  DEFAULT_BACK_COLOR, DEFAULT_DECK_THEME, DEFAULT_FACE_STYLE, DeckTheme, FaceStyle, Rank,
  Suit, SuitInk, BASE_CARD_WIDTH, cardFaceMetrics, colorCss, courtArtRect, cssColor, inkOf,
  isCourtRank, pipPlaces, themeInk,
} from '../core/index.js';
import {
  ArtLookup, CardArt, FONT_ASSET, STANDARD_SUIT_ART, backAssetKey, ensureArt,
} from './card-art.js';
import { courtTextureKey } from './court-art.js';

// A card, drawn.
//
// The face is the one phaser-card-engine drew - Nertz's: a large index with
// its suit beside it in the top-left and one big suit, or a court portrait,
// filling the bottom; or the printed `standard` and `jumbo` faces - laid out
// by the same `cardFaceMetrics` arithmetic, so a card here and a card there
// are the same card to the unit.
//
// What changed is what a card *is* to the renderer. In Phaser it was a
// Container of a dozen images and text objects, each its own draw. Here it is
// one instance: a face and a back, each a region of the atlas painted once
// per look and shared by every card that looks like it, plus a body the
// shader cuts out of them - the rounded corners, the hairline edge and the
// shadow are arithmetic on the GPU rather than three baked textures per size.
// A card has two sides because it is one: turn it half a turn and the GPU
// shows the back, mirrored the right way round, with no swap to time.

// The hairline edge, as a fraction of the paper. At the default near-white
// it lands on #d6d6d6; at any other stock it stays a shade of that stock.
const EDGE_OF_PAPER = 0.846;
/** How wide the hairline is inside a face, and the back's heavier rule. */
const FACE_EDGE = 0.55;
const BACK_EDGE = 1.0;

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
  /** How dark its shadow is, 0-1. Default 1. */
  shadow?: number;
}

/** One color scaled toward black, channel by channel. */
function shade(color: number, factor: number): number {
  const part = (shift: number) => Math.round(((color >> shift) & 0xff) * factor) << shift;
  return part(16) | part(8) | part(0);
}

let measure: CanvasRenderingContext2D | undefined;
function rankWidth(rank: string, fontSize: number): number {
  measure ??= document.createElement('canvas').getContext('2d')!;
  measure.font = `bold ${fontSize}px ${CARD_INDEX_FONT}`;
  return measure.measureText(rank).width;
}

/** What a face needs to be painted, resolved from a style. */
interface FaceSpec {
  metrics: CardFaceMetrics;
  paper: number;
  edge: number;
  ink: number;
  courtInk: number;
  palette: CourtPalette;
  courtWidth: number;
  backColor: number;
  theme: DeckTheme;
  ratio: number;
}

export class CardSprite<S extends string = Suit> extends Node {
  readonly metrics: CardFaceMetrics;
  private readonly spec: FaceSpec;
  private readonly faceRegion: Region;
  private readonly backRegion: Region;
  private readonly deckLook: string;
  private displayFace: boolean | undefined;
  private shadow: number;
  private readonly table: Board;

  // Generic in the suit, because a game that declares one with `defineSuits`
  // has to be able to draw it.
  constructor(board: Board, readonly card: Card<S>, style: CardStyle = {}) {
    super(board);
    this.table = board;
    const width = style.width ?? BASE_CARD_WIDTH;
    const theme = style.theme ?? DEFAULT_DECK_THEME;
    const backColor = style.backColor ?? DEFAULT_BACK_COLOR;
    // The deck's own inks unless the game named others: a matrix card whose
    // spades came out near-black would be a black pip on near-black stock.
    const ink = inkOf(style.ink ?? themeInk(theme), card.suit);
    const ratio = style.pixelRatio ?? board.pixelRatio;
    const metrics = cardFaceMetrics(width, style.face ?? DEFAULT_FACE_STYLE);
    const palette = style.courtPalette ?? COURT_PALETTES[theme];
    const paper = style.paper ?? (palette.paper !== undefined
      ? cssColor(palette.paper) : DECK_STOCK[theme].paper);
    const edge = style.edge ?? shade(paper, EDGE_OF_PAPER);
    this.metrics = metrics;
    this.shadow = style.shadow ?? 1;
    this.spec = {
      metrics, paper, edge, ink, courtInk: cssColor(palette.ink), palette,
      courtWidth: style.courtWidth ?? 480, backColor, theme, ratio,
    };
    this.deckLook = `${theme}-${backColor.toString(16)}-${paper.toString(16)}`
      + `-${edge.toString(16)}-${Math.round(width)}-${metrics.face}`;

    const suitArt = style.suitArt ?? STANDARD_SUIT_ART;
    ensureArt(board, theme, card.suit, suitArt);
    const art = CardArt.of(board);
    const pxW = Math.ceil(metrics.width * ratio);
    const pxH = Math.ceil(metrics.height * ratio);

    // Keyed on everything that changes the picture, so two decks never share
    // a face and a hundred cards of one deck share fifty-two.
    const courtKey = isCourtRank(card.rank)
      ? courtTextureKey(palette, card.rank, card.suit, this.spec.courtWidth, metrics.court.cut)
      : '';
    const faceKey = `face-${metrics.face}-${width}-${ratio}-${paper.toString(16)}-${ink.toString(16)}`
      + `-${courtKey}-${card.suit}-${card.rank}`;
    const backKey = `back-${theme}-${backColor.toString(16)}-${width}-${metrics.face}-${ratio}`;

    const atlas = board.atlas;
    let face = atlas.acquire(faceKey);
    if (!face) {
      face = atlas.reserve(faceKey, pxW, pxH);
      art.paintTracked(face, (lookup) => this.facePainter(lookup, courtKey, art));
    }
    let back = atlas.acquire(backKey);
    if (!back) {
      back = atlas.reserve(backKey, pxW, pxH);
      const { backColor: color } = this.spec;
      art.paintTracked(back, (lookup) => (pen, w, h) => {
        pen.fillStyle = colorCss(color);
        pen.fillRect(0, 0, w, h);
        const image = lookup.get(backAssetKey(theme));
        if (image) pen.drawImage(image, 0, 0, w, h);
      });
    }
    this.faceRegion = face;
    this.backRegion = back;
    this.attach();
  }

  get width(): number { return this.metrics.width; }
  get height(): number { return this.metrics.height; }

  /**
   * What this card looks like, for anything caching a picture of it. The side
   * it is showing is part of the answer.
   */
  get look(): string {
    return `${this.deckLook}-${this.shownFace ? 'up' : 'down'}`;
  }

  /** Shows the face or the back. The card's own flag follows. */
  setFaceUp(faceUp: boolean): this {
    this.card.faceUp = faceUp;
    this.board.touch();
    return this;
  }

  /**
   * Draw the side asked for without touching the card's own `faceUp` - a
   * card mid-flip, which still belongs to its pile the way it did. Pass
   * `undefined` to go back to following the card.
   */
  setDisplayFace(faceUp: boolean | undefined): this {
    if (this.displayFace === faceUp) return this;
    this.displayFace = faceUp;
    this.board.touch();
    return this;
  }

  /** The side being shown when it lies flat, the card's own unless overridden. */
  get shownFace(): boolean {
    return this.displayFace ?? this.card.faceUp;
  }

  /**
   * The side actually facing the camera right now, with its turn counted: a
   * face-down card half way through being flipped over is showing its face.
   */
  get facingSide(): 'face' | 'back' {
    const turns = Math.round(this._turn / Math.PI);
    const flipped = Math.abs(turns) % 2 === 1;
    return this.shownFace !== flipped ? 'face' : 'back';
  }

  /** How dark its shadow is, 0-1. Tweenable. */
  get shadowStrength(): number { return this.shadow; }
  set shadowStrength(v: number) {
    if (v === this.shadow) return;
    this.shadow = v;
    this.board.touch();
  }

  setShadow(strength: number): this {
    this.shadowStrength = strength;
    return this;
  }

  /** The two regions, for tests and for anything snapshotting a card. */
  get regions(): { face: Region; back: Region } {
    return { face: this.faceRegion, back: this.backRegion };
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.table.atlas.release(this.faceRegion);
    this.table.atlas.release(this.backRegion);
    super.destroy();
  }

  writeInstance(out: Float32Array, o: number): boolean {
    if (!this._visible || this._alpha <= 0) return false;
    const m = this.metrics;
    const sx = Math.abs(this._scaleX);
    const sy = Math.abs(this._scaleY);
    const up = this.shownFace;
    const front = up ? this.faceRegion : this.backRegion;
    const back = up ? this.backRegion : this.faceRegion;
    this.writePose(out, o);
    out[o + 8] = m.width * sx;
    out[o + 9] = m.height * sy;
    out[o + 10] = m.radius * Math.min(sx, sy);
    out[o + 11] = m.pad * Math.max(sx, sy);
    writeRegion(out, o + 12, front);
    writeRegion(out, o + 16, back);
    out[o + 20] = front.page;
    out[o + 21] = back.page;
    out[o + 22] = 1;   // a card
    out[o + 23] = this.covered ? 0 : this.shadow;
    const faceEdge = packColor(this.spec.edge);
    const backEdge = packColor(this.spec.backColor);
    out[o + 24] = up ? faceEdge : backEdge;
    out[o + 25] = up ? backEdge : faceEdge;
    out[o + 26] = (up ? FACE_EDGE : BACK_EDGE) * sx;
    out[o + 27] = (up ? BACK_EDGE : FACE_EDGE) * sx;
    out[o + 28] = 0xffffff;
    out[o + 29] = 0;
    out[o + 30] = 0;
    out[o + 31] = 0;
    return true;
  }

  // --- painting the face ---------------------------------------------------

  private facePainter(lookup: ArtLookup, courtKey: string, art: CardArt): Painter {
    const { metrics, paper, ink, courtInk } = this.spec;
    const card = this.card;
    // Asked for so that a face painted before the index font arrived is
    // painted again when it does, rather than set in Helvetica for good.
    lookup.get(FONT_ASSET);
    return (pen, w, h) => {
      pen.scale(w / metrics.width, h / metrics.height);
      // Everything below is in card units from the card's centre, the frame
      // card-face.ts measures in.
      pen.translate(metrics.width / 2, metrics.height / 2);
      pen.fillStyle = colorCss(paper);
      pen.fillRect(-metrics.width / 2, -metrics.height / 2, metrics.width, metrics.height);

      const glyph = art.inkedSuit(card.suit, ink, lookup);
      const portrait = courtKey ? lookup.get(courtKey) : undefined;
      if (portrait) {
        // The portrait, sized off its own proportions; and on the faces that
        // frame one, the rule round it - drawn over the art, where a printed
        // rule is, or the bottom edge rounds away to nothing.
        const rect = courtArtRect(metrics, { width: portrait.width, height: portrait.height });
        art.blit(pen, portrait, rect.x - rect.width / 2, rect.y - rect.height / 2, rect.width, rect.height);
        if (metrics.court.cut === 'full') {
          pen.strokeStyle = colorCss(courtInk);
          pen.lineWidth = Math.max(1, metrics.width / 90);
          pen.strokeRect(rect.x - rect.width / 2, rect.y - rect.height / 2, rect.width, rect.height);
        }
      } else if (glyph) {
        // A number card: one big suit on the mobile face, a true count of
        // pips on the printed ones. A court whose portrait has not landed yet
        // is drawn this way too, and repainted when it does.
        const places = pipPlaces(metrics, card.rank as Rank);
        if (!places.length) {
          const s = metrics.pip.size;
          art.blit(pen, glyph, -s / 2, metrics.pip.y - s / 2, s, s);
        } else {
          for (const place of places) drawGlyph(art, pen, glyph, place.x, place.y, place.size, place.flip);
        }
      }
      this.corner(art, pen, glyph, false);
      if (metrics.corners === 2) this.corner(art, pen, glyph, true);
    };
  }

  /**
   * One corner: the rank, and its suit beside it or under it. The turned one
   * is the same drawing rotated half a turn about the card's centre, so the
   * two corners cannot drift apart.
   */
  private corner(art: CardArt, pen: Parameters<Painter>[0], glyph: ReturnType<CardArt['get']>,
    turned: boolean): void {
    const { index } = this.metrics;
    const rank = this.card.rank;
    pen.save();
    if (turned) pen.rotate(Math.PI);
    art.text(pen, rank, `bold ${index.fontSize}px ${CARD_INDEX_FONT}`, index.fontSize,
      colorCss(this.spec.ink), index.x, index.y);
    const width = rankWidth(rank, index.fontSize);
    if (glyph) {
      const s = index.suitSize;
      if (index.stacked) {
        art.blit(pen, glyph, index.x + width / 2 - s / 2, index.suitY - s / 2, s, s);
      } else {
        art.blit(pen, glyph, index.x + width + index.gap, index.y - s / 2, s, s);
      }
    }
    pen.restore();
  }
}

function drawGlyph(art: CardArt, pen: Parameters<Painter>[0], glyph: NonNullable<ReturnType<CardArt['get']>>,
  x: number, y: number, size: number, flip: boolean): void {
  if (!flip) {
    art.blit(pen, glyph, x - size / 2, y - size / 2, size, size);
    return;
  }
  pen.save();
  pen.translate(x, y);
  pen.rotate(Math.PI);
  art.blit(pen, glyph, -size / 2, -size / 2, size, size);
  pen.restore();
}

export { FLOATS };
