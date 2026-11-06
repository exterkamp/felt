import { Clock, ManualClock, RafClock } from './clock.js';
import { Disposables, Dispose } from './disposables.js';
import { LifecycleEvent, PageLifecycle } from './lifecycle.js';

// The engine: one per page, and the only thing that owns time.
//
// A board used to run its own requestAnimationFrame loop, keep its own clock,
// and know nothing of the page around it. Two boards were two loops; a board
// made for the next screen started its art from nothing; a page coming back
// from the background woke nothing. The engine is what they have in common:
//
// - **the loop.** One frame callback for everything on the page, on a
//   `Clock` that a test or a server can turn by hand. Each frame runs, in
//   order: fixed steps, updates, then every member (each board steps its
//   tweens, paints what it owes, and draws if anything changed). It sleeps
//   when nothing asks for another frame - a card game is still most of the
//   time - and anything touched wakes it.
// - **two times.** `simTime` advances only in whole fixed steps (default
//   30 a second, at most `maxSteps` per frame, the rest dropped rather than
//   caught up), for game rules, turn clocks and anything a server and a
//   client must agree on. `time` is the display's, for animation.
// - **the page's lifecycle.** Hidden, frozen or cached, it requests nothing.
//   Back, it drops the time it was away and has every member draw itself
//   again, whether or not anything moved.
// - **services.** Anything that is the page's rather than one board's - the
//   card art's CPU-side pictures, the court worker - hangs off
//   `engine.services`, so the second board on a page, or the board made for
//   the next screen, starts warm.

export interface EngineMember {
  /** Steps one frame. Answers whether it wants another one. */
  frame(delta: number, time: number): boolean;
  /** The page went away or came back. */
  lifecycle?(event: LifecycleEvent): void;
}

export interface EngineOptions {
  /** Default: the display's frame clock in a browser, a manual clock elsewhere. */
  clock?: Clock;
  /** The page lifecycle to follow; `null` for none (a server, a test). Default: the page's. */
  lifecycle?: PageLifecycle | null;
  /** Milliseconds per fixed step. Default 1000/30. */
  fixedStep?: number;
  /** Most fixed steps in one frame; the rest of the time is dropped. Default 5. */
  maxSteps?: number;
  /** Longest frame the loop will admit to, in ms. Default 100. */
  maxDelta?: number;
}

export type EngineEvent = 'suspend' | 'resume' | 'blur' | 'focus' | 'pixelratio' | 'frame' | 'destroy';

type FixedUpdate = (step: number, simTime: number) => void;
type Update = (delta: number, time: number) => void;

export class Engine {
  readonly clock: Clock;
  readonly lifecycle: PageLifecycle | null;
  readonly services = new Map<string, unknown>();
  readonly fixedStep: number;
  readonly maxSteps: number;
  readonly maxDelta: number;
  /** Display time: milliseconds of frames run, gaps left out. */
  time = 0;
  /** Simulation time: whole fixed steps run, in milliseconds. */
  simTime = 0;
  /** Fixed steps run since the start. */
  steps = 0;
  /** Frames run since the start. */
  frames = 0;
  /** How far into the next fixed step this frame is, 0-1, for drawing between steps. */
  alpha = 0;
  /** Fixed steps dropped because a frame was too long to catch up. */
  droppedSteps = 0;

  private readonly members = new Set<EngineMember>();
  private readonly fixed = new Set<FixedUpdate>();
  private readonly updates = new Set<Update>();
  private readonly handlers = new Map<EngineEvent, Set<(event?: unknown) => void>>();
  private readonly scope = new Disposables();
  private readonly ownsLifecycle: boolean;
  private request = 0;
  private last = 0;
  private accumulator = 0;
  private awake = 0;
  private running = false;
  private wakeAgain = false;
  private suspendedFlag = false;
  private destroyedFlag = false;

  constructor(options: EngineOptions = {}) {
    const browser = typeof document !== 'undefined' && typeof requestAnimationFrame !== 'undefined';
    this.clock = options.clock ?? (browser ? new RafClock() : new ManualClock());
    this.fixedStep = options.fixedStep ?? 1000 / 30;
    this.maxSteps = options.maxSteps ?? 5;
    this.maxDelta = options.maxDelta ?? 100;
    this.ownsLifecycle = options.lifecycle === undefined && browser;
    this.lifecycle = options.lifecycle === undefined
      ? (browser ? new PageLifecycle() : null)
      : options.lifecycle;
    this.suspendedFlag = this.lifecycle ? !this.lifecycle.active : false;
    if (this.lifecycle) this.scope.add(this.lifecycle.on((event) => this.onLifecycle(event)));
  }

  /** How many members (boards) it is stepping. */
  get memberCount(): number {
    return this.members.size;
  }

  /** How many per-frame callbacks are subscribed: timers, scene updates. */
  get updateCount(): number {
    return this.updates.size;
  }

  get suspended(): boolean {
    return this.suspendedFlag;
  }

  get destroyed(): boolean {
    return this.destroyedFlag;
  }

  // --- what runs each frame ------------------------------------------------

  /** Adds something stepped every frame it asks for - a board. */
  add(member: EngineMember): Dispose {
    this.members.add(member);
    this.wake();
    return () => { this.members.delete(member); };
  }

  /**
   * Runs `fn` every fixed step while subscribed. The engine stays awake for
   * as long as any are: simulation time only passes while someone is
   * simulating.
   */
  onFixedUpdate(fn: FixedUpdate): Dispose {
    this.fixed.add(fn);
    this.wake();
    return () => { this.fixed.delete(fn); };
  }

  /** Runs `fn` every frame while subscribed, with the frame's delta. */
  onUpdate(fn: Update): Dispose {
    this.updates.add(fn);
    this.wake();
    return () => { this.updates.delete(fn); };
  }

  /** Keeps frames coming until the returned function is called. */
  keepAwake(): Dispose {
    this.awake++;
    this.wake();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.awake--;
    };
  }

  on(event: EngineEvent, handler: (event?: unknown) => void): Dispose {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  /** Asks for a frame. Cheap to call often; a suspended page gets none. */
  wake(): void {
    if (this.destroyedFlag) return;
    if (this.running) {
      this.wakeAgain = true;
      return;
    }
    if (this.request || this.suspendedFlag) return;
    this.request = this.clock.request((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.request = 0;
    if (this.destroyedFlag || this.suspendedFlag) return;
    const delta = this.last ? Math.min(this.maxDelta, Math.max(0, now - this.last)) : 1000 / 60;
    this.last = now;
    this.time += delta;
    this.frames++;
    this.running = true;
    this.wakeAgain = false;
    let more = false;
    try {
      if (this.fixed.size) {
        this.accumulator += delta;
        let ran = 0;
        while (this.accumulator >= this.fixedStep && ran < this.maxSteps) {
          this.accumulator -= this.fixedStep;
          this.simTime += this.fixedStep;
          this.steps++;
          ran++;
          for (const fn of [...this.fixed]) fn(this.fixedStep, this.simTime);
        }
        if (this.accumulator >= this.fixedStep) {
          // Too far behind to catch up without a spiral: let the time go.
          const behind = Math.floor(this.accumulator / this.fixedStep);
          this.droppedSteps += behind;
          this.accumulator -= behind * this.fixedStep;
        }
        this.alpha = this.accumulator / this.fixedStep;
      } else {
        this.accumulator = 0;
        this.alpha = 0;
      }
      for (const fn of [...this.updates]) fn(delta, this.time);
      for (const member of [...this.members]) {
        if (member.frame(delta, this.time)) more = true;
      }
      this.emit('frame');
    } finally {
      this.running = false;
    }
    if (more || this.wakeAgain || this.fixed.size || this.updates.size || this.awake > 0) {
      this.wake();
    } else {
      // Asleep. The first frame after a nap should not see it as one long frame.
      this.last = 0;
    }
  }

  // --- the page --------------------------------------------------------------

  private onLifecycle(event: LifecycleEvent): void {
    if (this.destroyedFlag) return;
    if (event.type === 'suspend') {
      this.suspendedFlag = true;
      if (this.request) this.clock.cancel(this.request);
      this.request = 0;
    } else if (event.type === 'resume') {
      this.suspendedFlag = false;
      // The time it was away is not time anything should have moved for.
      this.last = 0;
      this.accumulator = 0;
    }
    for (const member of [...this.members]) member.lifecycle?.(event);
    this.emit(event.type, event);
    if (event.type === 'resume') this.wake();
  }

  private emit(event: EngineEvent, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(payload);
  }

  /**
   * Ends the engine: the loop stops, the lifecycle listeners go, and every
   * service with a `dispose` is disposed, newest first. Members are not
   * destroyed here - a board belongs to whoever made it - but are dropped.
   */
  destroy(): void {
    if (this.destroyedFlag) return;
    this.emit('destroy');
    this.destroyedFlag = true;
    if (this.request) this.clock.cancel(this.request);
    this.request = 0;
    this.members.clear();
    this.fixed.clear();
    this.updates.clear();
    for (const service of [...this.services.values()].reverse()) {
      (service as { dispose?: () => void }).dispose?.();
    }
    this.services.clear();
    this.scope.dispose();
    if (this.ownsLifecycle) this.lifecycle?.destroy();
    this.handlers.clear();
    if (page === this) page = undefined;
  }
}

/**
 * The page's engine - the one singleton - made the first time anything asks.
 * Everything that is not given an engine of its own uses this one. Destroyed,
 * the next ask makes a fresh one.
 */
let page: Engine | undefined;

export function engine(): Engine {
  if (!page || page.destroyed) page = new Engine();
  return page;
}

/** A separate engine: for tests, a server, or a second independent game on a page. */
export function createEngine(options: EngineOptions = {}): Engine {
  return new Engine(options);
}

/** A service of the engine's, made on first use: `serviceOf(engine, 'art', () => new ArtStore())`. */
export function serviceOf<T>(owner: { readonly services: Map<string, unknown> }, key: string, make: () => T): T {
  let service = owner.services.get(key) as T | undefined;
  if (service === undefined) {
    service = make();
    owner.services.set(key, service);
  }
  return service;
}
