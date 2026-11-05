import { Ease, easeOf } from './ease.js';
import type { Tweens } from './tweens.js';

// Canned animations: flips, throws, pops, re-fans - things a card *does*,
// as opposed to a number being tweened.
//
// Two rules make them safe to fire as fast as a thumb can tap:
//
// **They never start from a half-animated value.** What an animation adds to
// a card - the lift of a flip, the roll, the pop of a landing - is an
// *offset*, layered on the card's resting pose and taken off exactly when it
// ends or is cut short. The first version read `sprite.z` as the floor to
// lift from, so a second flip tapped mid-flip lifted from the first one's
// height, and a few quick taps left the card floating (and, through the
// lens, larger). An offset cannot accumulate: there is only ever the one.
//
// **Each runs on a channel, with a policy for being asked again.** A card's
// `flip` channel queues - five taps are five flips, each from where the last
// one finished. Its `move` channel is shared by a throw and a re-fan; a new
// throw cuts the old one off where it is, and a re-fan does not touch a card
// a throw is still carrying (lower priority yields). A `pop` restarts.
//
// Animations that move a card for good (a throw to its landing, a re-fan to
// its place) write the card's own x, y and angle, from values read when they
// *start* - which, because of the channel, is after whatever was moving the
// card before them has stopped.

/** What an animation adds to a pose while it runs. Scale multiplies. */
export interface Offset {
  x: number; y: number; z: number;
  angle: number; tilt: number; turn: number; bow: number;
  scale: number;
}

export const zeroOffset = (): Offset =>
  ({ x: 0, y: 0, z: 0, angle: 0, tilt: 0, turn: 0, bow: 0, scale: 1 });

/** Something that can wear offsets: every Node. */
export interface Layered {
  addOffset(offset: Offset): void;
  removeOffset(offset: Offset): void;
  offsetChanged(): void;
}

const isLayered = (target: object): target is Layered =>
  typeof (target as Partial<Layered>).addOffset === 'function';

/**
 * What a second animation on a busy channel does.
 *
 * `queue` waits its turn. `interrupt` stops the running one where it is (its
 * offset comes off; its `complete` does not run) and starts. `finish` jumps
 * the running one to its end, `complete` and all, and starts. `ignore` does
 * not start, and hands back the running one's promise.
 */
export type Policy = 'queue' | 'interrupt' | 'finish' | 'ignore';

export interface Canned {
  /** Which channel of the target it runs on. */
  channel: string;
  policy?: Policy;
  /**
   * Running animations of higher priority are never interrupted or
   * finished by lower ones; the lower one is ignored instead.
   */
  priority?: number;
  duration: number;
  delay?: number;
  ease?: string | Ease;
  /**
   * Called when it actually starts, after anything ahead of it in the queue.
   * Read the target here, not when building the animation. Return false to
   * skip it - a flip to face-up of a card that already is.
   */
  start?(): boolean | void;
  /** Eased progress, 0 to 1, and this animation's own offset to set. */
  update?(t: number, offset: Offset): void;
  /** At the end, with the offset already off. Not called when interrupted. */
  complete?(): void;
}

interface Running {
  spec: Canned;
  offset: Offset;
  /** For targets that cannot wear an offset: what it last added. */
  applied: Offset;
  elapsed: number;
  waited: number;
  started: boolean;
  done: boolean;
  resolve: () => void;
  promise: Promise<void>;
}

interface Channel {
  running?: Running;
  queue: Running[];
}

function makeRunning(spec: Canned): Running {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return {
    spec, offset: zeroOffset(), applied: zeroOffset(), elapsed: 0, waited: 0,
    started: false, done: false, resolve, promise,
  };
}

const KEYS = ['x', 'y', 'z', 'angle', 'tilt', 'turn', 'bow'] as const;

export class Animator {
  private readonly channels = new WeakMap<object, Map<string, Channel>>();
  /** Every channel with something running, and whose it is. */
  private readonly active = new Map<Channel, object>();
  private ticking = false;

  constructor(private readonly tweens: Tweens) {}

  /** Plays a canned animation on a target. Resolves when it ends, however. */
  play(target: object, spec: Canned): Promise<void> {
    let byName = this.channels.get(target);
    if (!byName) this.channels.set(target, (byName = new Map()));
    let channel = byName.get(spec.channel);
    if (!channel) byName.set(spec.channel, (channel = { queue: [] }));

    const next = makeRunning(spec);
    const current = channel.running;
    if (current && !current.done) {
      const policy = spec.policy ?? 'queue';
      const outranked = (current.spec.priority ?? 0) > (spec.priority ?? 0);
      if (policy === 'ignore' || (outranked && policy !== 'queue')) return current.promise;
      if (policy === 'queue') {
        channel.queue.push(next);
        return next.promise;
      }
      if (policy === 'finish') this.end(target, current, true);
      else this.end(target, current, false);
      for (const waiting of channel.queue.splice(0)) waiting.resolve();
    }
    channel.running = next;
    this.active.set(channel, target);
    this.ensureTicking();
    return next.promise;
  }

  /** Whether a channel of a target has something running. */
  busy(target: object, channel: string): boolean {
    const running = this.channels.get(target)?.get(channel)?.running;
    return Boolean(running && !running.done);
  }

  /** What is running on a channel of a target, if anything. */
  running(target: object, channel: string): Canned | undefined {
    const running = this.channels.get(target)?.get(channel)?.running;
    return running && !running.done ? running.spec : undefined;
  }

  /** Stops a channel (or every channel) of a target where it is, and its queue. */
  stop(target: object, channel?: string): void {
    this.settle(target, channel, false);
  }

  /** Jumps a channel (or every channel) of a target to its end, queue included. */
  finish(target: object, channel?: string): void {
    this.settle(target, channel, true);
  }

  private settle(target: object, name: string | undefined, complete: boolean): void {
    const byName = this.channels.get(target);
    if (!byName) return;
    for (const [key, channel] of byName) {
      if (name !== undefined && key !== name) continue;
      // Finishing runs the queue too: five queued flips finished are five
      // flips, and the card ends on the side five flips leave it.
      while (channel.running && !channel.running.done) {
        const running = channel.running;
        this.end(target, running, complete);
        channel.running = complete ? channel.queue.shift() : undefined;
        if (!complete) for (const waiting of channel.queue.splice(0)) waiting.resolve();
      }
    }
  }

  private ensureTicking(): void {
    if (this.ticking) return;
    this.ticking = true;
    // On the board's own clock, so canned animations and tweens advance
    // together and keep the board awake only while something runs.
    this.tweens.tick((ms) => {
      const more = this.step(ms);
      if (!more) this.ticking = false;
      return more;
    });
  }

  /** Advances everything by `ms`. Answers whether anything is still running. */
  step(ms: number): boolean {
    for (const [channel, target] of [...this.active]) {
      const running = channel.running;
      if (!running || running.done) {
        this.active.delete(channel);
        continue;
      }
      this.advance(target, channel, running, ms);
      if (!channel.running || channel.running.done) this.active.delete(channel);
    }
    return this.active.size > 0;
  }

  private advance(target: object, channel: Channel, running: Running, ms: number): void {
    const spec = running.spec;
    if (running.waited < (spec.delay ?? 0)) {
      running.waited += ms;
      if (running.waited < (spec.delay ?? 0)) return;
      ms = running.waited - (spec.delay ?? 0);
    }
    if (!running.started) {
      running.started = true;
      if (spec.start?.() === false) {
        running.done = true;
        running.resolve();
        this.next(target, channel);
        return;
      }
      if (isLayered(target)) target.addOffset(running.offset);
    }
    running.elapsed += ms;
    const t = spec.duration <= 0 ? 1 : Math.min(1, running.elapsed / spec.duration);
    spec.update?.(easeOf(spec.ease)(t), running.offset);
    this.apply(target, running);
    if (t >= 1) {
      this.end(target, running, true);
      this.next(target, channel);
    }
  }

  private next(target: object, channel: Channel): void {
    const following = channel.queue.shift();
    channel.running = following;
    if (following) {
      this.active.set(channel, target);
      // Started now rather than next frame, so a queue of flips has no gap.
      this.advance(target, channel, following, 0);
    }
  }

  /** Takes a running animation off its target, and settles its promise. */
  private end(target: object, running: Running, complete: boolean): void {
    if (running.done) return;
    running.done = true;
    if (running.started) {
      if (complete && running.spec.update && running.elapsed < running.spec.duration) {
        running.spec.update(1, running.offset);
      }
      Object.assign(running.offset, zeroOffset());
      this.apply(target, running);
      if (isLayered(target)) target.removeOffset(running.offset);
      else snap(target as Record<string, number>, running.applied);
    }
    if (complete && running.started) running.spec.complete?.();
    if (complete && !running.started) {
      // Finished before it began: it still owes what it would have done.
      running.started = true;
      if (running.spec.start?.() !== false) {
        running.spec.update?.(1, running.offset);
        Object.assign(running.offset, zeroOffset());
        running.spec.complete?.();
      }
    }
    running.resolve();
  }

  /**
   * Shows an offset change. A Node sums its offsets when drawn; anything else
   * (a plain object in a test) gets the change written into its own fields,
   * exactly undone later.
   */
  private apply(target: object, running: Running): void {
    if (isLayered(target)) {
      target.offsetChanged();
      return;
    }
    const plain = target as Record<string, number>;
    const { offset, applied } = running;
    for (const key of KEYS) {
      if (key in plain && offset[key] !== applied[key]) {
        plain[key] += offset[key] - applied[key];
        applied[key] = offset[key];
      }
    }
    if ('scaleX' in plain && offset.scale !== applied.scale) {
      plain['scaleX'] *= offset.scale / applied.scale;
      plain['scaleY'] *= offset.scale / applied.scale;
      applied.scale = offset.scale;
    }
  }
}

/**
 * Adding an offset to a plain field and taking it off again leaves a residue
 * of 1e-17 or so; a card that flipped should be back at exactly 0, not near
 * it. Only for targets that are not Nodes - a Node never stores an offset.
 */
function snap(plain: Record<string, number>, applied: Offset): void {
  for (const key of KEYS) {
    if (!(key in plain) || typeof plain[key] !== 'number') continue;
    const value = plain[key];
    const tidy = Math.round(value * 1e9) / 1e9;
    if (Math.abs(value - tidy) < 1e-9) plain[key] = tidy === 0 ? 0 : tidy;
  }
  void applied;
}

const animators = new WeakMap<object, Animator>();

/** The animator for anything with tweens - a board, or `{ tweens }` in a test. */
export function animatorOf(host: { readonly tweens: Tweens }): Animator {
  let animator = animators.get(host);
  if (!animator) animators.set(host, (animator = new Animator(host.tweens)));
  return animator;
}
