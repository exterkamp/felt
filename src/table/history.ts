import type { Dispose } from '../runtime/disposables.js';
import {
  type RestoreOptions, type TableState, captureTable, cloneState, isTableState, restoreTable, sameState, tableFits,
} from './state.js';
import type { MoveCause, Table, TableMove } from './table.js';

// Undo, redo, and the record of a game's moves.
//
// A history is a line of whole table states - and the game's own state next
// to each - with the present somewhere along it. Undo steps back one and
// puts the table there; redo steps forward; doing something new from the
// middle throws away what was ahead, the way every editor does. Snapshots
// rather than inverse moves, because a table state is small (a few hundred
// bytes for a deck) and a snapshot cannot drift: a hundred undos land
// exactly the table that was, sides and all, whatever happened in between.
//
// What counts as one step, unasked: every move the table makes in one go -
// one drop, one tap, one handler that moves three cards - is one step,
// recorded once the code that made them has finished (a microtask later).
// So a run dragged onto a column, the card its move turns up, and the score
// the game bumps in its `move` handler are all one undo. A sequence that
// awaits between its moves - a deal, an animated turn, an auto-play chain -
// is made one step by `history.group(...)` (or `begin`/`end`).
//
// The state recorded is the table's logical one, so a step can be recorded
// - and undone - while its cards are still in the air: undo sends them back
// from wherever they are. Two things it will not do: undo with cards in the
// player's hand (mid-drag), or in the middle of a group. Both answer false.

/** One move in the log: plain ids, for a replay or a bug report. */
export interface MoveRecord {
  cards: string[];
  /** The zone they left, or null from loose on the felt (or nowhere: new cards). */
  from: string | null;
  /** The zone they went to, or null let go loose. */
  to: string | null;
  by: MoveCause;
}

/** One entry in a history: the table and the game as they were after a step. */
export interface HistoryStep<G = unknown> {
  table: TableState;
  /** The game's own state - score, turn, passes - as `game.save()` gave it. */
  game?: G;
  /** The moves that made this step from the one before. The first entry has none. */
  moves: MoveRecord[];
  label?: string;
}

/** How a history reads and puts back the game's own state. G must be JSON. */
export interface GameState<G> {
  save(): G;
  load(state: G): void;
}

/** A history as plain JSON: what a save stores. */
export interface SavedHistory<G = unknown> {
  steps: HistoryStep<G>[];
  index: number;
}

export interface HistoryChange {
  cause: 'step' | 'undo' | 'redo' | 'reset' | 'load';
  index: number;
  length: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface HistoryOptions<G> {
  /** The game's state, kept with every step and restored by undo. */
  game?: GameState<G>;
  /** Most undo steps kept; older ones are dropped. Default 200. */
  cap?: number;
  /** Which moves start a step. Default every move (the history's own restores are never recorded). */
  record?: (move: TableMove) => boolean;
  /** How undo and redo animate the table back. */
  restore?: RestoreOptions;
  /** @internal For tests: how the table is read and put back. */
  capture?: () => TableState;
  /** @internal For tests. */
  apply?: (state: TableState, options: RestoreOptions) => Promise<void>;
  /** @internal For tests. */
  fits?: (state: TableState) => boolean;
}

const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);

/** Whether something read back from storage is a well-formed SavedHistory. */
export function isSavedHistory(value: unknown): value is SavedHistory {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<SavedHistory>;
  if (!Array.isArray(saved.steps) || !saved.steps.length) return false;
  if (typeof saved.index !== 'number' || !Number.isInteger(saved.index)
    || saved.index < 0 || saved.index >= saved.steps.length) return false;
  return saved.steps.every((step) => step && typeof step === 'object' && isTableState(step.table)
    && Array.isArray(step.moves));
}

export class History<G = undefined> {
  private entries: HistoryStep<G>[] = [];
  private at = 0;
  private readonly cap: number;
  private pending: MoveRecord[] = [];
  private scheduled = false;
  private depth = 0;
  private groupLabel: string | undefined;
  private restoring = false;
  private holding = false;
  private readonly offs: Dispose[] = [];
  private readonly listeners = new Set<(change: HistoryChange) => void>();
  private readonly capture: () => TableState;
  private readonly apply: (state: TableState, options: RestoreOptions) => Promise<void>;
  private readonly fits: (state: TableState) => boolean;

  constructor(readonly table: Table, readonly options: HistoryOptions<G> = {}) {
    this.cap = Math.max(1, options.cap ?? 200);
    this.capture = options.capture ?? (() => captureTable(table));
    this.apply = options.apply ?? ((state, o) => restoreTable(table, state, o));
    this.fits = options.fits ?? ((state) => tableFits(table, state));
    this.offs.push(table.on('move', (move) => this.onMove(move)));
    this.offs.push(table.on('take', () => { this.holding = true; }));
    this.offs.push(table.on('drop', () => { this.holding = false; }));
    this.entries = [this.snapshot([])];
  }

  // --- reading -------------------------------------------------------------

  /** Every entry, oldest first: the first is the start (or the oldest kept), the rest one per step. */
  get steps(): readonly HistoryStep<G>[] { return this.entries; }
  /** Which entry the table is at. */
  get index(): number { return this.at; }
  /** The entry the table is at. */
  get current(): HistoryStep<G> { return this.entries[this.at]; }
  /** Whether a group is open: a sequence under way that will be one step. */
  get grouping(): boolean { return this.depth > 0; }
  /** Whether a group is open, or cards are in the player's hand: undo and redo wait for neither. */
  get busy(): boolean { return this.depth > 0 || this.holding; }
  get canUndo(): boolean { return !this.busy && (this.at > 0 || this.pending.length > 0); }
  get canRedo(): boolean { return !this.busy && !this.pending.length && this.at < this.entries.length - 1; }

  /** The moves that led from the start to where the table is now, in order. */
  log(): MoveRecord[] {
    return this.entries.slice(1, this.at + 1).flatMap((step) => step.moves);
  }

  /** Called with every change: a step recorded, an undo, a redo, a reset, a load. */
  on(event: 'change', handler: (change: HistoryChange) => void): Dispose {
    this.listeners.add(handler);
    return () => { this.listeners.delete(handler); };
  }

  // --- recording -------------------------------------------------------------

  /**
   * Opens a group: everything moved until the matching `end` is one step.
   * Groups nest; the outermost one's label is kept.
   */
  begin(label?: string): void {
    if (this.depth === 0) {
      // Whatever was already waiting belongs to the action before.
      this.flush();
      this.groupLabel = label;
    }
    this.depth++;
  }

  /** Closes a group, and records it as one step if anything changed. Answers whether it did. */
  end(): boolean {
    if (this.depth === 0) return false;
    this.depth--;
    if (this.depth > 0) return false;
    const label = this.groupLabel;
    this.groupLabel = undefined;
    return this.record(label, true);
  }

  /** Runs a sequence - a deal, an animated turn - as one step. */
  async group<T>(sequence: () => T | Promise<T>, label?: string): Promise<T> {
    this.begin(label);
    try {
      return await sequence();
    } finally {
      this.end();
    }
  }

  /**
   * Records a step now, for a change the table did not announce with a
   * move - a card turned over in place, the game's own state changed.
   * Answers whether anything had changed.
   */
  commit(label?: string): boolean {
    if (this.depth > 0) return false;
    return this.record(label, true);
  }

  /** Forgets everything: the table and game as they are now are the start. A new game. */
  reset(): void {
    this.depth = 0;
    this.groupLabel = undefined;
    this.pending = [];
    this.holding = false;
    this.entries = [this.snapshot([])];
    this.at = 0;
    this.emit('reset');
  }

  // --- going back and forth ---------------------------------------------------

  /** Puts the table and game back one step, animated. Resolves true once landed, false if it could not. */
  undo(options?: RestoreOptions): Promise<boolean> {
    if (this.busy) return Promise.resolve(false);
    this.flush();
    if (this.at === 0) return Promise.resolve(false);
    return this.go(this.at - 1, 'undo', options);
  }

  /** Makes the step undone last again, animated. */
  redo(options?: RestoreOptions): Promise<boolean> {
    if (this.busy) return Promise.resolve(false);
    this.flush();
    if (this.at >= this.entries.length - 1) return Promise.resolve(false);
    return this.go(this.at + 1, 'redo', options);
  }

  // --- saving -------------------------------------------------------------------

  /** The whole history as JSON-safe data. */
  toJSON(): SavedHistory<G> {
    this.flush();
    return { steps: copy(this.entries), index: this.at };
  }

  /**
   * Takes a saved history and puts the table and game where it was, at once
   * (no flights, no flips: a game resumed). Answers false, changing nothing,
   * for data that is malformed or names zones or cards this table has not.
   */
  load(saved: unknown, options: RestoreOptions = { instant: true }): boolean {
    if (!isSavedHistory(saved)) return false;
    if (!saved.steps.every((step) => this.fits(step.table))) return false;
    this.depth = 0;
    this.pending = [];
    this.entries = copy(saved.steps) as HistoryStep<G>[];
    if (this.entries.length > this.cap + 1) {
      const drop = this.entries.length - this.cap - 1;
      this.entries.splice(0, Math.min(drop, saved.index));
      this.at = saved.index - Math.min(drop, saved.index);
    } else this.at = saved.index;
    void this.show(this.entries[this.at], options);
    this.emit('load');
    return true;
  }

  /** Stops listening to the table. */
  destroy(): void {
    for (const off of this.offs.splice(0)) off();
    this.listeners.clear();
  }

  // --- inside ---------------------------------------------------------------------

  private onMove(move: TableMove): void {
    if (this.restoring) return;
    if (this.options.record && !this.options.record(move)) return;
    this.pending.push({
      cards: move.cards.map((c) => c.card.id), from: move.from?.id ?? null, to: move.to?.id ?? null, by: move.by,
    });
    if (this.depth > 0 || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.depth === 0) this.flush();
    });
  }

  /** Records whatever moves are waiting, if they are not inside a group. */
  private flush(): void {
    if (this.depth > 0 || !this.pending.length) return;
    this.record(undefined, false);
  }

  private record(label: string | undefined, always: boolean): boolean {
    const moves = this.pending;
    this.pending = [];
    if (!moves.length && !always) return false;
    const step = this.snapshot(moves, label);
    const now = this.entries[this.at];
    if (sameState(step.table, now.table) && JSON.stringify(step.game) === JSON.stringify(now.game)) return false;
    this.entries.splice(this.at + 1);
    this.entries.push(step);
    if (this.entries.length > this.cap + 1) this.entries.splice(0, this.entries.length - this.cap - 1);
    this.at = this.entries.length - 1;
    this.emit('step');
    return true;
  }

  private snapshot(moves: MoveRecord[], label?: string): HistoryStep<G> {
    const step: HistoryStep<G> = { table: cloneState(this.capture()), moves };
    if (this.options.game) step.game = copy(this.options.game.save());
    if (label !== undefined) step.label = label;
    return step;
  }

  private async go(index: number, cause: 'undo' | 'redo', options?: RestoreOptions): Promise<boolean> {
    this.at = index;
    const landed = this.show(this.entries[index], { ...this.options.restore, ...options });
    this.emit(cause);
    await landed;
    return true;
  }

  private show(step: HistoryStep<G>, options: RestoreOptions): Promise<void> {
    this.restoring = true;
    let landed: Promise<void>;
    try {
      landed = this.apply(cloneState(step.table), options);
      if (this.options.game && step.game !== undefined) this.options.game.load(copy(step.game));
    } finally {
      this.restoring = false;
    }
    return landed;
  }

  private emit(cause: HistoryChange['cause']): void {
    const change: HistoryChange = {
      cause, index: this.at, length: this.entries.length, canUndo: this.canUndo, canRedo: this.canRedo,
    };
    for (const listener of [...this.listeners]) listener(change);
  }
}

/** A history of a table's moves, with undo and redo. */
export function createHistory<G = undefined>(table: Table, options: HistoryOptions<G> = {}): History<G> {
  return new History(table, options);
}
