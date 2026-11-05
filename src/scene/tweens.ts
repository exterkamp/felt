import { Ease, easeOf } from './ease.js';

// Tweens: numbers on objects, moved over time.
//
// Deliberately close to Phaser's shape - `targets`, the properties to move as
// plain keys, `duration`, `delay`, `ease`, `yoyo`, `onUpdate`, `onComplete` -
// because the code that drives cards around a table was written against that
// shape and should come across without being rethought.
//
// It knows nothing about a board or a canvas. It is advanced by `update(ms)`,
// which the board calls once a frame and a test calls by hand, so everything
// that animates through it can be tested in node by stepping a clock.

/** The parts of a tween config that are not properties to move. */
const RESERVED = new Set([
  'targets', 'duration', 'delay', 'ease', 'yoyo', 'repeat', 'hold',
  'onStart', 'onUpdate', 'onComplete', 'onYoyo',
]);

export interface TweenConfig {
  targets: object | readonly object[];
  duration?: number;
  delay?: number;
  ease?: string | Ease;
  /** Run back to the start once it arrives. */
  yoyo?: boolean;
  /** Extra runs after the first. -1 repeats until stopped. */
  repeat?: number;
  onStart?: (tween: Tween) => void;
  onUpdate?: (tween: Tween, target: any, progress: number) => void;
  onComplete?: (tween: Tween) => void;
  /** Anything else is a numeric property to move to this value. */
  [property: string]: unknown;
}

interface Track {
  target: Record<string, number>;
  key: string;
  from: number;
  to: number;
}

export class Tween {
  readonly promise: Promise<void>;
  /** Milliseconds into the current run, delay excluded. */
  private elapsed = 0;
  private waited = 0;
  private started = false;
  private finished = false;
  private backwards = false;
  private runs = 0;
  private tracks: Track[] = [];
  private resolve!: () => void;
  private readonly ease: Ease;
  readonly duration: number;
  readonly delay: number;
  readonly targets: object[];

  constructor(readonly config: TweenConfig) {
    this.targets = Array.isArray(config.targets)
      ? [...(config.targets as object[])] : [config.targets as object];
    this.duration = Math.max(0, config.duration ?? 1000);
    this.delay = Math.max(0, config.delay ?? 0);
    this.ease = easeOf(config.ease);
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  }

  get isPlaying(): boolean { return this.started && !this.finished; }
  get isFinished(): boolean { return this.finished; }

  /** Whether this tween moves the property `key` of `target`. */
  moves(target: object, key?: string): boolean {
    if (!this.targets.includes(target)) return false;
    if (key === undefined) return true;
    return key in this.config && !RESERVED.has(key);
  }

  /** Advances by `ms`, and answers whether it still has work to do. */
  step(ms: number): boolean {
    if (this.finished) return false;
    if (this.waited < this.delay) {
      this.waited += ms;
      if (this.waited < this.delay) return true;
      ms = this.waited - this.delay;
    }
    if (!this.started) this.begin();
    this.elapsed += ms;
    const t = this.duration === 0 ? 1 : Math.min(1, this.elapsed / this.duration);
    this.apply(t);
    if (t < 1) return true;

    if (this.config.yoyo && !this.backwards) {
      this.backwards = true;
      this.elapsed = 0;
      return true;
    }
    const repeat = this.config.repeat ?? 0;
    if (repeat < 0 || this.runs < repeat) {
      this.runs++;
      this.backwards = false;
      this.elapsed = 0;
      return true;
    }
    this.finish();
    return false;
  }

  /** Stops where it is. The promise resolves; onComplete does not run. */
  stop(): void {
    if (this.finished) return;
    this.finished = true;
    this.resolve();
  }

  /** Jumps to the end, as if it had run. */
  complete(): void {
    if (this.finished) return;
    if (!this.started) this.begin();
    this.backwards = Boolean(this.config.yoyo);
    this.apply(1);
    this.finish();
  }

  private begin(): void {
    this.started = true;
    // Start values are read when the tween starts rather than when it is
    // made, so that a delayed tween picks up wherever an earlier one left
    // the card - which is what a stagger of throws needs.
    for (const target of this.targets as Record<string, number>[]) {
      for (const key of Object.keys(this.config)) {
        if (RESERVED.has(key)) continue;
        const to = this.config[key];
        if (typeof to !== 'number') continue;
        this.tracks.push({ target, key, from: Number(target[key]) || 0, to });
      }
    }
    this.config.onStart?.(this);
  }

  private apply(t: number): void {
    // Yoyo runs the same curve backwards, so the return trip mirrors the
    // way out rather than easing the opposite way.
    const k = this.backwards ? this.ease(1 - t) : this.ease(t);
    for (const track of this.tracks) {
      track.target[track.key] = track.from + (track.to - track.from) * k;
    }
    if (this.config.onUpdate) {
      for (const target of this.targets) this.config.onUpdate(this, target, k);
    }
  }

  private finish(): void {
    this.finished = true;
    this.config.onComplete?.(this);
    this.resolve();
  }
}

export class Tweens {
  private readonly active: Tween[] = [];
  /** Called whenever a tween is added, so a sleeping board can wake. */
  onWake?: () => void;

  add(config: TweenConfig): Tween {
    const tween = new Tween(config);
    this.active.push(tween);
    this.onWake?.();
    return tween;
  }

  /** `add`, as a promise that resolves when it finishes. */
  to(targets: object | readonly object[], props: Omit<TweenConfig, 'targets'>): Promise<void> {
    return this.add({ ...props, targets }).promise;
  }

  /** Every running tween that moves this target (and this key, if given). */
  of(target: object, key?: string): Tween[] {
    return this.active.filter((tween) => !tween.isFinished && tween.moves(target, key));
  }

  /** Stops every tween moving this target. */
  killTweensOf(target: object): void {
    for (const tween of this.of(target)) tween.stop();
  }

  get count(): number {
    return this.active.length;
  }

  /** Advances every tween by `ms`. Answers whether any are still running. */
  update(ms: number): boolean {
    // Copied first: a tween's onComplete may well add the next one.
    const running = this.active.slice();
    for (const tween of running) {
      if (!tween.step(ms)) {
        const at = this.active.indexOf(tween);
        if (at >= 0) this.active.splice(at, 1);
      }
    }
    return this.active.length > 0;
  }

  /** Steps the clock until nothing is running. For tests and for skipping. */
  flush(stepMs = 16, limitMs = 60_000): void {
    for (let t = 0; t < limitMs && this.update(stepMs); t += stepMs) { /* run */ }
  }
}
