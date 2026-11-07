import { describe, expect, it } from 'vitest';
import { type Card, buildDeck, colorOf, rankValue } from '../core/index.js';
import { type RuleZone, SelectionSet, decideTap, hintMove, legalMoves, legalTargets } from './moves.js';

// A table's zones, three lines each: the same `takes` / `accepts` shape a
// Table's Zone has, over plain `{ card }` objects.

interface Held { readonly card: Card }

class FakeZone implements RuleZone<Held> {
  cards: Held[] = [];
  constructor(
    readonly id: string,
    private readonly rule: (cards: readonly Card[], zone: FakeZone) => boolean,
    private readonly mode: 'top' | 'run' | false = 'top',
    private readonly canTake: (cards: readonly Card[]) => boolean = () => true,
  ) {}
  get top(): Held | undefined { return this.cards[this.cards.length - 1]; }
  takes(card: Held): Held[] | undefined {
    const at = this.cards.indexOf(card);
    if (!this.mode || at < 0) return undefined;
    const carried = this.mode === 'run' ? this.cards.slice(at) : card === this.top ? [card] : undefined;
    return carried && this.canTake(carried.map((c) => c.card)) ? carried : undefined;
  }
  accepts(cards: readonly Card[]): boolean { return this.rule(cards, this); }
}

const deck = new Map(buildDeck().map((c) => [c.id, c]));
const held = (id: string, faceUp = true): Held => ({ card: { ...deck.get(id)!, faceUp } });
const value = (c: Card) => rankValue(c.rank);
const red = (c: Card) => colorOf(c.suit) === 'red';

/** A column: one down in the other colour, a king when empty; face-up runs in sequence may be taken. */
const column = (id: string, ...ids: string[]) => {
  const zone = new FakeZone(id, (cards, z) => {
    const top = z.top?.card;
    return top ? top.faceUp && red(cards[0]) !== red(top) && value(cards[0]) === value(top) - 1 : value(cards[0]) === 13;
  }, 'run', (cards) => cards.every((c, k) => c.faceUp
    && (k === 0 || (red(c) !== red(cards[k - 1]) && value(c) === value(cards[k - 1]) - 1))));
  zone.cards = ids.map((i) => held(i.replace('*', ''), !i.startsWith('*')));
  return zone;
};
const foundation = (suit: string) => new FakeZone(`f-${suit}`, ([c, ...more], z) =>
  !more.length && c.suit === suit && value(c) === (z.top ? value(z.top.card) : 0) + 1, false);

describe('legalTargets', () => {
  it('is every zone whose accepts takes the cards, never the one they came from', () => {
    const a = column('a', 'spades-8');
    const b = column('b', 'hearts-9');
    const c = column('c', 'diamonds-9');
    const d = column('d', 'clubs-9');
    const e = column('e');
    const seven = column('g', 'hearts-7');
    expect(legalTargets(a.cards, a, [a, b, c, d, e]).map((z) => z.id)).toEqual(['b', 'c']);
    // The red seven may go on the black eight, and only there.
    expect(legalTargets(seven.cards, seven, [a, b, c, d, e, seven]).map((z) => z.id)).toEqual(['a']);
  });

  it('asks about the whole run, by its first card', () => {
    const from = column('from', '*clubs-2', 'hearts-Q', 'spades-J');
    const king = column('king', 'clubs-K');
    const empty = column('empty');
    const run = from.takes(from.cards[1])!;
    expect(run.map((c) => c.card.id)).toEqual(['hearts-Q', 'spades-J']);
    expect(legalTargets(run, from, [from, king, empty]).map((z) => z.id)).toEqual(['king']);
  });

  it('is nothing for nothing', () => {
    const a = column('a');
    expect(legalTargets([], undefined, [a])).toEqual([]);
  });
});

describe('legalMoves and hintMove', () => {
  const setup = () => {
    const f = foundation('hearts');
    const a = column('a', '*spades-3', 'hearts-A');
    const b = column('b', 'clubs-8');
    const c = column('c', 'diamonds-7');
    return { f, a, b, c, zones: [f, a, b, c] };
  };

  it('finds every pick-up the rules allow onto every zone that takes it', () => {
    const { zones } = setup();
    const moves = legalMoves(zones).map((m) => `${m.cards.map((x) => x.card.id).join('+')}>${m.to.id}`);
    expect(moves).toEqual(['hearts-A>f-hearts', 'diamonds-7>b']);
  });

  it('leaves out what a filter turns down', () => {
    const { zones } = setup();
    expect(legalMoves(zones, { filter: (m) => m.to.id !== 'b' }).map((m) => m.to.id)).toEqual(['f-hearts']);
  });

  it('hints the best-scored move, or the first when nothing scores', () => {
    const { zones } = setup();
    expect(hintMove(zones)!.to.id).toBe('f-hearts');
    expect(hintMove(zones, { score: (m) => (m.to.id === 'b' ? 1 : 0) })!.to.id).toBe('b');
    // The game's own move list, when its rules are more than the zones'.
    const only = legalMoves(zones)[1];
    expect(hintMove(zones, { moves: () => [only] })).toBe(only);
    expect(hintMove([column('x', 'clubs-K')])).toBeUndefined();
  });
});

describe('decideTap: the tap-to-move state machine', () => {
  const build = () => {
    const a = column('a', '*spades-2', 'hearts-9', 'spades-8');
    const b = column('b', 'diamonds-9');
    const c = column('c', 'clubs-10');
    const d = column('d', 'hearts-2');
    const empty = column('empty');
    const zones = [a, b, c, d, empty];
    const zoneOf = (card: Held) => zones.find((z) => z.cards.includes(card));
    return { a, b, c, d, empty, zoneOf };
  };

  it('with nothing selected, a tap picks up what a drag would: the card and its run', () => {
    const { a, zoneOf } = build();
    expect(decideTap([], { card: a.cards[2] }, { zoneOf })).toEqual({ kind: 'select', cards: [a.cards[2]], from: a });
    expect(decideTap([], { card: a.cards[1] }, { zoneOf })).toEqual({ kind: 'select', cards: a.cards.slice(1), from: a });
  });

  it('with nothing selected, a card the rules will not let go of, or the felt, does nothing', () => {
    const { a, empty, zoneOf } = build();
    expect(decideTap([], { card: a.cards[0] }, { zoneOf }).kind).toBe('none');   // face down
    expect(decideTap([], { zone: empty }, { zoneOf }).kind).toBe('none');
    expect(decideTap([], {}, { zoneOf }).kind).toBe('none');
  });

  it('a tap on a place that accepts the selection moves it there', () => {
    const { a, c, zoneOf } = build();
    const run = a.cards.slice(1);              // 9 of hearts, 8 of spades
    // Tapped on the ten of clubs - a card, but the move wins over selecting it.
    expect(decideTap(run, { card: c.cards[0] }, { zoneOf })).toEqual({ kind: 'move', cards: run, from: a, to: c });
    expect(decideTap(run, { zone: c }, { zoneOf })).toEqual({ kind: 'move', cards: run, from: a, to: c });
  });

  it('a tap on another card that may be taken selects it instead, or adds it with multi', () => {
    const { a, d, zoneOf } = build();
    const eight = [a.cards[2]];
    expect(decideTap(eight, { card: d.cards[0] }, { zoneOf })).toEqual({ kind: 'select', cards: [d.cards[0]], from: d });
    expect(decideTap(eight, { card: d.cards[0] }, { zoneOf, multi: true }))
      .toEqual({ kind: 'add', cards: [d.cards[0]], from: d });
  });

  it('a tap on a place that refuses it is refused, and the selection stays', () => {
    const { a, empty, zoneOf } = build();
    const eight = [a.cards[2]];
    expect(decideTap(eight, { zone: empty }, { zoneOf })).toEqual({ kind: 'refuse', cards: eight, from: a, to: empty });
  });

  it('a tap on a selected card lets go: all of it, or (multi) just that card', () => {
    const { a, zoneOf } = build();
    const run = a.cards.slice(1);
    expect(decideTap(run, { card: run[1] }, { zoneOf })).toEqual({ kind: 'clear' });
    expect(decideTap(run, { card: run[1] }, { zoneOf, multi: true })).toEqual({ kind: 'deselect', cards: [run[1]] });
  });

  it('a tap on the bare felt, or back on its own zone where nothing may be taken, clears it', () => {
    const { a, zoneOf } = build();
    const eight = [a.cards[2]];
    expect(decideTap(eight, {}, { zoneOf })).toEqual({ kind: 'clear' });
    expect(decideTap(eight, { card: a.cards[0] }, { zoneOf })).toEqual({ kind: 'clear' });
  });

  it('without tap-to-move, a destination tap does not move', () => {
    const { a, c, empty, zoneOf } = build();
    const run = a.cards.slice(1);
    expect(decideTap(run, { zone: c }, { zoneOf, tapToMove: false }).kind).toBe('clear');
    expect(decideTap(run, { zone: empty }, { zoneOf, tapToMove: false }).kind).toBe('clear');
  });

  it('plays a whole turn: select, change your mind, move', () => {
    const { a, b, c, zoneOf } = build();
    let selected: Held[] = [];
    const tap = (t: { card?: Held; zone?: FakeZone }) => {
      const action = decideTap(selected, t, { zoneOf });
      if (action.kind === 'select') selected = action.cards;
      if (action.kind === 'clear') selected = [];
      if (action.kind === 'move') {
        for (const card of action.cards) action.from!.cards.splice(action.from!.cards.indexOf(card), 1);
        action.to.cards.push(...action.cards);
        selected = [];
      }
      return action.kind;
    };
    expect(tap({ card: b.cards[0] })).toBe('select');       // the 9 of diamonds
    expect(tap({ card: a.cards[1] })).toBe('select');       // no: the 9-8 run
    expect(tap({ card: c.cards[0] })).toBe('move');         // onto the 10 of clubs
    expect(c.cards.map((x) => x.card.id)).toEqual(['clubs-10', 'hearts-9', 'spades-8']);
    expect(a.cards.map((x) => x.card.id)).toEqual(['spades-2']);
    expect(selected).toEqual([]);
  });
});

describe('SelectionSet', () => {
  it('keeps the order things were selected in, once each', () => {
    const set = new SelectionSet<string>();
    set.add(['b', 'a', 'b']);
    set.add('c');
    set.add('a');
    expect(set.items).toEqual(['b', 'a', 'c']);
    expect(set.has('a') && !set.has('z')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('tells its listeners what came and went, once per change, and nothing for no change', () => {
    const set = new SelectionSet<string>();
    const changes: unknown[] = [];
    set.on((c) => changes.push({ ...c }));
    set.add('a');
    set.add('a');
    set.toggle('b');
    set.toggle('a');
    set.set(['b', 'c']);
    set.set(['b', 'c']);
    set.remove('z');
    set.clear();
    set.clear();
    expect(changes).toEqual([
      { items: ['a'], added: ['a'], removed: [] },
      { items: ['a', 'b'], added: ['b'], removed: [] },
      { items: ['b'], added: [], removed: ['a'] },
      { items: ['b', 'c'], added: ['c'], removed: [] },
      { items: [], added: [], removed: ['b', 'c'] },
    ]);
  });

  it('stops telling a listener that has stopped listening', () => {
    const set = new SelectionSet<number>();
    let heard = 0;
    const off = set.on(() => heard++);
    set.add(1);
    off();
    set.add(2);
    expect(heard).toBe(1);
  });
});
