import type { Dispose } from '../runtime/disposables.js';
import type { Engine } from '../runtime/engine.js';
import { cardRotation } from '../gl/lens.js';
import { Offset, zeroOffset } from './animator.js';

// A card picked up off the table.
//
// In three dimensions a dragged card should not slide about on the felt like
// a sticker: it comes up off the table, its shadow falling further away and
// softer the higher it is, and it swings as it is moved - tipping away from
// the direction it is pulled, the way a card held lightly by its middle
// trails through the air - and settles when the hand stops. Put down, it
// drops back onto the felt.
//
// All of that is one offset on the card (lift, tilt, roll, a little sway in
// the table's plane), driven by springs, on top of wherever the game puts the
// card. The game goes on moving the card with `setPosition` as before and
// never sees the swing: nothing here writes the card's own pose, so a pile
// laid out under the pointer, a throw on release, or a flip mid-drag all
// compose with it.

export interface PickUpOptions {
  /** How high it is held, in board units towards the camera. Default 26. */
  lift?: number;
  /** Most it tips or rolls, in radians. Default 0.7 (40 degrees). */
  maxSwivel?: number;
  /** Most it sways in the table's plane, in degrees. Default 12. */
  maxSway?: number;
  /** Radians of swivel per board unit a second of speed. Default 0.0015. */
  swivel?: number;
  /** Degrees of sway per board unit a second of sideways speed. Default 0.022. */
  sway?: number;
  /** Spring stiffness, per second squared. Higher is snappier. Default 150. */
  stiffness?: number;
  /** Fraction of critical damping: below 1 swings past and back. Default 0.62. */
  damping?: number;
  /**
   * Extra perspective while held, so its tipping and rolling read as depth:
   * 1 sees it from half the board's camera distance. Default 1.8.
   */
  perspective?: number;
}

/** What a picked-up card needs to be: something with a pose that wears offsets. */
export interface Liftable {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  addOffset(offset: Offset): void;
  removeOffset(offset: Offset): void;
  offsetChanged(): void;
}

/** One of the four things a held card does, as a damped spring. */
class Spring {
  value = 0;
  speed = 0;
  step(target: number, dt: number, stiffness: number, damping: number): void {
    // Semi-implicit Euler, in small steps: stable at any frame rate.
    const c = 2 * Math.sqrt(stiffness) * damping;
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      this.speed += (stiffness * (target - this.value) - c * this.speed) * h;
      this.value += this.speed * h;
      left -= h;
    }
  }
  settled(target: number): boolean {
    return Math.abs(this.value - target) < 1e-3 && Math.abs(this.speed) < 1e-2;
  }
}

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

interface Held {
  node: Liftable;
  offset: Offset;
  down: boolean;
  lastX: number;
  lastY: number;
  /** Smoothed velocity, board units a second. */
  vx: number;
  vy: number;
  z: Spring;
  tilt: Spring;
  turn: Spring;
  angle: Spring;
  lens: Spring;
}

/** Cards carried with a held one, as one rigid stack. */
interface Carried {
  followers: Liftable[];
  offsets: Offset[];
}

export class PickUp {
  private readonly held = new Map<Liftable, Held>();
  private readonly carried = new Map<Liftable, Carried>();
  private stop?: Dispose;
  readonly options: Required<PickUpOptions>;

  constructor(private readonly engine: Engine, options: PickUpOptions = {}) {
    this.options = {
      lift: options.lift ?? 26,
      maxSwivel: options.maxSwivel ?? 0.7,
      maxSway: options.maxSway ?? 12,
      swivel: options.swivel ?? 0.0015,
      sway: options.sway ?? 0.022,
      stiffness: options.stiffness ?? 150,
      // One small overshoot, not a wobble: 0.42 swung back and forth.
      damping: options.damping ?? 0.62,
      perspective: options.perspective ?? 1.8,
    };
  }

  /** Whether a card is in the hand (or still dropping back onto the table). */
  holding(node: Liftable): boolean {
    return this.held.has(node);
  }

  /** Whether a card is in the hand right now, not yet put down. */
  inHand(node: Liftable): boolean {
    return this.held.get(node)?.down === false;
  }

  /** Picks a card up. Picking up one already dropping catches it where it is. */
  lift(node: Liftable): void {
    let held = this.held.get(node);
    if (!held) {
      held = {
        node, offset: zeroOffset(), down: false, lastX: node.x, lastY: node.y, vx: 0, vy: 0,
        z: new Spring(), tilt: new Spring(), turn: new Spring(), angle: new Spring(), lens: new Spring(),
      };
      node.addOffset(held.offset);
      this.held.set(node, held);
    }
    held.down = false;
    held.lastX = node.x;
    held.lastY = node.y;
    this.run();
  }

  /** Puts a card down: it drops back onto the table and stops swinging. */
  drop(node: Liftable): void {
    const held = this.held.get(node);
    if (held) held.down = true;
  }

  /**
   * Cards that go with a held one as one piece - a run picked up off a
   * solitaire column. They wear the held card's lift and swing as if fixed
   * to it: the same tip, roll and sway, about the held card's centre, so the
   * stack swings as a stack instead of every card swinging on its own. They
   * keep their own places in the plane; the game moves them with the held
   * card as before. Carried until the held card is back on the table.
   */
  carry(lead: Liftable, followers: readonly Liftable[]): void {
    this.uncarry(lead);
    if (!followers.length) return;
    const offsets = followers.map(() => zeroOffset());
    followers.forEach((f, i) => f.addOffset(offsets[i]));
    this.carried.set(lead, { followers: [...followers], offsets });
  }

  private uncarry(lead: Liftable): void {
    const carried = this.carried.get(lead);
    if (!carried) return;
    carried.followers.forEach((f, i) => { f.removeOffset(carried.offsets[i]); f.offsetChanged(); });
    this.carried.delete(lead);
  }

  /** Puts the held card's pose on the cards it carries, as one rigid body. */
  private follow(held: Held): void {
    const carried = this.carried.get(held.node);
    if (!carried) return;
    const lead = held.node;
    const o = held.offset;
    const base = (lead.angle * Math.PI) / 180;
    const r = cardRotation(base + (o.angle * Math.PI) / 180, o.tilt, o.turn);
    const c = Math.cos(-base);
    const s = Math.sin(-base);
    carried.followers.forEach((f, i) => {
      // Where it sits on the held card, in that card's own frame...
      const dx = f.x - lead.x;
      const dy = f.y - lead.y;
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      // ...and where that point is with the held card lifted and swung.
      const wx = r[0] * lx + r[1] * ly;
      const wy = r[3] * lx + r[4] * ly;
      const wz = r[6] * lx + r[7] * ly;
      const off = carried.offsets[i];
      off.x = o.x + wx - dx;
      off.y = o.y + wy - dy;
      off.z = Math.max(0, o.z + wz);   // the shader adds a rotated point's z to the height
      off.angle = o.angle;
      off.tilt = o.tilt;
      off.turn = o.turn;
      off.lens = o.lens;
      f.offsetChanged();
    });
  }

  /** Lets go of everything at once, with no settling: a scene ending. */
  clear(): void {
    for (const held of this.held.values()) this.release(held);
    for (const lead of [...this.carried.keys()]) this.uncarry(lead);
    this.held.clear();
    this.stop?.();
    this.stop = undefined;
  }

  private run(): void {
    this.stop ??= this.engine.onUpdate((delta) => this.step(delta / 1000));
  }

  /** One frame of every held card's springs. Public for tests. */
  step(dt: number): void {
    if (dt <= 0) return;
    const o = this.options;
    for (const held of [...this.held.values()]) {
      const { node } = held;
      // How fast the game is moving it - read from the card, so it does not
      // matter whether a pointer, a keyboard or a replay is doing the moving.
      const dx = node.x - held.lastX;
      const dy = node.y - held.lastY;
      held.lastX = node.x;
      held.lastY = node.y;
      // Smoothed over about a fourteenth of a second: pointer events arrive
      // in bursts, and the raw speed between two of them is noise that a
      // springy card turns into jitter.
      const blend = 1 - Math.exp(-dt / 0.07);
      held.vx += (dx / dt - held.vx) * blend;
      held.vy += (dy / dt - held.vy) * blend;
      if (held.down) {
        held.vx = 0;
        held.vy = 0;
      }
      // Into the card's own frame: a card turned on the table tips about its
      // own edges, not the board's.
      const a = (node.angle * Math.PI) / 180;
      const lx = Math.cos(a) * held.vx + Math.sin(a) * held.vy;
      const ly = -Math.sin(a) * held.vx + Math.cos(a) * held.vy;
      // It leans into the pull. Pulled right, its right edge leads and dips
      // (a positive turn lifts the right edge, so this one is negative);
      // pulled up the table, its top edge dips away. And it lags round a
      // little in the plane, as if held above its middle.
      // A stack carried with it is longer and heavier: it swings less, so
      // its far end does not swing down through the felt.
      const carrying = this.carried.get(node)?.followers.length ?? 0;
      const heavy = 1 / (1 + carrying * 0.45);
      const turnTo = held.down ? 0 : clamp(-lx * o.swivel, o.maxSwivel) * heavy;
      const tiltTo = held.down ? 0 : clamp(-ly * o.swivel, o.maxSwivel) * heavy;
      const swayTo = held.down ? 0 : clamp(lx * o.sway, o.maxSway) * heavy;
      const zTo = held.down ? 0 : o.lift;
      held.z.step(zTo, dt, o.stiffness * 0.6, 0.9);
      held.turn.step(turnTo, dt, o.stiffness, o.damping);
      held.tilt.step(tiltTo, dt, o.stiffness, o.damping);
      held.angle.step(swayTo, dt, o.stiffness, o.damping);
      held.lens.step(held.down ? 0 : o.perspective, dt, o.stiffness * 0.6, 1);
      // Never below the table: a spring overshooting zero would put it under.
      held.offset.z = Math.max(0, held.z.value);
      held.offset.turn = held.turn.value;
      held.offset.tilt = held.tilt.value;
      held.offset.angle = held.angle.value;
      held.offset.lens = Math.max(0, held.lens.value);
      node.offsetChanged();
      this.follow(held);
      if (held.down && held.z.value <= 0.05 && held.z.speed <= 0.5
        && held.turn.settled(0) && held.tilt.settled(0) && held.angle.settled(0) && held.lens.value < 0.01) {
        this.release(held);
        this.held.delete(node);
      }
    }
    if (!this.held.size) {
      this.stop?.();
      this.stop = undefined;
    }
  }

  private release(held: Held): void {
    held.node.removeOffset(held.offset);
    held.node.offsetChanged();
    this.uncarry(held.node);
  }
}
