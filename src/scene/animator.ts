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
// `flip` channel keeps the latest ask - at most one flip waits behind the
// running one, and asks are deduplicated by what they would leave the card
// as (see `intent`) and debounced (see `debounce`), so a burst of taps is
// never a backlog of flips to sit through. Its `move` channel is shared by a throw and a re-fan; a new
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
 * not start, and hands back the running one's promise. `latest` waits like
 * `queue`, but only one waits: a newer ask replaces it.
 */
export type Policy = 'queue' | 'latest' | 'interrupt' | 'finish' | 'ignore';

/** What an animation leaves its target as, compared with `===`. */
export type Intent = string | number | boolean;

export interface Canned {
  /** Which channel of the target it runs on. */
  channel: string;
  policy?: Policy;
  /**
   * Running animations of higher priority are never interrupted or
   * finished by lower ones; the lower one is ignored instead.
   */
  priority?: number;
  /**
   * What it leaves the target as - a flip's `faceUp`, a move's destination.
   * An ask whose intent is what the channel will already end on (the last
   * waiting animation's, or the running one's) is a duplicate: it does not
   * start, and hands back that animation's promise. Under `latest`, an ask
   * for what the *running* one ends on calls off the one waiting - tapped
   * flip, flip back, the card ends where the first tap sends it.
   */
  intent?: Intent;
  /**
   * Milliseconds. An ask within this long of the previous ask on the channel
   * (taken or not) is dropped - the second tap of a bounced button, or of a
   * touch that also fires a click. Wall clock, since it is about the input.
   */
  debounce?: number;
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
  /** When it was last asked for anything, by the wall clock. */
  asked?: number;
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
  /** The wall clock debouncing is measured on. Replaceable in tests. */
  now: () => number = () => performance.now();

  constructor(private readonly tweens: Tweens) {}

  /** Plays a canned animation on a target. Resolves when it ends, however. */
  play(target: object, spec: Canned): Promise<void> {
    let byName = this.channels.get(target);
    if (!byName) this.channels.set(target, (byName = new Map()));
    let channel = byName.get(spec.channel);
    if (!channel) byName.set(spec.channel, (channel = { queue: [] }));

    const current = channel.running && !channel.running.done ? channel.running : undefined;
    const last = channel.queue[channel.queue.length - 1] ?? current;
    const settled = () => (last ? last.promise : Promise.resolve());

    const now = this.now();
    const bounced = spec.debounce !== undefined && channel.asked !== undefined
      && now - channel.asked < spec.debounce;
    channel.asked = now;
    if (bounced) return settled();
    if (last && spec.intent !== undefined && last.spec.intent === spec.intent) return last.promise;

    const next = makeRunning(spec);
    if (current) {
      const policy = spec.policy ?? 'queue';
      const outranked = (current.spec.priority ?? 0) > (spec.priority ?? 0);
      const waits = policy === 'queue' || policy === 'latest';
      if (policy === 'ignore' || (outranked && !waits)) return current.promise;
      if (policy === 'queue') {
        channel.queue.push(next);
        return next.promise;
      }
      if (policy === 'latest') {
        // Whoever was waiting on a replaced ask waits on what replaced it.
        const replaced = channel.queue.splice(0);
        const back = spec.intent !== undefined && current.spec.intent === spec.intent;
        const instead = back ? current : next;
        for (const waiting of replaced) void instead.promise.then(waiting.resolve);
        if (back) return current.promise;
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

  /**
   * What a channel of a target will have left it as once everything on it
   * has played - the last waiting animation's intent, else the running
   * one's - or undefined when it is idle or the animations carry none.
   * A toggle asks this, rather than the target, what it is toggling from.
   */
  intent(target: object, channel: string): Intent | undefined {
    const ch = this.channels.get(target)?.get(channel);
    if (!ch) return undefined;
    const running = ch.running && !ch.running.done ? ch.running : undefined;
    return (ch.queue[ch.queue.length - 1] ?? running)?.spec.intent;
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

/** The animator for anything with tweens - a board, or `{ tweens }` in a test. One each. */
export function animatorOf(host: { readonly tweens: Tweens; readonly engine?: { readonly clock: { now(): number } } }): Animator {
  let animator = animators.get(host);
  if (!animator) {
    animator = new Animator(host.tweens);
    // Debounced on the engine's clock where there is one, so a test or a
    // replay that turns the clock by hand debounces the same way.
    const clock = host.engine?.clock;
    if (clock) animator.now = () => clock.now();
    animators.set(host, animator);
  }
  return animator;
}
