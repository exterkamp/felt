// A frame of reference: somewhere nodes can be put that is turned, moved
// and scaled as one.
//
// Not a container. It draws nothing, holds no list and has no say in the
// order things are drawn in - the board still sorts every node by depth,
// whatever group it is in, which is the whole reason felt has no containers
// (see node.ts). What a group does is the one thing a container was good
// for: a player's side of the table laid out once, in its own upright
// coordinates, then turned to face its edge of the table and shrunk to fit.
// A node in a group keeps its own x, y and angle in the group's frame; what
// is drawn, picked and lifted is that pose carried out into the board's.
//
// Groups nest: a group may itself be in a group.

/** What a group needs from the board it belongs to. */
export interface GroupHost {
  touch(): void;
}

/** A pose in a frame: where it is, which way it points, how big. */
export interface FramePose {
  x: number;
  y: number;
  /** Degrees. */
  angle: number;
  scaleX: number;
  scaleY: number;
}

export class Group {
  private _x = 0;
  private _y = 0;
  private _angle = 0;
  private _scale = 1;
  private _parent: Group | undefined;

  constructor(private readonly board: GroupHost, options: {
    x?: number; y?: number; angle?: number; scale?: number; parent?: Group;
  } = {}) {
    this._x = options.x ?? 0;
    this._y = options.y ?? 0;
    this._angle = options.angle ?? 0;
    this._scale = options.scale ?? 1;
    this._parent = options.parent;
  }

  get x(): number { return this._x; }
  set x(v: number) { if (v !== this._x) { this._x = v; this.board.touch(); } }
  get y(): number { return this._y; }
  set y(v: number) { if (v !== this._y) { this._y = v; this.board.touch(); } }
  /** Degrees, as a node's. */
  get angle(): number { return this._angle; }
  set angle(v: number) { if (v !== this._angle) { this._angle = v; this.board.touch(); } }
  /** Radians, for code that thinks in them. */
  get rotation(): number { return (this._angle * Math.PI) / 180; }
  set rotation(v: number) { this.angle = (v * 180) / Math.PI; }
  /** Uniform: a frame stretched one way would shear a card that turns in it. */
  get scale(): number { return this._scale; }
  set scale(v: number) { if (v !== this._scale) { this._scale = v; this.board.touch(); } }
  get parent(): Group | undefined { return this._parent; }
  set parent(v: Group | undefined) {
    for (let g = v; g; g = g._parent) if (g === this) throw new Error('felt: a group cannot be inside itself');
    this._parent = v;
    this.board.touch();
  }

  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setAngle(degrees: number): this { this.angle = degrees; return this; }
  setRotation(radians: number): this { this.rotation = radians; return this; }
  setScale(scale: number): this { this.scale = scale; return this; }

  /**
   * Carries a pose in this group's frame out into the board's, in place.
   * Lift (`z`) is scaled with everything else, so a card picked up in a
   * small frame rises a small amount.
   */
  toBoardPose<P extends FramePose & { z?: number }>(pose: P): P {
    for (let g: Group | undefined = this; g; g = g._parent) {
      const a = (g._angle * Math.PI) / 180;
      const c = Math.cos(a) * g._scale;
      const s = Math.sin(a) * g._scale;
      const x = pose.x;
      const y = pose.y;
      pose.x = g._x + x * c - y * s;
      pose.y = g._y + x * s + y * c;
      pose.angle += g._angle;
      pose.scaleX *= g._scale;
      pose.scaleY *= g._scale;
      if (pose.z !== undefined) pose.z *= g._scale;
    }
    return pose;
  }

  /** A point in this group's frame, on the board. */
  toBoard(x: number, y: number): { x: number; y: number } {
    const p = this.toBoardPose({ x, y, angle: 0, scaleX: 1, scaleY: 1 });
    return { x: p.x, y: p.y };
  }

  /** A point on the board, in this group's frame. */
  fromBoard(x: number, y: number): { x: number; y: number } {
    const chain: Group[] = [];
    for (let g: Group | undefined = this; g; g = g._parent) chain.unshift(g);
    let px = x;
    let py = y;
    for (const g of chain) {
      const a = (-g._angle * Math.PI) / 180;
      const dx = (px - g._x) / g._scale;
      const dy = (py - g._y) / g._scale;
      px = dx * Math.cos(a) - dy * Math.sin(a);
      py = dx * Math.sin(a) + dy * Math.cos(a);
    }
    return { x: px, y: py };
  }

  /** The whole chain's turn and size, as seen on the board. */
  get boardAngle(): number {
    let a = 0;
    for (let g: Group | undefined = this; g; g = g._parent) a += g._angle;
    return a;
  }

  get boardScale(): number {
    let s = 1;
    for (let g: Group | undefined = this; g; g = g._parent) s *= g._scale;
    return s;
  }
}
