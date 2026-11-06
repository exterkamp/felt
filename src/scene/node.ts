import type { Region } from '../gl/atlas.js';
import { INSTANCE_FLOATS } from '../gl/shaders.js';
import type { InstanceItem } from '../gl/renderer.js';
import { Mat3, cardRotation, unprojectOntoPlane } from '../gl/lens.js';
import type { Layered, Offset } from './animator.js';

// Anything drawn on the board: a position, an orientation, a size and a
// place in the order.
//
// The fields are the ones Phaser had, under the same names - `x`, `y`,
// `angle` in degrees, `scaleX`, `alpha`, `depth`, `visible` - so code that
// tweened a sprite tweens one of these unchanged. Three are new, and they are
// the reason this is not Phaser: `z` lifts it off the table, `tilt` and
// `turn` (radians) tip it out of the plane, and a card can `bow`. None of
// them costs anything when it is zero; a flat game never has to know.
//
// **Depth sorts, always.** Phaser's Container painted in list order and
// ignored `setDepth`, which once silently turned every first-on-top pile into
// a last-on-top one. Here there is no container: the board keeps one list,
// sorted by depth and then by the order things were made, and that is the
// order they are drawn in.

/** What a node needs from the board it is on. */
export interface NodeHost {
  readonly distance: number;
  readonly localLens: boolean;
  readonly vanishX: number;
  readonly vanishY: number;
  touch(): void;
  resort(): void;
  attach(node: Node): void;
  detach(node: Node): void;
}

let serial = 0;

export abstract class Node implements InstanceItem, Layered {
  readonly drawKind = 'instance' as const;
  readonly serial = serial++;
  protected _x = 0;
  protected _y = 0;
  protected _z = 0;
  protected _angle = 0;
  protected _tilt = 0;
  protected _turn = 0;
  protected _bow = 0;
  protected _scaleX = 1;
  protected _scaleY = 1;
  protected _alpha = 1;
  protected _depth = 0;
  protected _visible = true;
  protected destroyed = false;
  /** What running canned animations add to the pose, drawn but not stored. */
  private readonly offsets: Offset[] = [];
  /** Whether a pointer can pick it. */
  interactive = false;
  /** Whether the board should drag it about when picked. Implies interactive. */
  draggable = false;
  /**
   * Set by the board each frame when the next thing drawn sits exactly on top
   * of this one. Its shadow would be hidden under the other's, except at the
   * halo - where fifty-two of them stacked turn into a black rim. So a buried
   * card casts nothing, and a squared deck has one card's shadow.
   */
  covered = false;
  /**
   * Covered, and by something solid: not drawn at all. Set each frame by the
   * board. A pile of fifty-two drawn as one card, not fifty-two stacked
   * exactly on top of each other - fifty-one of which no pixel shows.
   */
  occluded = false;
  /** Anything a game wants to hang off it. */
  data: Record<string, unknown> = {};

  /**
   * Not on the board yet: a subclass calls `attach()` as the last line of its
   * constructor. Attaching here, first, meant a constructor that threw half
   * way left a half-built node in the draw list, breaking every frame after.
   */
  constructor(readonly board: NodeHost) {}

  /** Puts it on the board. Once, at the end of a subclass's constructor. */
  protected attach(): void {
    this.board.attach(this);
  }

  /** Its size before scaling, in board units. */
  abstract get width(): number;
  abstract get height(): number;

  get x(): number { return this._x; }
  set x(v: number) { if (v !== this._x) { this._x = v; this.board.touch(); } }
  get y(): number { return this._y; }
  set y(v: number) { if (v !== this._y) { this._y = v; this.board.touch(); } }
  /** Height above the table, towards the camera. */
  get z(): number { return this._z; }
  set z(v: number) { if (v !== this._z) { this._z = v; this.board.touch(); } }
  /** Degrees, clockwise, in the plane of the table. Not wrapped. */
  get angle(): number { return this._angle; }
  set angle(v: number) { if (v !== this._angle) { this._angle = v; this.board.touch(); } }
  /** Radians the top edge is tipped away from the camera. */
  get tilt(): number { return this._tilt; }
  set tilt(v: number) { if (v !== this._tilt) { this._tilt = v; this.board.touch(); } }
  /** Radians about its own long axis. Half a turn shows the other side. */
  get turn(): number { return this._turn; }
  set turn(v: number) { if (v !== this._turn) { this._turn = v; this.board.touch(); } }
  /** How deep the bow down its length is, as a fraction of its height. */
  get bow(): number { return this._bow; }
  set bow(v: number) { if (v !== this._bow) { this._bow = v; this.board.touch(); } }
  get scaleX(): number { return this._scaleX; }
  set scaleX(v: number) { if (v !== this._scaleX) { this._scaleX = v; this.board.touch(); } }
  get scaleY(): number { return this._scaleY; }
  set scaleY(v: number) { if (v !== this._scaleY) { this._scaleY = v; this.board.touch(); } }
  /** Both scales, read as x. */
  get scale(): number { return this._scaleX; }
  set scale(v: number) { this.scaleX = v; this.scaleY = v; }
  get alpha(): number { return this._alpha; }
  set alpha(v: number) { if (v !== this._alpha) { this._alpha = v; this.board.touch(); } }
  get visible(): boolean { return this._visible; }
  set visible(v: boolean) { if (v !== this._visible) { this._visible = v; this.board.touch(); } }
  /** Draw order: higher is in front. Ties go to whichever was made later. */
  get depth(): number { return this._depth; }
  set depth(v: number) { if (v !== this._depth) { this._depth = v; this.board.resort(); } }

  get displayWidth(): number { return this.width * Math.abs(this.shown.scaleX); }
  get displayHeight(): number { return this.height * Math.abs(this.shown.scaleY); }
  get isDestroyed(): boolean { return this.destroyed; }

  // Phaser's chainable setters, for code that came from there.
  setPosition(x: number, y: number, z = this._z): this { this.x = x; this.y = y; this.z = z; return this; }
  setAngle(degrees: number): this { this.angle = degrees; return this; }
  setScale(x: number, y = x): this { this.scaleX = x; this.scaleY = y; return this; }
  setAlpha(alpha: number): this { this.alpha = alpha; return this; }
  setDepth(depth: number): this { this.depth = depth; return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  setInteractive(draggable = false): this { this.interactive = true; this.draggable = draggable; return this; }

  addOffset(offset: Offset): void {
    this.offsets.push(offset);
    this.board.touch();
  }

  removeOffset(offset: Offset): void {
    const at = this.offsets.indexOf(offset);
    if (at >= 0) this.offsets.splice(at, 1);
    this.board.touch();
  }

  offsetChanged(): void {
    this.board.touch();
  }

  /**
   * The pose actually drawn: the resting pose plus whatever canned
   * animations are adding to it - a flip's lift and roll, a landing's pop.
   * The fields (`x`, `z`, `turn` ...) are the resting pose and never hold
   * an animation's transient value, which is what keeps one animation from
   * starting off another's half-way point.
   */
  get shown(): { x: number; y: number; z: number; angle: number; tilt: number; turn: number;
    bow: number; scaleX: number; scaleY: number } {
    const pose = {
      x: this._x, y: this._y, z: this._z, angle: this._angle, tilt: this._tilt,
      turn: this._turn, bow: this._bow, scaleX: this._scaleX, scaleY: this._scaleY,
    };
    for (const o of this.offsets) {
      pose.x += o.x; pose.y += o.y; pose.z += o.z; pose.angle += o.angle;
      pose.tilt += o.tilt; pose.turn += o.turn; pose.bow += o.bow;
      pose.scaleX *= o.scale; pose.scaleY *= o.scale;
    }
    return pose;
  }

  /** Its orientation, as the shader builds it. */
  rotation(): Mat3 {
    const p = this.shown;
    return cardRotation((p.angle * Math.PI) / 180, p.tilt, p.turn);
  }

  /**
   * Where a point on the board meets this node, in its own units from its
   * centre - or undefined if it misses.
   *
   * Through the same lens the screen uses, so a card tipped towards the
   * camera is picked where it is drawn rather than where it lies.
   */
  localPoint(x: number, y: number): { x: number; y: number } | undefined {
    const board = this.board;
    const p = this.shown;
    const cx = board.localLens ? p.x : board.vanishX;
    const cy = board.localLens ? p.y : board.vanishY;
    return unprojectOntoPlane(x, y, [p.x, p.y, p.z], this.rotation(), cx, cy, board.distance);
  }

  /** Whether a point on the board is over this node. */
  hitTest(x: number, y: number): boolean {
    if (!this._visible || this.destroyed || this._alpha <= 0) return false;
    const local = this.localPoint(x, y);
    if (!local) return false;
    return Math.abs(local.x) <= this.displayWidth / 2 && Math.abs(local.y) <= this.displayHeight / 2;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.board.detach(this);
  }

  abstract writeInstance(out: Float32Array, offset: number): boolean;

  /**
   * Called on every visible node just before a frame is drawn, for work that
   * has to be done before its picture can be - a card's face being painted
   * the first time anything shows it.
   */
  prepare(): void { /* nothing, for most */ }

  /** Whether another node sits exactly where this one does, covering it. */
  /**
   * Whether it hides everything with its footprint underneath it: an opaque
   * shape drawn this frame. A card is; a sprite (which may have holes) is not.
   */
  opaqueBody(): boolean {
    return false;
  }

  sameFootprint(other: Node): boolean {
    if (this.offsets.length || other.offsets.length) return false;
    return other._x === this._x && other._y === this._y && other._z === this._z
      && other._angle === this._angle && other._tilt === this._tilt && other._turn === this._turn
      && other._bow === this._bow && other._scaleX === this._scaleX && other._scaleY === this._scaleY
      && other.width === this.width && other.height === this.height
      && other._visible && other._alpha >= 1;
  }

  /** The first two vec4s, which every node fills the same way. */
  /** Writes the shown pose, and hands it back for the rest of the instance. */
  protected writePose(out: Float32Array, o: number): ReturnType<Node['writePoseValues']> {
    const p = this.writePoseValues();
    out[o] = p.x;
    out[o + 1] = p.y;
    out[o + 2] = p.z;
    out[o + 3] = (p.angle * Math.PI) / 180;
    out[o + 4] = p.tilt;
    out[o + 5] = p.turn;
    out[o + 6] = p.bow;
    out[o + 7] = this._alpha;
    return p;
  }

  /**
   * The pose as drawn, into an object the node keeps: written every frame
   * for every node, so a fresh one each time was thousands of allocations a
   * frame on a busy table. Valid until the next call.
   */
  private writePoseValues(): Node['shown'] {
    if (this.offsets.length) return this.shown;
    const p = this.drawnPose;
    p.x = this._x; p.y = this._y; p.z = this._z; p.angle = this._angle; p.tilt = this._tilt;
    p.turn = this._turn; p.bow = this._bow; p.scaleX = this._scaleX; p.scaleY = this._scaleY;
    return p;
  }

  private readonly drawnPose: Node['shown'] = {
    x: 0, y: 0, z: 0, angle: 0, tilt: 0, turn: 0, bow: 0, scaleX: 1, scaleY: 1,
  };
}

/** Packs a 0xrrggbb color into one float the shader unpacks exactly. */
export const packColor = (color: number): number => color & 0xffffff;

export function writeRegion(out: Float32Array, o: number, region: Region | undefined): void {
  if (!region) {
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
    return;
  }
  out[o] = region.u0;
  out[o + 1] = region.v0;
  out[o + 2] = region.u1;
  out[o + 3] = region.v1;
}

export const FLOATS = INSTANCE_FLOATS;
