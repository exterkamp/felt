import type { Painter, Region } from '../gl/atlas.js';
import { FLOATS, Node, NodeHost, packColor, writeRegion } from './node.js';

// A picture on the board that is not a card: a label, a slot outline, the
// faint pip printed in an empty foundation. Drawn by the same instanced call
// as the cards - a sprite is a card with no body, no edge and no shadow - so
// a label between two piles costs nothing and sorts between them properly.

export interface SpriteOptions {
  x?: number;
  y?: number;
  /** Display size in board units. Defaults to the region at the board's ratio. */
  width?: number;
  height?: number;
  depth?: number;
  alpha?: number;
  angle?: number;
  /** Multiplied into the picture, 0xrrggbb. */
  tint?: number;
  /** Where (0-1 of its size) its x, y is. Default the middle. */
  originX?: number;
  originY?: number;
}

export interface SpriteHost extends NodeHost {
  readonly pixelRatio: number;
}

export class Sprite extends Node {
  private _region: Region | undefined;
  private _width: number;
  private _height: number;
  private _tint: number;
  originX: number;
  originY: number;
  /** Lets go of the region when destroyed. */
  private readonly owned: boolean;

  constructor(board: SpriteHost, region: Region | undefined, options: SpriteOptions = {}, owned = false) {
    super(board);
    this._region = region;
    this.owned = owned;
    this._width = options.width ?? (region ? region.width / board.pixelRatio : 0);
    this._height = options.height ?? (region ? region.height / board.pixelRatio : 0);
    this._tint = options.tint ?? 0xffffff;
    this.originX = options.originX ?? 0.5;
    this.originY = options.originY ?? 0.5;
    this._x = options.x ?? 0;
    this._y = options.y ?? 0;
    this._angle = options.angle ?? 0;
    this._alpha = options.alpha ?? 1;
    this._depth = options.depth ?? 0;
    this.attach();
  }

  get width(): number { return this._width; }
  set width(v: number) { this._width = v; this.board.touch(); }
  get height(): number { return this._height; }
  set height(v: number) { this._height = v; this.board.touch(); }
  get tint(): number { return this._tint; }
  set tint(v: number) { this._tint = v; this.board.touch(); }
  get region(): Region | undefined { return this._region; }
  set region(v: Region | undefined) { this._region = v; this.board.touch(); }

  setDisplaySize(width: number, height: number): this {
    this._width = width;
    this._height = height;
    this.board.touch();
    return this;
  }

  setOrigin(x: number, y = x): this {
    this.originX = x;
    this.originY = y;
    this.board.touch();
    return this;
  }

  override hitTest(x: number, y: number): boolean {
    if (!this._visible || this.destroyed || this._alpha <= 0) return false;
    const local = this.localPoint(x, y);
    if (!local) return false;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const lx = local.x + (this.originX - 0.5) * w;
    const ly = local.y + (this.originY - 0.5) * h;
    return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
  }

  override destroy(): void {
    if (this.destroyed) return;
    if (this.owned) this.releaseRegion();
    super.destroy();
  }

  protected releaseRegion(): void {
    const region = this._region;
    if (region) region.refs = Math.max(0, region.refs - 1);
  }

  writeInstance(out: Float32Array, o: number): boolean {
    const region = this._region;
    if (!this._visible || this._alpha <= 0 || !region) return false;
    const p = this.writePose(out, o);
    const w = this._width * p.scaleX;
    const h = this._height * p.scaleY;
    // The origin is applied by moving the centre, along the sprite's own
    // turned axes, so a label anchored at its left edge rotates about it.
    const dx = (0.5 - this.originX) * w;
    const dy = (0.5 - this.originY) * h;
    const a = (p.angle * Math.PI) / 180;
    out[o] = p.x + dx * Math.cos(a) - dy * Math.sin(a);
    out[o + 1] = p.y + dx * Math.sin(a) + dy * Math.cos(a);
    out[o + 8] = Math.abs(w);
    out[o + 9] = Math.abs(h);
    out[o + 10] = 0;
    out[o + 11] = 0;
    writeRegion(out, o + 12, region);
    writeRegion(out, o + 16, region);
    out[o + 20] = region.page;
    out[o + 21] = region.page;
    out[o + 22] = 0;   // a sprite
    out[o + 23] = 0;   // no shadow
    out[o + 24] = 0;
    out[o + 25] = 0;
    out[o + 26] = 0;
    out[o + 27] = 0;
    out[o + 28] = packColor(this._tint);
    out[o + 29] = 0;
    out[o + 30] = 0;
    out[o + 31] = 0;
    return true;
  }
}

/** A sprite whose picture is something drawn with Canvas 2D. */
export interface PaintedOptions extends SpriteOptions {
  /** Cache key. Two sprites with one key share one picture. */
  key?: string;
}

/** Re-exported for anything painting its own sprites. */
export type { Painter };
export { FLOATS };
