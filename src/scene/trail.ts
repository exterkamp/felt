import { INSTANCE_FLOATS } from '../gl/shaders.js';
import type { TrailRequest } from '../gl/renderer.js';
import type { Node } from './node.js';

// A trail: where things have been, left on the felt.
//
// One picture the size of the board, under everything on it, that nodes
// are stamped into and that is never rubbed out until it is cleared - the
// streak a card leaves bouncing across the table at the end of a won game
// of solitaire. A stamp is the node exactly as it would be drawn at that
// moment, written down then and drawn into the picture on the next frame;
// the node goes on moving and being drawn as itself.
//
// It is the board's own: at most one, made by `board.trail()`, and drawn
// before anything else so everything on the board is above it. It lives on
// the GPU and nowhere else, so a lost context loses it - it comes back
// empty, which for a picture of where things used to be is no loss.

export interface TrailHost {
  touch(): void;
  /** Called when the trail is destroyed, to let go of the GPU's copy. */
  dropTrail(): void;
}

export class Trail {
  /** What the renderer reads each frame. */
  readonly request: TrailRequest = {
    on: true, stamps: new Float32Array(INSTANCE_FLOATS * 64), count: 0, bowed: false, clear: false, alpha: 1,
  };
  private destroyed = false;

  constructor(private readonly board: TrailHost) {}

  /** Stamps a node into the trail where and as it is now. */
  stamp(node: Node): void {
    if (this.destroyed) return;
    const r = this.request;
    // Two instances' room: a card in the air writes its shadow too.
    const need = (r.count + 2) * INSTANCE_FLOATS;
    if (r.stamps.length < need) {
      const grown = new Float32Array(Math.max(need, r.stamps.length * 2));
      grown.set(r.stamps.subarray(0, r.count * INSTANCE_FLOATS));
      r.stamps = grown;
    }
    node.prepare();
    const wrote = Number(node.writeInstance(r.stamps, r.count * INSTANCE_FLOATS));
    for (let k = 0; k < wrote; k++) {
      if (r.stamps[r.count * INSTANCE_FLOATS + 6] !== 0) r.bowed = true;
      r.count++;
    }
    if (wrote) this.board.touch();
  }

  /** How strongly the whole trail shows, 0-1. Tweenable. */
  get alpha(): number { return this.request.alpha; }
  set alpha(v: number) {
    if (v === this.request.alpha) return;
    this.request.alpha = v;
    this.board.touch();
  }

  /** Rubs it all out. */
  clear(): void {
    this.request.clear = true;
    this.request.count = 0;
    this.board.touch();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Takes it off the board, and frees its picture. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.request.on = false;
    this.request.count = 0;
    this.board.dropTrail();
    this.board.touch();
  }
}
