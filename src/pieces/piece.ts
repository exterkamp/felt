import type { Painter, Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
import { FLOATS, Node, packColor, writeRegion } from '../scene/node.js';

// A piece that is not a card: a chip, a button, a die's face, a peg, the
// peg board itself.
//
// Drawn exactly as a card is - one instance, a body the shader cuts out of
// a picture in the atlas, a hairline round it, the soft shadow it casts on
// the felt - only round (a radius half its width) or in the shape asked for.
// So a chip on a card and a card on a chip sort, shadow and pick like any two
// cards, it costs one instance a frame, lifts and swings when it is dragged,
// and a throw or a flick moves it like a card, because it is one as far as
// the engine is concerned.
//
// The pictures are the board's `PieceArt`: each distinct look is painted
// once into the atlas and shared by every piece that wears it, counted, and
// repainted from how it was painted when the GPU loses it.

/** The board's piece pictures: one region per look, shared and counted. */
export class PieceArt {
  private constructor(private readonly board: Board) {}

  /** The board's, made on first use. */
  static of(board: Board): PieceArt {
    let art = board.services.get('piece-art') as PieceArt | undefined;
    if (!art) {
      art = new PieceArt(board);
      board.services.set('piece-art', art);
    }
    return art;
  }

  /** How many distinct pictures have been painted, for anyone measuring. */
  painted = 0;

  /**
   * The picture for a look, painted the first time it is asked for, at the
   * board's density: `paint` draws in board units in a box `width` by
   * `height`. Counted: give it back with `release`.
   *
   * `font`, when the picture has words in it: if it is not loaded yet the
   * picture is painted now in the fallback and again, in place, once it is.
   */
  region(key: string, width: number, height: number, paint: (pen: CanvasRenderingContext2D, w: number, h: number) => void,
    font?: string): Region {
    const atlas = this.board.atlas;
    // Never bigger than a page: a large board is drawn a little softer.
    const ratio = Math.min(this.board.pixelRatio, (atlas.size - 8) / Math.max(width, height));
    const full = `piece:${key}@${ratio.toFixed(3)}`;
    const painter: Painter = (pen) => {
      pen.save();
      pen.scale(ratio, ratio);
      paint(pen as CanvasRenderingContext2D, width, height);
      pen.restore();
    };
    const known = atlas.has(full);
    const region = atlas.obtain(full, Math.ceil(width * ratio), Math.ceil(height * ratio), painter);
    if (!known) {
      this.painted++;
      const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
      if (font && fonts && !fonts.check(font)) {
        void fonts.load(font).then(() => {
          if (!this.board.isDestroyed && region.key === full) atlas.paint(region, painter);
        }, () => {});
      }
    }
    return region;
  }

  release(region: Region | undefined): void {
    this.board.atlas.release(region);
  }
}

export interface PieceLook {
  /** The picture on top, from `PieceArt.region`. */
  face: Region;
  /** The picture underneath, seen when it is turned over. Default the face. */
  back?: Region;
  width: number;
  height: number;
  /** Of the corners: half the smaller side is round. Default round. */
  radius?: number;
  /** The hairline round its edge, 0xrrggbb, and how wide. Default a dark line, 0.6. */
  edge?: number;
  edgeWidth?: number;
  /** How dark its shadow is, 0-1. Default 1. */
  shadow?: number;
}

/**
 * Something on the board drawn as a shaped, shadowed body with a picture
 * on it. The chips, buttons, dice and pegs are all these.
 */
export class Piece extends Node {
  private look: Required<Omit<PieceLook, 'back'>> & { back: Region };
  private readonly art: PieceArt;
  private readonly frameOf: () => number;
  /** What kind of piece, and whatever the game hangs off it. */
  kind = 'piece';

  constructor(board: Board, look: PieceLook) {
    super(board);
    this.art = PieceArt.of(board);
    this.frameOf = () => (board as unknown as { frames: number }).frames;
    this.look = Piece.resolve(look);
    this.attach();
  }

  private static resolve(look: PieceLook): Required<Omit<PieceLook, 'back'>> & { back: Region } {
    return {
      face: look.face,
      back: look.back ?? look.face,
      width: look.width,
      height: look.height,
      radius: look.radius ?? Math.min(look.width, look.height) / 2,
      edge: look.edge ?? 0x1a1a1a,
      edgeWidth: look.edgeWidth ?? 0.6,
      shadow: look.shadow ?? 1,
    };
  }

  get width(): number { return this.look.width; }
  get height(): number { return this.look.height; }
  get radius(): number { return this.look.radius; }
  /** The picture it shows. */
  get face(): Region { return this.look.face; }

  /** Wears another look. The old pictures are given back. */
  restyle(look: PieceLook): this {
    const old = this.look;
    this.look = Piece.resolve(look);
    this.art.release(old.face);
    if (old.back !== old.face) this.art.release(old.back);
    this.board.touch();
    return this;
  }

  get shadowStrength(): number { return this.look.shadow; }
  set shadowStrength(v: number) {
    if (v === this.look.shadow) return;
    this.look.shadow = v;
    this.board.touch();
  }

  /** Round pieces are picked by their circle, not their box. */
  override hitTest(x: number, y: number): boolean {
    if (!this._visible || this.destroyed || this._alpha <= 0) return false;
    const local = this.localPoint(x, y);
    if (!local) return false;
    const hw = this.displayWidth / 2;
    const hh = this.displayHeight / 2;
    const scale = Math.abs(this.shown.scaleX);
    const r = Math.min(this.look.radius * scale, hw, hh);
    const qx = Math.max(0, Math.abs(local.x) - (hw - r));
    const qy = Math.max(0, Math.abs(local.y) - (hh - r));
    return Math.abs(local.x) <= hw && Math.abs(local.y) <= hh && qx * qx + qy * qy <= r * r;
  }

  override prepare(): void {
    const frame = this.frameOf();
    this.look.face.shownAt = frame;
    this.look.back.shownAt = frame;
  }

  override opaqueBody(): boolean {
    return this._visible && this._alpha >= 1;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.art.release(this.look.face);
    if (this.look.back !== this.look.face) this.art.release(this.look.back);
    super.destroy();
  }

  writeInstance(out: Float32Array, o: number): boolean | number {
    if (!this._visible || this._alpha <= 0 || this.occluded) return false;
    const look = this.look;
    const p = this.writePose(out, o);
    const sx = Math.abs(p.scaleX);
    const sy = Math.abs(p.scaleY);
    out[o + 8] = look.width * sx;
    out[o + 9] = look.height * sy;
    out[o + 10] = look.radius * Math.min(sx, sy);
    // Room for the shadow round it, as a card has, in proportion.
    out[o + 11] = (2 + (7 / 60) * Math.min(look.width, look.height)) * Math.max(sx, sy);
    writeRegion(out, o + 12, look.face);
    writeRegion(out, o + 16, look.back);
    out[o + 20] = look.face.page;
    out[o + 21] = look.back.page;
    out[o + 22] = 1;   // a body, as a card is
    out[o + 23] = this.covered ? 0 : look.shadow;
    out[o + 24] = packColor(look.edge);
    out[o + 25] = packColor(look.edge);
    out[o + 26] = look.edgeWidth * sx;
    out[o + 27] = look.edgeWidth * sx;
    out[o + 28] = 0xffffff;
    out[o + 29] = p.lens;
    out[o + 30] = 0;
    // Gloss, as a card's: a tossed chip catches the light as it turns.
    out[o + 31] = p.shine > 0 ? Math.min(1, p.shine) : 0;
    // In the air its shadow is cast flat on the felt below it, the way a
    // lifted card's is (see CardSprite).
    const shadow = out[o + 23];
    if (p.z > 0.5 && shadow > 0) {
      out.copyWithin(o + FLOATS, o, o + FLOATS);
      out[o + FLOATS + 23] = 0;
      out[o + 2] = 0;
      out[o + 4] = 0;
      out[o + 5] = 0;
      out[o + 6] = 0;
      out[o + 31] = 0;   // a shadow does not shine
      out[o + 8] *= Math.max(0.15, Math.abs(Math.cos(p.turn)));
      out[o + 9] *= Math.max(0.15, Math.abs(Math.cos(p.tilt)));
      out[o + 22] = 2;
      out[o + 29] = 0;
      out[o + 30] = p.z;
      return 2;
    }
    return true;
  }
}
