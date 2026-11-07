import { type Mat3, mul3 } from '../gl/lens.js';
import { animatorOf } from '../scene/animator.js';
import type { Board } from '../scene/board.js';
import { Node } from '../scene/node.js';
import { PIECE_DEPTH, PIECE_FLYING_DEPTH } from './chip-stack.js';
import {
  DIE_FACES, cardPose, dieOrientation, dieTumble, faceFrame, faceNormal, rollDice, topFace,
} from './dice.js';
import { CASINO_DICE, type DieStyle, IVORY_DICE, dieFaceLook } from './piece-paint.js';
import { Piece } from './piece.js';

// A die: a real cube of six faces, each drawn as a small card set on the
// cube at its own angle, so it tumbles in three dimensions on the same
// instanced draw as the cards. Only the faces turned towards the camera are
// drawn - a cube is convex, so they never overlap - and one shadow is cast
// on the felt for the whole cube.
//
// Its value is decided before it moves (`roll` is given it, or a seed) and
// the tumble is worked out to land on it: see dice.ts.

export { CASINO_DICE, IVORY_DICE };

/** The one shadow a die casts. A shadow instance and nothing else. */
class DieShadow extends Node {
  w = 0;
  h = 0;
  radius = 0;
  lift = 0;
  strength = 1;
  get width(): number { return this.w; }
  get height(): number { return this.h; }
  constructor(board: Board) { super(board); this.attach(); }
  override hitTest(): boolean { return false; }
  writeInstance(out: Float32Array, o: number): boolean {
    if (!this._visible) return false;
    const p = this.writePose(out, o);
    out[o + 2] = 0;
    out[o + 4] = 0; out[o + 5] = 0; out[o + 6] = 0;
    out[o + 7] = 1;
    out[o + 8] = this.w * p.scaleX;
    out[o + 9] = this.h * p.scaleY;
    out[o + 10] = this.radius;
    out[o + 11] = 2 + this.w * (7 / 60);
    for (let i = 12; i < 22; i++) out[o + i] = 0;
    out[o + 22] = 2;            // a cast shadow
    out[o + 23] = this.strength;
    for (let i = 24; i < 30; i++) out[o + i] = 0;
    out[o + 28] = 0xffffff;
    out[o + 30] = this.lift;    // how high what casts it is
    out[o + 31] = 0;
    return true;
  }
}

export interface DieOptions {
  id?: string;
  x?: number;
  y?: number;
  /** Its edge, board units. Default 34. */
  size?: number;
  /** The face up to start with. Default 1. */
  value?: number;
  /** Degrees, in the plane of the table. */
  yaw?: number;
  style?: DieStyle;
}

export interface RollOptions {
  /** The face it lands on. Left out, it comes from `seed`. */
  value?: number;
  /** Where the result comes from, if `value` is not given, and how it tumbles. */
  seed?: number;
  /** Where it is thrown from. Default where it is. */
  from?: { x: number; y: number };
  /** Where it comes to rest. Default where it is. */
  to?: { x: number; y: number };
  /** Degrees it settles at. Default from the seed. */
  yaw?: number;
  duration?: number;
}

export class Die {
  readonly id: string;
  readonly size: number;
  readonly faces = new Map<number, Piece>();
  private readonly shadow: DieShadow;
  private _x: number;
  private _y: number;
  private _z: number;
  private _rotation: Mat3;
  private _value: number;
  /** What the animator runs the roll on: the die is not a node. */
  private readonly motion = {};
  private destroyed = false;

  constructor(readonly board: Board, options: DieOptions & { id: string }) {
    this.id = options.id;
    this.size = options.size ?? 34;
    this._x = options.x ?? 0;
    this._y = options.y ?? 0;
    this._z = this.size / 2;
    this._value = options.value ?? 1;
    this._rotation = dieOrientation(this._value, ((options.yaw ?? 0) * Math.PI) / 180);
    this.shadow = new DieShadow(board);
    const style = options.style ?? IVORY_DICE;
    for (const face of DIE_FACES) {
      const piece = new Piece(board, dieFaceLook(board, face, this.size, style));
      piece.kind = 'die';
      piece.interactive = true;
      piece.data['die'] = this;
      this.faces.set(face, piece);
    }
    this.pose();
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }
  /** Height of its centre above the felt. */
  get z(): number { return this._z; }
  get rotation(): Mat3 { return this._rotation; }
  /** The face it has landed on, or is going to land on if it is still rolling. */
  get value(): number { return this._value; }
  /** The face pointing up right now, from how it is actually turned. */
  get showing(): number { return topFace(this._rotation); }
  /** The degrees it lies at in the plane, flat on its face. */
  get yaw(): number {
    const top = mul3(this._rotation, faceFrame(this.showing));
    return (cardPose(top).angle * 180) / Math.PI;
  }
  get rolling(): boolean { return animatorOf(this.board).busy(this.motion, 'roll'); }

  /** Sets it down flat on a face, no tumble. */
  set(value: number, x = this._x, y = this._y, yaw = 0): void {
    animatorOf(this.board).stop(this.motion, 'roll');
    this._value = value;
    this._x = x;
    this._y = y;
    this._z = this.size / 2;
    this._rotation = dieOrientation(value, (yaw * Math.PI) / 180);
    this.pose();
  }

  /**
   * Rolls it: thrown from `from` to `to`, tumbling, and landing on `value`
   * (or the face its seed gives). The value is decided at once - `die.value`
   * is the result before it lands. Resolves with it when it has stopped.
   * A die rolled again mid-tumble is thrown again from where it is.
   */
  roll(options: RollOptions = {}): Promise<number> {
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    const value = options.value ?? rollDice(seed, 1)[0];
    if (!DIE_FACES.includes(value as 1)) throw new Error(`felt dice: no face ${value} on a d6`);
    this._value = value;
    let tumble = dieTumble({
      from: options.from ?? { x: this._x, y: this._y }, to: options.to ?? { x: this._x, y: this._y },
      face: value, size: this.size, seed, yaw: options.yaw, duration: options.duration,
    });
    const run = animatorOf(this.board).play(this.motion, {
      channel: 'roll',
      policy: 'interrupt',
      duration: tumble.duration,
      ease: 'Linear',
      start: () => {
        // From however it is turned now: a die caught mid-tumble.
        tumble = dieTumble({
          from: options.from ?? { x: this._x, y: this._y }, to: options.to ?? { x: this._x, y: this._y },
          face: value, size: this.size, seed, yaw: options.yaw, duration: options.duration,
          start: this._rotation,
        });
      },
      update: (t) => {
        const p = tumble.at(t);
        this._x = p.x;
        this._y = p.y;
        this._z = p.z;
        this._rotation = p.rotation;
        this.pose(true);
      },
      complete: () => {
        const p = tumble.at(1);
        this._x = p.x; this._y = p.y; this._z = p.z; this._rotation = p.rotation;
        this.pose();
      },
    });
    return run.then(() => this._value);
  }

  /** Whether a point is over it. */
  contains(x: number, y: number): boolean {
    for (const face of this.faces.values()) if (face.visible && face.hitTest(x, y)) return true;
    return false;
  }

  /** Puts every face where the cube says, and hides the ones turned away. */
  private pose(flying = false): void {
    if (this.destroyed) return;
    const half = this.size / 2;
    const depth = flying ? PIECE_FLYING_DEPTH + 10 + this._z * 0.01 : PIECE_DEPTH + Math.round(this._y) * 256 + 220;
    let up = 0;
    let upAngle = 0;
    for (const [face, piece] of this.faces) {
      const n = faceNormal(this._rotation, face);
      // Edge-on or turned away: a cube's hidden faces are never drawn.
      const visible = n[2] > 0.06;
      piece.visible = visible;
      if (!visible) continue;
      const m = mul3(this._rotation, faceFrame(face));
      const pose = cardPose(m);
      piece.setPosition(this._x + n[0] * half, this._y + n[1] * half, this._z + n[2] * half);
      piece.angle = (pose.angle * 180) / Math.PI;
      piece.tilt = pose.tilt;
      piece.turn = pose.turn;
      piece.depth = depth;
      if (n[2] > up) { up = n[2]; upAngle = piece.angle; }
    }
    // The shadow: the cube's footprint, wider as it rolls up onto an edge.
    const reach = half * (Math.abs(this._rotation[6]) + Math.abs(this._rotation[7]) + Math.abs(this._rotation[8]));
    const s = this.size * (1 + (1 - up) * 0.3);
    this.shadow.w = s;
    this.shadow.h = s;
    this.shadow.radius = this.size * 0.16;
    this.shadow.lift = Math.max(0, this._z - reach);
    this.shadow.setPosition(this._x, this._y, 0);
    this.shadow.angle = upAngle;
    this.shadow.depth = depth - 1;
    this.shadow.offsetChanged();
  }

  destroy(): void {
    if (this.destroyed) return;
    animatorOf(this.board).stop(this.motion);
    this.destroyed = true;
    for (const face of this.faces.values()) face.destroy();
    this.shadow.destroy();
  }
}
