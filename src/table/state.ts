import type { CardSprite } from '../art/card-sprite.js';
import { buildDeck } from '../core/cards.js';
import { throwCard } from '../play/flight.js';
import { flipCard } from '../play/flip.js';
import { animatorOf } from '../scene/animator.js';
import type { SyncOptions, Table } from './table.js';

// The table's arrangement as plain data, and back.
//
// `table.sync` already shows a `{ zoneId: cardIds }` state by flying cards.
// What it leaves out is everything else a game needs to put a table back
// the way it was - an undo, a saved game, a replay: which side each card is
// showing (a solitaire column is face-down cards under face-up ones), and the
// cards let go loose on the felt, where they lie. A TableState is all of
// it, in JSON, and nothing about the sprites.
//
// It is the *logical* arrangement, not the frame on screen: a card thrown at
// a pile is in that pile from the moment it is thrown, and a card being
// turned over counts as the side it is turning to. So it can be read at any
// moment - mid-deal, mid-flight - and restoring it lands the same table.

/** A card lying loose on the felt, out of every zone. */
export interface LooseCard {
  id: string;
  x: number;
  y: number;
  angle: number;
}

/**
 * Where every card on a table is, as plain JSON: what `captureTable` reads
 * and `restoreTable` (and a save) puts back.
 */
export interface TableState {
  /** For each zone, the ids of its cards in order: index 0 first laid. `sync`'s shape. */
  zones: Record<string, string[]>;
  /** The ids of every card showing its face, sorted. Every other card is face down. */
  faceUp: string[];
  /** Cards on the table in no zone. */
  loose: LooseCard[];
}

/** What changed between two states: for a log, a test, or to skip a no-op. */
export interface StateDiff {
  /** Cards now somewhere else, or at another place in the same zone. */
  moved: { id: string; from: string | null; to: string | null }[];
  /** Cards now showing the other side. */
  flipped: string[];
  /** Cards on the table in one state and not the other. */
  added: string[];
  removed: string[];
}

export interface RestoreOptions extends SyncOptions {
  /**
   * Milliseconds a card that has to turn over waits before it turns, so a
   * card flying back does not roll at the same moment it leaves. Default 0.
   */
  flipDelay?: number;
}

const where = (state: TableState): Map<string, { zone: string | null; at: number }> => {
  const map = new Map<string, { zone: string | null; at: number }>();
  for (const [zone, ids] of Object.entries(state.zones)) ids.forEach((id, at) => map.set(id, { zone, at }));
  state.loose.forEach((card, at) => map.set(card.id, { zone: null, at }));
  return map;
};

/** A deep copy: states go on undo stacks, and nobody should share one. */
export function cloneState(state: TableState): TableState {
  return {
    zones: Object.fromEntries(Object.entries(state.zones).map(([id, ids]) => [id, [...ids]])),
    faceUp: [...state.faceUp],
    loose: state.loose.map((card) => ({ ...card })),
  };
}

/** Whether two states are the same arrangement: the same cards, in the same order, on the same sides. */
export function sameState(a: TableState, b: TableState): boolean {
  const za = Object.keys(a.zones);
  if (za.length !== Object.keys(b.zones).length) return false;
  for (const id of za) {
    const x = a.zones[id];
    const y = b.zones[id];
    if (!y || x.length !== y.length || x.some((card, i) => card !== y[i])) return false;
  }
  if (a.faceUp.length !== b.faceUp.length || a.faceUp.some((id, i) => id !== b.faceUp[i])) return false;
  if (a.loose.length !== b.loose.length) return false;
  return a.loose.every((card, i) => {
    const other = b.loose[i];
    return other.id === card.id && Math.abs(other.x - card.x) < 0.5 && Math.abs(other.y - card.y) < 0.5
      && Math.abs(other.angle - card.angle) < 1e-3;
  });
}

/** What would have to happen to `from` to make it `to`. */
export function diffStates(from: TableState, to: TableState): StateDiff {
  const a = where(from);
  const b = where(to);
  const moved: StateDiff['moved'] = [];
  const added: string[] = [];
  for (const [id, now] of b) {
    const was = a.get(id);
    if (!was) { added.push(id); continue; }
    if (was.zone !== now.zone || was.at !== now.at) moved.push({ id, from: was.zone, to: now.zone });
  }
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const upA = new Set(from.faceUp);
  const upB = new Set(to.faceUp);
  const flipped = [...b.keys()].filter((id) => a.has(id) && upA.has(id) !== upB.has(id));
  return { moved, flipped, added, removed };
}

/**
 * Whether something read back from storage is a well-formed TableState:
 * the right shapes, and no card in two places. It says nothing about
 * whether a particular table has those zones and cards - `stateFits` does.
 */
export function isTableState(value: unknown): value is TableState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<TableState>;
  if (!state.zones || typeof state.zones !== 'object' || Array.isArray(state.zones)) return false;
  if (!Array.isArray(state.faceUp) || !Array.isArray(state.loose)) return false;
  const seen = new Set<string>();
  const once = (id: unknown) => typeof id === 'string' && !seen.has(id) && Boolean(seen.add(id));
  for (const ids of Object.values(state.zones)) {
    if (!Array.isArray(ids) || !ids.every(once)) return false;
  }
  for (const card of state.loose) {
    if (!card || typeof card !== 'object' || !once(card.id)) return false;
    if (![card.x, card.y, card.angle].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  }
  return state.faceUp.every((id) => typeof id === 'string' && seen.has(id));
}

/**
 * Whether a state can be shown on a table: every zone it names is one of
 * the table's, and every card one it knows. A save from an older layout
 * fails this rather than throwing half way through a restore.
 */
export function stateFits(state: TableState, zones: Iterable<string>, cards: Iterable<string>): boolean {
  const zoneIds = new Set(zones);
  const cardIds = new Set(cards);
  return Object.keys(state.zones).every((id) => zoneIds.has(id))
    && Object.values(state.zones).every((ids) => ids.every((id) => cardIds.has(id)))
    && state.loose.every((card) => cardIds.has(card.id));
}

/**
 * The side a card will be showing once what is under way has finished: a
 * flip's target, else the side of the zone it is flying into, else its own.
 */
function sideOf(table: Table, card: CardSprite): boolean {
  const going = animatorOf(table.board).intent(card, 'flip');
  if (typeof going === 'boolean') return going;
  const zone = table.zoneOf(card);
  if (zone && table.isMoving(card) && zone.rules.faceUp !== undefined) return zone.rules.faceUp;
  return card.card.faceUp;
}

/** Reads the table's whole arrangement - zones, sides, loose cards - as plain data. */
export function captureTable(table: Table): TableState {
  const zones: Record<string, string[]> = {};
  const faceUp: string[] = [];
  const loose: LooseCard[] = [];
  for (const zone of table.zones) zones[zone.id] = zone.cards.map((card) => card.card.id);
  for (const card of table.cards) {
    if (sideOf(table, card)) faceUp.push(card.card.id);
    if (!table.zoneOf(card)) loose.push({ id: card.card.id, x: card.x, y: card.y, angle: card.angle });
  }
  faceUp.sort();
  loose.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { zones, faceUp, loose };
}

/** Whether a table could show this state: its zones, its cards. */
export function tableFits(table: Table, state: TableState): boolean {
  return stateFits(state, table.zones.map((z) => z.id),
    (table.options.cards ?? buildDeck()).map((c) => c.id));
}

/**
 * Puts a table back to a state: every card into its zone and place, turned
 * to its side, loose cards to where they lay, and cards the state does not
 * have taken off. Animated - cards fly back and turn back - or, with
 * `instant`, at once (a resumed game, before its first frame). Resolves when
 * everything has landed.
 *
 * The table's `move` events for it say `by: 'sync'`.
 */
export function restoreTable(table: Table, state: TableState, options: RestoreOptions = {}): Promise<void> {
  if (!tableFits(table, state)) throw new Error('restoreTable: the state names zones or cards this table does not have');
  const animator = animatorOf(table.board);
  const keep = new Set([...Object.values(state.zones).flat(), ...state.loose.map((c) => c.id)]);
  for (const card of table.cards) if (!keep.has(card.card.id)) table.remove(card);
  // Every zone named, so a card in none of them is let go loose; the sides
  // are the state's, not the zones' rules.
  const zones = Object.fromEntries(table.zones.map((z) => [z.id, state.zones[z.id] ?? []]));
  const flights: Promise<void>[] = [];
  // Cards already in the right zone but still on their way - a flick still
  // sliding, a throw from before - are sent to their place again, so nothing
  // under way carries on and lands them somewhere else afterwards.
  for (const zone of table.zones) {
    const ids = zones[zone.id];
    for (const card of [...zone.cards]) {
      if (table.isMoving(card) && ids.includes(card.card.id)) {
        flights.push(table.move(card, zone, { ...options, index: zone.cards.indexOf(card), flip: false, by: 'sync' }));
      }
    }
  }
  flights.push(table.sync(zones, { spins: 0, arc: 10, pop: false, duration: 260, stagger: 18, ...options, flip: false }));
  for (const at of state.loose) {
    const card = table.card(at.id) ?? table.make(at.id, at);
    if (options.instant) {
      animator.stop(card, 'move');
      card.setPosition(at.x, at.y);
      card.angle = at.angle;
    } else {
      flights.push(throwCard(table.board, card, at, { spins: 0, arc: 10, duration: 260, ...options }));
    }
  }
  const up = new Set(state.faceUp);
  for (const card of table.cards) {
    const side = up.has(card.card.id);
    if (options.instant) {
      animator.finish(card, 'flip');
      if (card.card.faceUp !== side) card.setFaceUp(side);
    } else {
      // Every flight above was sent with flip: false, cutting short any that
      // would have turned a card on landing: what is left is a flip under way.
      const going = animator.intent(card, 'flip');
      if ((typeof going === 'boolean' ? going : card.card.faceUp) === side) continue;
      flights.push(flipCard(table.board, card, { faceUp: side, lift: 10, duration: 220, delay: options.flipDelay ?? 0 }));
    }
  }
  return Promise.all(flights).then(() => undefined);
}
