import type { Dispose } from '../runtime/disposables.js';
import { type History, type SavedHistory, isSavedHistory } from './history.js';

// Saving a game, and coming back to it.
//
// A save is a history - every step's table and game state, and where along
// it the game is - in an envelope that says what it is: felt's own save
// format number, the game's id, and the game's own version of its state. It
// is written to a store (localStorage unless told otherwise) and read back
// on the next load, when `resume` puts the table where it was at once,
// before anything is drawn: no deal, no flights, no flash of a fresh table.
//
// A save that will not do - unreadable, another game's, written by a version
// of the game whose state looked different, or naming zones this table no
// longer has - is reported, not thrown, so the game can deal a new one.

/** The shape of felt's save envelope. Bumped when the envelope or the table state changes shape. */
export const SAVE_FORMAT = 1;

/** Where saves are kept: localStorage has this shape, so does a Map wrapped in three lines. */
export interface SaveStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A saved game as stored. */
export interface SavedGame<G = unknown> {
  format: number;
  /** Which game this is a save of. */
  game: string;
  /** The game's own version of its state. */
  version: number;
  /** Milliseconds since the epoch. */
  savedAt: number;
  history: SavedHistory<G>;
}

export type SaveProblem =
  /** Nothing saved. */
  | 'none'
  /** Not JSON, or not the shape of a save. */
  | 'corrupt'
  /** Another game's save under the same key. */
  | 'other-game'
  /** A save of another version of this game's state, with no `migrate` to bring it up to date. */
  | 'old-version'
  /** Written by a newer felt, in a format this one does not read. */
  | 'newer-format'
  /** A well-formed save the table cannot show: zones or cards it does not have. */
  | 'unfit'
  /** No store to read, or it threw (storage disabled, quota). */
  | 'unavailable';

export type SaveRead<G> = { ok: true; save: SavedGame<G> } | { ok: false; problem: SaveProblem };

export interface GameSaveOptions<G> {
  /** The game's id, stored in the save and checked on reading it. */
  id: string;
  /** The game's own state version. Default 1. */
  version?: number;
  /** Where to keep it. Default `localStorage`, if there is one. */
  store?: SaveStore | null;
  /** The key it is kept under. Default `felt:save:<id>`. */
  key?: string;
  /**
   * Brings a save of another version of the game up to this one, or answers
   * undefined to give it up. Without one, another version is 'old-version'.
   */
  migrate?: (save: SavedGame<unknown>) => SavedGame<G> | undefined;
  /** Milliseconds since the epoch, for `savedAt`. Default `Date.now`. */
  now?: () => number;
}

/** A store that keeps saves in memory: for tests, and pages without storage. */
export function memoryStore(): SaveStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

function defaultStore(): SaveStore | null {
  try {
    return (globalThis as { localStorage?: SaveStore }).localStorage ?? null;
  } catch {
    return null;   // a sandboxed frame throws on merely looking
  }
}

/** A history in its envelope, as a string. */
export function encodeSave<G>(history: SavedHistory<G>, id: string, version = 1, savedAt = Date.now()): string {
  const save: SavedGame<G> = { format: SAVE_FORMAT, game: id, version, savedAt, history };
  return JSON.stringify(save);
}

/** Reads a stored string back into a save, or says what is wrong with it. */
export function decodeSave<G>(text: string | null | undefined, options: Omit<GameSaveOptions<G>, 'store' | 'key'>): SaveRead<G> {
  if (text === null || text === undefined || text === '') return { ok: false, problem: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'corrupt' };
  }
  if (!data || typeof data !== 'object') return { ok: false, problem: 'corrupt' };
  let save = data as SavedGame<unknown>;
  if (typeof save.format !== 'number' || typeof save.game !== 'string' || typeof save.version !== 'number') {
    return { ok: false, problem: 'corrupt' };
  }
  if (save.format > SAVE_FORMAT) return { ok: false, problem: 'newer-format' };
  if (save.game !== options.id) return { ok: false, problem: 'other-game' };
  if (save.version !== (options.version ?? 1)) {
    const migrated = options.migrate?.(save);
    if (!migrated) return { ok: false, problem: 'old-version' };
    save = migrated;
  }
  if (!isSavedHistory(save.history)) return { ok: false, problem: 'corrupt' };
  return { ok: true, save: save as SavedGame<G> };
}

/** One game's save slot: write, read, resume, clear. */
export class GameSave<G = unknown> {
  readonly key: string;
  readonly store: SaveStore | null;

  constructor(readonly options: GameSaveOptions<G>) {
    this.key = options.key ?? `felt:save:${options.id}`;
    this.store = options.store === undefined ? defaultStore() : options.store;
  }

  /** Writes the history as it is now. Answers whether it was stored. */
  write(history: History<G>): boolean {
    if (!this.store) return false;
    try {
      this.store.setItem(this.key, encodeSave(history.toJSON(), this.options.id, this.options.version ?? 1,
        (this.options.now ?? Date.now)()));
      return true;
    } catch {
      return false;   // full, or storage turned off: the game goes on unsaved
    }
  }

  /** Reads the save back, without touching any table. */
  read(): SaveRead<G> {
    if (!this.store) return { ok: false, problem: 'unavailable' };
    let text: string | null;
    try {
      text = this.store.getItem(this.key);
    } catch {
      return { ok: false, problem: 'unavailable' };
    }
    return decodeSave<G>(text, this.options);
  }

  /** Whether there is a save at all (good or bad). */
  get exists(): boolean {
    try {
      return Boolean(this.store?.getItem(this.key));
    } catch {
      return false;
    }
  }

  /**
   * Reads the save and puts the table and game where it was, at once. A save
   * that will not do is cleared and reported, and nothing is changed: deal a
   * new game.
   */
  resume(history: History<G>): SaveRead<G> {
    const read = this.read();
    if (!read.ok) {
      if (read.problem !== 'none' && read.problem !== 'unavailable') this.clear();
      return read;
    }
    if (!history.load(read.save.history)) {
      this.clear();
      return { ok: false, problem: 'unfit' };
    }
    return read;
  }

  /** Forgets the save: a new game. */
  clear(): void {
    try {
      this.store?.removeItem(this.key);
    } catch {
      // nothing to forget it in
    }
  }
}

/** A save slot for a game. */
export function createSave<G = unknown>(options: GameSaveOptions<G>): GameSave<G> {
  return new GameSave(options);
}

export interface AutosaveOptions {
  /**
   * Something that says when the page goes away - the engine (`ctx.engine`),
   * whose `suspend` is pagehide, hidden and freeze. Saved then.
   */
  lifecycle?: { on(event: 'suspend', handler: () => void): Dispose };
  /** Save after every step, undo and redo, too. Default true. */
  afterStep?: boolean;
}

/**
 * Keeps a game saved: after each step (unless `afterStep: false`), when the
 * page is hidden, frozen or left, and once more when disposed - so give the
 * disposer to the scene (`ctx.scope.add(...)`) and leaving the scene saves
 * it too. Nothing is written in the middle of a group (a deal under way),
 * so a page closed mid-deal comes back to a new game rather than half of one.
 */
export function autosave<G>(history: History<G>, save: GameSave<G>, options: AutosaveOptions = {}): Dispose {
  const write = () => { if (!history.grouping) save.write(history); };
  const offs: Dispose[] = [];
  if (options.afterStep !== false) offs.push(history.on('change', write));
  if (options.lifecycle) offs.push(options.lifecycle.on('suspend', write));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const off of offs.splice(0)) off();
    write();
  };
}
