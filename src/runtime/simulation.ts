import type { Dispose } from './disposables.js';
import type { Engine } from './engine.js';

// The table as data, stepped in whole ticks: the base for multiplayer.
//
// A board shows a game; a Simulation *is* one. It holds the game's state as
// plain data and changes it only by applying commands - "seat 2 plays the
// queen of hearts" - at a numbered tick, in a fixed order, with a seeded
// random source whose state is part of the game. Given the same starting
// state, seed and commands, every copy reaches the same state at the same
// tick, to the bit, which is what lets:
//
// - a **server** be authoritative: it stamps each command with the tick it
//   applies at and sends it on; every client applies the same commands at
//   the same ticks and agrees (`hash()` to check).
// - a **turn-based** game be a log: replaying the commands rebuilds any
//   position, and a snapshot plus the commands since is a saved game.
// - a **realtime** game run on the engine's fixed steps (`run(engine)`), at
//   the same rate everywhere whatever the display's frame rate, or headless
//   on a server with a manual clock.
//
// The view follows: animate what a tick changed, never change state from
// the view. Commands arriving late (for a tick already run) are applied at
// the next tick and counted in `late`; rolling back to re-run them is a
// policy for the game to add on top, from `snapshot`.

/** A seeded random source whose whole state is one number, so it can be saved. */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  /** 0 (inclusive) to 1 (exclusive). Mulberry32, the same as `seeded`. */
  next = (): number => {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** A whole number from 0 to n - 1. */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

export interface StepContext {
  /** The tick being run. */
  readonly tick: number;
  /** Simulation milliseconds at that tick. */
  readonly time: number;
  readonly rng: Rng;
}

export interface Rules<S, C> {
  /** Applies one command to the state. Deterministic: read only the state, the command and the context. */
  apply(state: S, command: C, ctx: StepContext): void;
  /** Runs every tick, after that tick's commands: clocks, timeouts, the house's moves. */
  tick?(state: S, ctx: StepContext): void;
}

/** A command and when it applies. The order within a tick is `seq`. */
export interface Stamped<C> {
  tick: number;
  seq: number;
  /** Who sent it, for the game to check it was theirs to send. */
  from?: string;
  command: C;
}

export interface Snapshot<S> {
  tick: number;
  seq: number;
  rng: number;
  state: S;
}

export interface SimulationOptions {
  seed?: number;
  /** Milliseconds per tick. Default 1000/30, the engine's fixed step. */
  step?: number;
}

export class Simulation<S, C> {
  /** The game. Change it only through commands. */
  state: S;
  /** Ticks run. */
  tick = 0;
  /** Commands that arrived for a tick already run, and were applied at the next. */
  late = 0;
  readonly rng: Rng;
  readonly step: number;
  /** Every command applied, in the order applied: the game, as a log. */
  readonly log: Stamped<C>[] = [];
  private seq = 0;
  private pending: Stamped<C>[] = [];
  private readonly listeners = new Set<(applied: Stamped<C>[], tick: number) => void>();

  constructor(readonly rules: Rules<S, C>, initial: S, options: SimulationOptions = {}) {
    this.state = clone(initial);
    this.rng = new Rng(options.seed ?? 1);
    this.step = options.step ?? 1000 / 30;
  }

  /**
   * Queues a command of this copy's own - a server's, or a local game's -
   * for the next tick (or a later one), and answers it stamped, to send to
   * the other copies.
   */
  submit(command: C, options: { tick?: number; from?: string } = {}): Stamped<C> {
    const stamped: Stamped<C> = {
      tick: Math.max(options.tick ?? this.tick + 1, this.tick + 1),
      seq: this.seq++, from: options.from, command,
    };
    this.queue(stamped);
    return stamped;
  }

  /** Takes a command stamped by another copy (the server's), at its own tick. */
  receive(stamped: Stamped<C>): void {
    const copy = { ...stamped };
    if (copy.tick <= this.tick) {
      copy.tick = this.tick + 1;
      this.late++;
    }
    this.seq = Math.max(this.seq, copy.seq + 1);
    this.queue(copy);
  }

  private queue(stamped: Stamped<C>): void {
    this.pending.push(stamped);
    this.pending.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
  }

  /** Runs `ticks` ticks. Answers the commands applied. */
  advance(ticks = 1): Stamped<C>[] {
    const all: Stamped<C>[] = [];
    for (let i = 0; i < ticks; i++) {
      this.tick++;
      const ctx: StepContext = { tick: this.tick, time: this.tick * this.step, rng: this.rng };
      const due: Stamped<C>[] = [];
      while (this.pending.length && this.pending[0].tick <= this.tick) due.push(this.pending.shift()!);
      for (const stamped of due) {
        this.rules.apply(this.state, stamped.command, ctx);
        this.log.push(stamped);
      }
      this.rules.tick?.(this.state, ctx);
      for (const listener of [...this.listeners]) listener(due, this.tick);
      all.push(...due);
    }
    return all;
  }

  /** Runs ticks until `tick` has been run. */
  runTo(tick: number): void {
    if (tick > this.tick) this.advance(tick - this.tick);
  }

  /** Called after every tick with what it applied - where a view animates. */
  onTick(listener: (applied: Stamped<C>[], tick: number) => void): Dispose {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Steps on an engine's fixed steps, one tick per step, until disposed.
   * The engine's step and this one's should agree; this does not check.
   */
  run(engine: Engine): Dispose {
    return engine.onFixedUpdate(() => { this.advance(1); });
  }

  /** A fingerprint of the whole game - state, tick and random source - for copies to compare. */
  hash(): string {
    return fnv1a(stableJson({ tick: this.tick, rng: this.rng.state, state: this.state }));
  }

  snapshot(): Snapshot<S> {
    return { tick: this.tick, seq: this.seq, rng: this.rng.state, state: clone(this.state) };
  }

  /** A copy that carries on from a snapshot. */
  static restore<S, C>(rules: Rules<S, C>, snapshot: Snapshot<S>, options: SimulationOptions = {}): Simulation<S, C> {
    const sim = new Simulation(rules, snapshot.state, options);
    sim.tick = snapshot.tick;
    sim.seq = snapshot.seq;
    sim.rng.state = snapshot.rng;
    return sim;
  }

  /** Rebuilds a game from its start and its log, to `toTick` (default: the last command's). */
  static replay<S, C>(rules: Rules<S, C>, initial: S, log: readonly Stamped<C>[],
    options: SimulationOptions & { toTick?: number } = {}): Simulation<S, C> {
    const sim = new Simulation(rules, initial, options);
    for (const stamped of log) sim.receive(stamped);
    sim.runTo(options.toTick ?? (log.length ? log[log.length - 1].tick : 0));
    return sim;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** JSON with object keys sorted, so equal states print equally. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
