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

  // Generic in the suit, because a game that declares one with `defineSuits`
  // has to be able to draw it.
  constructor(board: Board, readonly card: Card<S>, style: CardStyle = {}) {
    super(board);
    this.sheets = CardSheets.of(board);
    this.boardRatio = board.pixelRatio;
    this.resolved = resolveStyle(style, board.pixelRatio);
    this.faces = this.sheets.acquireFaces(this.resolved);
    this.backs = this.sheets.acquireBack(this.resolved);
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
    const faces = this.sheets.acquireFaces(next);
    const backs = this.sheets.acquireBack(next);
    this.sheets.releaseFaces(this.faces);
    this.sheets.releaseBack(this.backs);
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

  /** The two pictures it is showing, for tests and for anything snapshotting a card. */
  get regions(): { face: Region; back: Region } {
    return { face: this.faces.cell(this.card.suit, this.card.rank), back: this.backs.region };
  }

  /** Makes sure the face it shows is painted, before the frame is drawn. */
  override prepare(): void {
    const frame = this.boardFrames();
    this.faces.cell(this.card.suit, this.card.rank).shownAt = frame;
    this.backs.region.shownAt = frame;
  }

  private boardFrames(): number {
    return (this.board as unknown as { frames: number }).frames;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.sheets.releaseFaces(this.faces);
    this.sheets.releaseBack(this.backs);
    super.destroy();
  }

  writeInstance(out: Float32Array, o: number): boolean {
    if (!this._visible || this._alpha <= 0) return false;
    const m = this.faces.metrics;
    const sx = Math.abs(this._scaleX);
    const sy = Math.abs(this._scaleY);
    const up = this.shownFace;
    // Asked of the sheet every frame, so a card whose rank or suit changed
    // shows the new face with nobody telling it to. `prepare` has already
    // had it painted, so this is a lookup.
    const face = this.faces.cell(this.card.suit, this.card.rank);
    const backRegion = this.backs.region;
    const front = up ? face : backRegion;
    const back = up ? backRegion : face;
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
    const faceEdge = packColor(this.faces.edge);
    const backEdge = packColor(this.resolved.backColor);
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
}

export { FLOATS };
