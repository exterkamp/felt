import type { Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
import { FLOATS, Node, packColor, writeRegion } from '../scene/node.js';
import { Card, CardFaceMetrics, Suit } from '../core/index.js';
import {
  BackSheet, CardSheets, CardStyle, FaceSheet, ResolvedStyle, resolveStyle,
} from './card-sheets.js';

export type { CardStyle };

// A card, on the table.
//
// The face is the one phaser-card-engine drew - laid out by the same
// `cardFaceMetrics` arithmetic, so a card here and a card there are the same
// card to the unit - but a CardSprite does not draw it. The engine's card
// sheets do (see card-sheets.ts): this names a style, is handed a sheet of
// faces and a back, and on every frame says which cell of the sheet it is
// showing. Painting, caching, waiting for late art and giving room back are
// the engine's business and happen once per deck, not once per card.
//
// So a card is a card and a pose. Change its rank or suit and it shows a
// different cell; restyle it and it moves to a different sheet; a hundred of
// one deck cost one sheet. The body - rounded corners, hairline, shadow - is
// the shader's, and a card has two sides because it is one: turn it half a
// turn and the GPU shows the back, mirrored the right way round.

/** How wide the hairline is inside a face, and the back's heavier rule. */
const FACE_EDGE = 0.55;
const BACK_EDGE = 1.0;

export class CardSprite<S extends string = Suit> extends Node {
  private faces: FaceSheet;
  private backs: BackSheet;
  private resolved: ResolvedStyle;
  private displayFace: boolean | undefined;
  private shadow: number;
  private readonly sheets: CardSheets;
  private readonly boardRatio: number;
  private readonly waitForArt: boolean;
  /**
   * The finished look it goes on showing after a restyle, until the new
   * one's sheets are finished too. Held, so the engine keeps it.
   */
  private held?: { faces: FaceSheet; backs: BackSheet };
  /**
   * The face last looked up, and what it was looked up for. Asked twice a
   * frame per card (prepare, then draw), and each ask built a string key
   * and hit a map: a lookup only when the card or its sheet has changed.
   * A sheet's cells live as long as the sheet, and a card holds its sheets.
   */
  private faceSheet?: FaceSheet;
  private faceSuit = '';
  private faceRank = '';
  private faceRegion?: Region;

  private face(sheet: FaceSheet): Region {
    const { suit, rank } = this.card;
    if (sheet === this.faceSheet && suit === this.faceSuit && rank === this.faceRank) return this.faceRegion!;
    const region = sheet.cell(suit, rank);
    this.faceSheet = sheet;
    this.faceSuit = suit;
    this.faceRank = rank;
    this.faceRegion = region;
    return region;
  }

  /** Its own sheets, in the shape `drawn` answers with - kept, not made per frame. */
  private readonly current: { faces: FaceSheet; backs: BackSheet };

  // Generic in the suit, because a game that declares one with `defineSuits`
  // has to be able to draw it.
  constructor(board: Board, readonly card: Card<S>, style: CardStyle = {}) {
    super(board);
    this.sheets = CardSheets.of(board);
    this.boardRatio = board.pixelRatio;
    this.waitForArt = board.waitForArt;
    this.resolved = resolveStyle(style, board.pixelRatio);
    this.faces = this.sheets.acquireFaces(this.resolved);
    this.backs = this.sheets.acquireBack(this.resolved);
    this.current = { faces: this.faces, backs: this.backs };
    this.shadow = style.shadow ?? 1;
    this.attach();
  }

  /** The face layout, as measured for this card's size. */
  get metrics(): CardFaceMetrics {
    return this.faces.metrics;
  }

  /** The sheet of faces this card is drawn from. Shared with its whole deck. */
  get sheet(): FaceSheet {
    return this.faces;
  }

  /**
   * Draws it in another style - another deck, size or stock. The card moves
   * to that style's sheets; the ones it leaves are kept by the engine for
   * whoever wants them next.
   */
  restyle(style: CardStyle): this {
    const next = resolveStyle(style, this.boardRatio);
    // On a board that waits for art, a card already showing a finished look
    // goes on showing it until the new one is finished - so a deck switched
    // or a size dragged never blinks the cards out. The look it is leaving
    // stays held till then.
    const showing = this.waitForArt
      ? this.held ?? (this.faces.ready() && this.backs.ready() ? { faces: this.faces, backs: this.backs } : undefined)
      : undefined;
    const faces = this.sheets.acquireFaces(next, showing !== undefined);
    const backs = this.sheets.acquireBack(next);
    if (showing && !this.held) {
      this.held = showing;
    } else {
      this.sheets.releaseFaces(this.faces);
      this.sheets.releaseBack(this.backs);
    }
    this.faces = faces;
    this.backs = backs;
    this.resolved = next;
    if (style.shadow !== undefined) this.shadow = style.shadow;
    this.board.touch();
    return this;
  }

  get width(): number { return this.metrics.width; }
  get height(): number { return this.metrics.height; }

  /**
   * What this card looks like, for anything caching a picture of it. The side
   * it is showing is part of the answer.
   */
  get look(): string {
    return `${this.faces.key}|${this.backs.key}|${this.shownFace ? 'up' : 'down'}`;
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
    const turns = Math.round(this.shown.turn / Math.PI);
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

  /**
   * Whether it is being drawn: on a board that waits for art, not until its
   * sheets - or the look it is changing from - are finished.
   */
  get revealed(): boolean {
    return this.drawn() !== undefined;
  }

  /** The sheets it is drawn from this frame, if any. */
  private drawn(): { faces: FaceSheet; backs: BackSheet } | undefined {
    if (!this.waitForArt || (this.faces.ready() && this.backs.ready())) {
      if (this.held) {
        this.sheets.releaseFaces(this.held.faces);
        this.sheets.releaseBack(this.held.backs);
        this.held = undefined;
      }
      this.current.faces = this.faces;
      this.current.backs = this.backs;
      return this.current;
    }
    return this.held;
  }

  /** The two pictures it is showing, for tests and for anything snapshotting a card. */
  get regions(): { face: Region; back: Region } {
    return { face: this.faces.cell(this.card.suit, this.card.rank), back: this.backs.region };
  }

  /** Makes sure the face it shows is painted, before the frame is drawn. */
  override prepare(): void {
    const frame = this.boardFrames();
    this.face(this.faces).shownAt = frame;
    this.backs.region.shownAt = frame;
    if (this.held) {
      this.held.faces.cell(this.card.suit, this.card.rank).shownAt = frame;
      this.held.backs.region.shownAt = frame;
    }
  }

  private boardFrames(): number {
    return (this.board as unknown as { frames: number }).frames;
  }

  override destroy(): void {
    if (this.destroyed) return;
    if (this.held) {
      this.sheets.releaseFaces(this.held.faces);
      this.sheets.releaseBack(this.held.backs);
      this.held = undefined;
    }
    this.sheets.releaseFaces(this.faces);
    this.sheets.releaseBack(this.backs);
    super.destroy();
  }

  /** A drawn card is solid: nothing exactly under it shows. */
  override opaqueBody(): boolean {
    return this._visible && this._alpha >= 1 && this.drawn() !== undefined;
  }

  writeInstance(out: Float32Array, o: number): boolean | number {
    if (!this._visible || this._alpha <= 0 || this.occluded) return false;
    // Not drawn at all until its art is finished: no card is ever seen
    // half-painted and then filling in.
    const sheets = this.drawn();
    if (!sheets) return false;
    const m = sheets.faces.metrics;
    const up = this.shownFace;
    // Asked of the sheet every frame, so a card whose rank or suit changed
    // shows the new face with nobody telling it to. `prepare` has already
    // had it painted, so this is a lookup.
    const face = this.face(sheets.faces);
    const backRegion = sheets.backs.region;
    const front = up ? face : backRegion;
    const back = up ? backRegion : face;
    const p = this.writePose(out, o);
    const sx = Math.abs(p.scaleX);
    const sy = Math.abs(p.scaleY);
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
    const faceEdge = packColor(sheets.faces.edge);
    const backEdge = packColor(sheets.backs.color);
    out[o + 24] = up ? faceEdge : backEdge;
    out[o + 25] = up ? backEdge : faceEdge;
    out[o + 26] = (up ? FACE_EDGE : BACK_EDGE) * sx;
    out[o + 27] = (up ? BACK_EDGE : FACE_EDGE) * sx;
    out[o + 28] = 0xffffff;
    out[o + 29] = p.lens;
    out[o + 30] = 0;
    out[o + 31] = 0;
    // In the air - picked up, thrown - its shadow is cast on the felt rather
    // than drawn round it in its own plane: a card rolled forty degrees above
    // the table should not carry a halo rolled forty degrees with it. So the
    // shadow is an instance of its own, flat on the table under the card,
    // drawn first; the card after it, without one.
    const shadow = out[o + 23];
    if (p.z > 0.5 && shadow > 0) {
      out.copyWithin(o + FLOATS, o, o + FLOATS);
      out[o + FLOATS + 23] = 0;
      out[o + 2] = 0;                                   // on the felt
      out[o + 4] = 0;                                   // and flat on it,
      out[o + 5] = 0;
      out[o + 6] = 0;
      // the shape the card's footprint makes from above as it rolls and tips
      out[o + 8] *= Math.max(0.15, Math.abs(Math.cos(p.turn)));
      out[o + 9] *= Math.max(0.15, Math.abs(Math.cos(p.tilt)));
      out[o + 22] = 2;                                  // a shadow and nothing else
      out[o + 29] = 0;
      out[o + 30] = p.z;                                // how high the card is
      return 2;
    }
    return true;
  }
}

export { FLOATS };
