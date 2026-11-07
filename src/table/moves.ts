import type { Card } from '../core/cards.js';

// What the zones' rules allow, worked out without a board: which zones a
// handful of cards may go to, every move there is, one move worth hinting,
// and what a tap does to a selection. Pure, so a game's tests (and these
// specs) can ask it in node; `selection.ts` wires it to a Table.
//
// Everything is generic over the shape of a zone a Table's `Zone` already
// has - `cards`, `takes(card)`, `accepts(cards, from)` - so it works on the
// real thing and on three-line fakes alike.

/** Anything carrying a card: a CardSprite, or `{ card }` in a test. */
export interface Carded {
  readonly card: Card;
}

/** What the rules need of a zone. A Table's `Zone` is one. */
export interface RuleZone<C extends Carded = Carded> {
  readonly cards: readonly C[];
  /** What picking this card up would carry, or undefined if it may not be. */
  takes(card: C): C[] | undefined;
  /** Whether these cards may land here, coming from `from`. */
  accepts(cards: readonly Card[], from?: RuleZone<C>): boolean;
}

/** A move the rules allow: these cards, off `from`, onto `to`. */
export interface LegalMove<C extends Carded, Z extends RuleZone<C>> {
  cards: C[];
  from: Z | undefined;
  to: Z;
}

/**
 * The zones these cards may go to from `from`, by the zones' own `accepts`
 * - the same question a drop asks. Never `from` itself: putting cards back
 * is not a move.
 */
export function legalTargets<C extends Carded, Z extends RuleZone<C>>(
  cards: readonly C[], from: Z | undefined, zones: readonly Z[],
): Z[] {
  if (!cards.length) return [];
  const data = cards.map((c) => c.card);
  return zones.filter((zone) => zone !== from && zone.accepts(data, from));
}

export interface LegalMovesOptions<C extends Carded, Z extends RuleZone<C>> {
  /** Moves the game does not count - a king shuffled between empty columns. */
  filter?: (move: LegalMove<C, Z>) => boolean;
}

/**
 * Every move the zones' rules allow: each thing that may be picked up off
 * each zone (by `takes` - a top card, a run, any card) onto each zone that
 * accepts it.
 */
export function legalMoves<C extends Carded, Z extends RuleZone<C>>(
  zones: readonly Z[], options: LegalMovesOptions<C, Z> = {},
): LegalMove<C, Z>[] {
  const out: LegalMove<C, Z>[] = [];
  for (const from of zones) {
    for (const card of from.cards) {
      const cards = from.takes(card);
      if (!cards?.length) continue;
      for (const to of legalTargets(cards, from, zones)) {
        const move = { cards, from, to };
        if (!options.filter || options.filter(move)) out.push(move);
      }
    }
  }
  return out;
}

export interface HintOptions<C extends Carded, Z extends RuleZone<C>> extends LegalMovesOptions<C, Z> {
  /**
   * The game's own legal moves, when its rules are more than the zones'
   * (a turn order, a must-play). Default: `legalMoves` of the zones.
   */
  moves?: () => readonly LegalMove<C, Z>[];
  /** How good a move is; the highest is hinted, ties to the first found. */
  score?: (move: LegalMove<C, Z>) => number;
}

/** One move worth suggesting, or undefined if there is none. */
export function hintMove<C extends Carded, Z extends RuleZone<C>>(
  zones: readonly Z[], options: HintOptions<C, Z> = {},
): LegalMove<C, Z> | undefined {
  const all = options.moves
    ? options.moves().filter((m) => !options.filter || options.filter(m))
    : legalMoves(zones, options);
  let best: LegalMove<C, Z> | undefined;
  let most = -Infinity;
  for (const move of all) {
    const score = options.score ? options.score(move) : 0;
    if (score > most) { most = score; best = move; }
  }
  return best;
}

// --- tap-to-move --------------------------------------------------------------

/** A tap, as the state machine sees it: a card, a zone, either or neither. */
export interface Tap<C, Z> {
  card?: C;
  zone?: Z;
}

/**
 * What a tap does, given what is selected.
 *
 * - `select`: these become the selection (replacing it).
 * - `add`: these join it (multi-select).
 * - `deselect`: these leave it.
 * - `clear`: nothing is selected any more.
 * - `move`: the selection goes onto `to`.
 * - `refuse`: the selection may not go onto `to`; it stays selected.
 * - `none`: the tap means nothing to the selection.
 */
export type TapAction<C, Z> =
  | { kind: 'select'; cards: C[]; from: Z }
  | { kind: 'add'; cards: C[]; from: Z }
  | { kind: 'deselect'; cards: C[] }
  | { kind: 'clear' }
  | { kind: 'move'; cards: C[]; from: Z | undefined; to: Z }
  | { kind: 'refuse'; cards: C[]; from: Z | undefined; to: Z }
  | { kind: 'none' };

export interface TapRules<C, Z> {
  /** The zone a card is in. */
  zoneOf(card: C): Z | undefined;
  /** Taps add to the selection rather than replacing it. Default false. */
  multi?: boolean;
  /** Tapping a destination moves the selection there. Default true. */
  tapToMove?: boolean;
}

/**
 * The tap-to-move state machine: one tap, the selection before it, and the
 * zones' rules in; what to do out. Nothing is changed - the caller does it.
 *
 * With nothing selected, a tap on a card picks up what dragging it would
 * (`takes`: the card, or its run). With something selected, a tap on a
 * selected card lets go of it; a tap on a zone that `accepts` the selection
 * moves it there; a tap on another card that may be taken selects that
 * instead (or adds it, multi-selecting); a tap on a zone that refuses it is
 * refused; and a tap on the bare felt, or back on its own zone, clears it.
 * So moving onto a column wins over selecting its top card - tapping the
 * eight you want the seven on is a move, not a change of mind.
 */
export function decideTap<C extends Carded, Z extends RuleZone<C>>(
  selected: readonly C[], tap: Tap<C, Z>, rules: TapRules<C, Z>,
): TapAction<C, Z> {
  const { card } = tap;
  const zone = card ? rules.zoneOf(card) ?? tap.zone : tap.zone;
  const takes = card && zone ? zone.takes(card) : undefined;

  if (!selected.length) {
    return takes?.length ? { kind: 'select', cards: takes, from: zone! } : { kind: 'none' };
  }

  if (card && selected.includes(card)) {
    if (!rules.multi) return { kind: 'clear' };
    const group = (takes ?? [card]).filter((c) => selected.includes(c));
    return { kind: 'deselect', cards: group.length ? group : [card] };
  }

  const from = rules.zoneOf(selected[0]);
  const cards = [...selected];
  if (zone && zone !== from && rules.tapToMove !== false && zone.accepts(cards.map((c) => c.card), from)) {
    return { kind: 'move', cards, from, to: zone };
  }
  if (takes?.length) {
    return rules.multi
      ? { kind: 'add', cards: takes.filter((c) => !selected.includes(c)), from: zone! }
      : { kind: 'select', cards: takes, from: zone! };
  }
  if (zone && zone !== from && rules.tapToMove !== false) return { kind: 'refuse', cards, from, to: zone };
  return { kind: 'clear' };
}

// --- the selection set ----------------------------------------------------------

/** What changed in a selection. */
export interface SelectionChange<T> {
  /** Everything selected now, in the order it was selected. */
  items: readonly T[];
  added: readonly T[];
  removed: readonly T[];
}

/**
 * An ordered set with change events: what is selected. Every change that
 * changes something tells its listeners once, with what came and went; a
 * change that changes nothing tells nobody.
 */
export class SelectionSet<T> {
  private readonly list: T[] = [];
  private readonly listeners = new Set<(change: SelectionChange<T>) => void>();

  /** Everything selected, in the order it was selected. */
  get items(): readonly T[] { return this.list; }
  get size(): number { return this.list.length; }
  get empty(): boolean { return this.list.length === 0; }
  has(item: T): boolean { return this.list.includes(item); }

  /** Adds these, keeping what is there. */
  add(items: T | readonly T[]): void {
    const added = toList(items).filter((item, i, all) => !this.list.includes(item) && all.indexOf(item) === i);
    if (!added.length) return;
    this.list.push(...added);
    this.changed(added, []);
  }

  /** Takes these out. */
  remove(items: T | readonly T[]): void {
    const gone = new Set(toList(items));
    const removed = this.list.filter((item) => gone.has(item));
    if (!removed.length) return;
    this.list.splice(0, this.list.length, ...this.list.filter((item) => !gone.has(item)));
    this.changed([], removed);
  }

  /** In if it was out, out if it was in. */
  toggle(item: T): void {
    if (this.has(item)) this.remove(item);
    else this.add(item);
  }

  /** Exactly these, in this order. */
  set(items: T | readonly T[]): void {
    const next = toList(items).filter((item, i, all) => all.indexOf(item) === i);
    const removed = this.list.filter((item) => !next.includes(item));
    const added = next.filter((item) => !this.list.includes(item));
    const reordered = !removed.length && !added.length && next.some((item, i) => this.list[i] !== item);
    if (!removed.length && !added.length && !reordered) return;
    this.list.splice(0, this.list.length, ...next);
    this.changed(added, removed);
  }

  clear(): void {
    this.set([]);
  }

  /** Listens for changes; answers how to stop. */
  on(listener: (change: SelectionChange<T>) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(added: T[], removed: T[]): void {
    const change = { items: [...this.list], added, removed };
    for (const listener of [...this.listeners]) listener(change);
  }
}

const toList = <T>(items: T | readonly T[]): T[] => (Array.isArray(items) ? [...items] : [items as T]);
