import { CardSprite, type CardStyle } from '../art/card-sprite.js';
import { type Card, buildDeck } from '../core/cards.js';
import { type Hand, defineHand, handPositions } from '../core/hand.js';
import {
  type FanDirection, type Place, type Point, type Rect, type Stack, type StackOrder, cardRect, defineStack,
  overlap, stackDepths, stackPositions, topCardIndex,
} from '../core/stack.js';
import { type FlickOptions, flickCard } from '../play/flick.js';
import { type ThrowOptions, throwCard } from '../play/flight.js';
import { flipCard } from '../play/flip.js';
import { layPlaces } from '../play/order.js';
import type { Dispose } from '../runtime/disposables.js';
import { animatorOf } from '../scene/animator.js';
import type { Board, BoardPointer } from '../scene/board.js';
import type { Node } from '../scene/node.js';

// The table: piles that own their cards.
//
// Underneath, felt's placement is geometry - a Stack or a Hand says where its
// nth card sits and nothing else - and every game used to keep its own array
// of sprites next to each one, lay it out by hand, pick depth bands, do the
// bookkeeping that lets two throws at one pile land in order, track the cards
// still in the air, and write the same forty lines of drag-and-drop. A Table
// does that once:
//
// - **zones** (`table.pile()`, `table.hand()`) hold their cards, lay them
//   out, keep them in a depth band of their own, and turn a card that lands
//   in them to their side (`faceUp`).
// - **moves** (`table.move(card, zone)`) are the one way a card changes
//   zone: it leaves its old one at once, is thrown at its place in the new
//   one, and lands. Moves to the same zone in a row land in order.
// - **rules** live on the zones - `accepts` (may these cards land here?)
//   and `drag`/`canTake` (may these be picked up?) - and everything that
//   asks uses them: dragging, the drop highlight, flicks' magnets.
// - **sync** (`table.sync({ pileId: cardIds })`) shows a game state that
//   lives elsewhere - a Simulation, a server, a replay - by moving whatever
//   is not where the state says.
//
// The game keeps its rules and its state; the table is the view and the
// hand on the cards. Nothing here is required: under it the primitives are
// all still there.

/** May these cards (in the order they would land) be put on this zone? */
export type Accepts = (cards: readonly Card[], zone: Zone, from: Zone | undefined) => boolean;

/** May these cards (the one picked up, and any carried on top of it) be taken? */
export type CanTake = (cards: readonly Card[], zone: Zone) => boolean;

export interface ZoneRules {
  /**
   * The side cards turn to when they land here: true face up, false face
   * down. Left out, a card keeps whichever side it arrives on.
   */
  faceUp?: boolean;
  /**
   * What a drag may pick up: 'top' the card drawn in front, 'run' any card
   * and every card over it (a solitaire column), 'any' any one card, false
   * nothing. Default 'top'.
   */
  drag?: 'top' | 'run' | 'any' | false;
  /** A further check before a pick-up: face-up cards only, an unbroken run. */
  canTake?: CanTake;
  /** Whether cards may be dropped (or flicked) here. Default: anything. */
  accepts?: Accepts;
}

export interface PileOptions extends ZoneRules {
  id: string;
  x: number;
  y: number;
  fan?: FanDirection;
  step?: number;
  maxSpread?: number;
  messy?: number;
  order?: StackOrder;
}

export interface HandOptions extends ZoneRules {
  id: string;
  x: number;
  y: number;
  step?: number;
  maxSpread?: number;
  radius?: number;
  facing?: number;
  order?: StackOrder;
}

/** How a move gets there. A throw's options, and a few of its own. */
export interface MoveOptions extends ThrowOptions {
  /** Where in the zone it goes. Default the end: on top, for a pile. */
  index?: number;
  /** Turn it to the zone's side when it lands. Default true. */
  flip?: boolean;
  /** Put it there with no flight at all. */
  instant?: boolean;
  /** Recorded on the `move` event. Default 'api'. */
  by?: MoveCause;
}

export type MoveCause = 'api' | 'deal' | 'drag' | 'flick' | 'sync';

export interface TableMove {
  cards: readonly CardSprite[];
  from: Zone | undefined;
  /** Undefined: let go loose on the felt (a flick that missed everything). */
  to: Zone | undefined;
  by: MoveCause;
}

export interface TableTap {
  /** The card tapped, if a card was. */
  card: CardSprite | undefined;
  /** The zone the tap was on: the card's, or the empty place's under it. */
  zone: Zone | undefined;
  pointer: BoardPointer;
}

export interface TableOptions {
  /** How the table's own cards look. */
  style?: CardStyle;
  /**
   * Every card the table may be asked to show by id, for `sync` and `deal`
   * by id. Default the standard deck.
   */
  cards?: readonly Card[];
  /** Defaults for every move's throw. */
  throws?: ThrowOptions;
  /** How long a zone takes to re-lay itself, in ms. Default 160. */
  relay?: number;
  /** Depth between one zone's band and the next. Default 1000. */
  band?: number;
}

export interface TableDealOptions extends MoveOptions {
  /** Cards to each zone per round. Default 1. */
  each?: number;
  /** Times round. Default 1. */
  rounds?: number;
  /** Milliseconds between one card leaving and the next. Default 90. */
  stagger?: number;
}

export interface SyncOptions extends MoveOptions {
  /** Milliseconds between one moved card leaving and the next. Default 40. */
  stagger?: number;
  /** Where a card the table has never shown comes from. Default: it appears in place. */
  from?: Point;
}

export interface DragOptions {
  /** An outline where the card will land, while it is over somewhere it may. Default true. */
  highlight?: boolean;
  /**
   * Let go moving fast and a single card is flicked, drawn in by the zones
   * that accept it. True for the defaults, or flick options. Default off.
   */
  flick?: boolean | (FlickOptions & { speed?: number; loose?: boolean });
  /**
   * The game's say, after the rules have passed a drop: true (or nothing) to
   * make the move, false to send the cards back, 'hold' to leave them where
   * they were dropped - for a server to confirm, and `sync` to settle.
   */
  decide?: (move: { cards: readonly CardSprite[]; from: Zone | undefined; to: Zone }) => boolean | 'hold' | void;
  /** How long the settle into place takes, in ms. Default 170. */
  settle?: number;
}

type Events = {
  move: TableMove;
  tap: TableTap;
  /** A drop the rules or the game turned down. */
  refuse: { cards: readonly CardSprite[]; from: Zone | undefined; to: Zone | undefined };
};

const FLYING_DEPTH = 1_000_000;
const HELD_DEPTH = 2_000_000;

/** Somewhere cards are: a pile or a hand. */
export abstract class Zone {
  /** The cards, in order: index 0 first laid (the bottom of a pile). */
  readonly list: CardSprite[] = [];

  constructor(readonly table: Table, readonly id: string, readonly kind: 'pile' | 'hand',
    public rules: ZoneRules, readonly base: number) {}

  abstract readonly order: StackOrder;
  /** Where each of `count` cards sits. */
  abstract places(count: number): Place[];

  get cards(): readonly CardSprite[] { return this.list; }
  get size(): number { return this.list.length; }
  get empty(): boolean { return this.list.length === 0; }
  /** The card drawn in front. */
  get top(): CardSprite | undefined {
    const at = topCardIndex(this, this.list.length);
    return at === undefined ? undefined : this.list[at];
  }
  /** The top card's data, for rules. */
  get topCard(): Card | undefined { return this.top?.card; }
  get faceUp(): boolean | undefined { return this.rules.faceUp; }

  /** Where the next card to land would sit. */
  next(): Place {
    const places = this.places(this.list.length + 1);
    return places[places.length - 1];
  }

  /** The area a card dropped on this zone lands on: its cards, and the next place. */
  bounds(): Rect {
    const size = this.table.cardSize();
    const rects = this.places(this.list.length + 1).map((p) => cardRect(p, size));
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  includes(card: CardSprite): boolean { return this.list.includes(card); }

  /** Whether these cards may land here, by its rules. */
  accepts(cards: readonly Card[], from?: Zone): boolean {
    return this.rules.accepts ? this.rules.accepts(cards, this, from) : true;
  }

  /** What picking up this card would carry - it and any over it - or undefined if it may not be taken. */
  takes(card: CardSprite): CardSprite[] | undefined {
    const mode = this.rules.drag ?? 'top';
    const at = this.list.indexOf(card);
    if (!mode || at < 0) return undefined;
    let carried: CardSprite[];
    if (mode === 'run') carried = this.list.slice(at);
    else if (mode === 'any' || card === this.top) carried = [card];
    else return undefined;
    if (this.rules.canTake && !this.rules.canTake(carried.map((c) => c.card), this)) return undefined;
    return carried;
  }

  /** Cards made and put here at once, no flight. */
  put(cards: readonly (Card | CardSprite)[]): CardSprite[] {
    const sprites = cards.map((c) => (c instanceof CardSprite ? c : this.table.make(c)));
    const faceUp = this.rules.faceUp;
    if (faceUp !== undefined) for (const s of sprites) if (s.card.faceUp !== faceUp) s.setFaceUp(faceUp);
    void this.table.move(sprites, this, { instant: true, flip: false });
    return sprites;
  }

  /** Moves cards here: `table.move(cards, this)`. */
  add(cards: CardSprite | readonly CardSprite[], options?: MoveOptions): Promise<void> {
    return this.table.move(cards, this, options);
  }

  /** Every card to its place. Cards in flight or in a hand are left alone. */
  layout(duration = this.table.relay): void {
    const except = this.list.filter((c) => this.table.isMoving(c));
    layPlaces(this.table.board, this.list, this.places(this.list.length), stackDepths(this, this.list.length),
      { base: this.base, duration, except });
    for (const c of except) c.depth = this.table.depthFor(c);
  }
}

export class Pile extends Zone {
  stack: Stack;
  constructor(table: Table, options: PileOptions, base: number) {
    super(table, options.id, 'pile', options, base);
    this.stack = defineStack(options);
  }
  get order(): StackOrder { return this.stack.order; }
  places(count: number): Place[] { return stackPositions(this.stack, count); }
  /** Reshapes it - another fan, step, place - and lays it out again. */
  reshape(options: Partial<Omit<PileOptions, 'id'>>, duration?: number): void {
    this.stack = defineStack({ ...this.stack, ...options, id: this.id });
    this.rules = { ...this.rules, ...options };
    this.layout(duration);
  }
}

export class HandZone extends Zone {
  hand: Hand;
  constructor(table: Table, options: HandOptions, base: number) {
    super(table, options.id, 'hand', options, base);
    this.hand = defineHand(options);
  }
  get order(): StackOrder { return this.hand.order; }
  places(count: number): Place[] { return handPositions(this.hand, count); }
  reshape(options: Partial<Omit<HandOptions, 'id'>>, duration?: number): void {
    this.hand = defineHand({ ...this.hand, ...options, id: this.id });
    this.rules = { ...this.rules, ...options };
    this.layout(duration);
  }
}

export class Table {
  readonly zones: Zone[] = [];
  readonly relay: number;
  private readonly sprites = new Map<string, CardSprite>();
  private readonly where = new Map<CardSprite, Zone>();
  /** Cards on their way somewhere, with the token of the move taking them. */
  private readonly moving = new Map<CardSprite, number>();
  private readonly held = new Set<CardSprite>();
  private readonly lookup: Map<string, Card>;
  private readonly listeners = new Map<keyof Events, Set<(event: never) => void>>();
  private readonly offs: (() => void)[] = [];
  private tokens = 0;
  private flights = 0;
  private busyFlag = false;
  private dragOff?: Dispose;

  constructor(readonly board: Board, readonly options: TableOptions = {}) {
    this.relay = options.relay ?? 160;
    this.lookup = new Map((options.cards ?? buildDeck()).map((c) => [c.id, c]));
    const tap = (pointer: BoardPointer) => {
      const node = this.board.pick(pointer.x, pointer.y, (n) => this.sprites.get((n as CardSprite).card?.id) === n);
      const card = node as CardSprite | undefined;
      const zone = card ? this.where.get(card) : this.zoneAt(pointer);
      this.emit('tap', { card, zone, pointer });
    };
    this.board.on('tap', tap);
    this.offs.push(() => this.board.off('tap', tap as never));
  }

  // --- zones ---------------------------------------------------------------

  /** A pile: a Stack that holds its cards. */
  pile(options: PileOptions): Pile {
    return this.addZone(new Pile(this, options, this.nextBand()));
  }

  /** A hand: cards held in an arc. */
  hand(options: HandOptions): HandZone {
    return this.addZone(new HandZone(this, options, this.nextBand()));
  }

  zone(id: string): Zone | undefined {
    return this.zones.find((z) => z.id === id);
  }

  /** The zone a card is in, or undefined for a card loose on the felt. */
  zoneOf(card: CardSprite): Zone | undefined {
    return this.where.get(card);
  }

  /** The zone whose place is under a point, if any: for taps on an empty pile. */
  zoneAt(at: Point): Zone | undefined {
    const size = this.cardSize();
    return [...this.zones].reverse().find((z) => overlap(cardRect(at, { width: 1, height: 1 }),
      z.empty ? cardRect(z.next(), size) : z.bounds()) > 0);
  }

  private addZone<Z extends Zone>(zone: Z): Z {
    if (this.zone(zone.id)) throw new Error(`a zone called ${zone.id} is already on this table`);
    this.zones.push(zone);
    return zone;
  }

  private nextBand(): number {
    return (this.zones.length + 1) * (this.options.band ?? 1000);
  }

  // --- cards ---------------------------------------------------------------

  /** A card the table knows, by id. */
  card(id: string): CardSprite | undefined {
    return this.sprites.get(id);
  }

  /** Every card the table has made. */
  get cards(): CardSprite[] {
    return [...this.sprites.values()];
  }

  /** Makes a card on the table (in no zone yet), in the table's style. */
  make(card: Card | string, at?: Point): CardSprite {
    const data = typeof card === 'string' ? this.lookup.get(card) : card;
    if (!data) throw new Error(`no card ${String(card)} on this table`);
    const existing = this.sprites.get(data.id);
    if (existing) return existing;
    const sprite = new CardSprite(this.board, { ...data }, this.options.style);
    if (at) sprite.setPosition(at.x, at.y);
    sprite.draggable = this.dragOff !== undefined;
    this.sprites.set(data.id, sprite);
    return sprite;
  }

  /** Takes a card off the table altogether. */
  remove(card: CardSprite): void {
    this.where.get(card)?.list.splice(this.where.get(card)!.list.indexOf(card), 1);
    this.where.delete(card);
    this.moving.delete(card);
    this.sprites.delete(card.card.id);
    card.destroy();
  }

  /** Every card off the table; the zones stay. */
  clear(): void {
    for (const card of this.cards) this.remove(card);
  }

  /** Whether a card is on its way somewhere, or in the hand. */
  isMoving(card: CardSprite): boolean {
    return this.moving.has(card) || this.held.has(card);
  }

  /** The size its cards are, for overlaps. */
  cardSize(): { width: number; height: number } {
    const any = this.sprites.values().next().value as CardSprite | undefined;
    return any ? { width: any.width, height: any.height } : { width: 60, height: 84 };
  }

  /** @internal The depth a moving card keeps while it moves. */
  depthFor(card: CardSprite): number {
    return this.held.has(card) ? card.depth : card.depth >= FLYING_DEPTH ? card.depth : FLYING_DEPTH + this.flights;
  }

  // --- moves ---------------------------------------------------------------

  /**
   * Moves cards to a zone. They leave where they were at once - so the game
   * can read the new arrangement straight away, and a second move to the
   * same zone aims past them - and fly to their places; each turns to the
   * zone's side as it lands. Resolves when all have landed.
   */
  move(cards: CardSprite | readonly CardSprite[], to: Zone, options: MoveOptions = {}): Promise<void> {
    const list = (Array.isArray(cards) ? [...cards] : [cards as CardSprite]);
    if (!list.length) return Promise.resolve();
    const from = this.where.get(list[0]);
    const left = new Set<Zone>();
    for (const card of list) {
      const was = this.where.get(card);
      if (was) {
        was.list.splice(was.list.indexOf(card), 1);
        left.add(was);
      }
    }
    const index = Math.max(0, Math.min(options.index ?? to.list.length, to.list.length));
    to.list.splice(index, 0, ...list);
    for (const card of list) this.where.set(card, to);
    // Put back where it came from, or re-ordered in place, is not a move to tell the game of.
    if (from !== to || left.size > 1) this.emit('move', { cards: list, from, to, by: options.by ?? 'api' });
    return this.fly(list, to, left, options);
  }

  /**
   * Deals cards off the top of one zone round others, the way a dealer does:
   * one to each in turn, `rounds` times round.
   */
  deal(from: Zone, to: readonly Zone[], options: TableDealOptions = {}): Promise<void> {
    const stagger = options.stagger ?? 90;
    const landed: Promise<void>[] = [];
    let n = 0;
    for (let round = 0; round < (options.rounds ?? 1); round++) {
      for (const zone of to) {
        for (let k = 0; k < (options.each ?? 1); k++) {
          const card = from.top;
          if (!card) return Promise.all(landed).then(() => undefined);
          landed.push(this.move(card, zone, { ...options, by: 'deal', delay: (options.delay ?? 0) + n++ * stagger }));
        }
      }
    }
    return Promise.all(landed).then(() => undefined);
  }

  /**
   * Shows a state kept elsewhere: for each zone named, the ids of the cards
   * in it, in order. Every card not where the state says flies there; cards
   * the table has not shown yet are made. Zones not named keep their cards,
   * less any the state put somewhere else.
   */
  sync(state: Readonly<Record<string, readonly string[]>>, options: SyncOptions = {}): Promise<void> {
    const stagger = options.stagger ?? 40;
    const moved = new Map<string, { cards: CardSprite[]; from: Zone | undefined; to: Zone }>();
    const touched = new Set<Zone>();
    const flights: { card: CardSprite; to: Zone }[] = [];
    const appear = new Set<CardSprite>();
    for (const [id, ids] of Object.entries(state)) {
      const to = this.zone(id);
      if (!to) throw new Error(`sync names a zone ${id} this table does not have`);
      const sprites = ids.map((cardId) => this.sprites.get(cardId) ?? this.make(cardId, options.from));
      for (const card of sprites) {
        const was = this.where.get(card);
        if (was === to) continue;
        if (was) {
          was.list.splice(was.list.indexOf(card), 1);
          touched.add(was);
        }
        const key = `${was?.id ?? ''}>${to.id}`;
        if (!moved.has(key)) moved.set(key, { cards: [], from: was, to });
        moved.get(key)!.cards.push(card);
        // Never seen and not told where from: it simply appears there.
        if (!was && !options.from && !this.moving.has(card)) appear.add(card);
        flights.push({ card, to });
      }
      to.list.length = 0;
      to.list.push(...sprites);
      for (const card of sprites) this.where.set(card, to);
      touched.add(to);
    }
    for (const move of moved.values()) this.emit('move', { ...move, by: 'sync' });
    const landed = flights.map(({ card, to }, i) => this.fly([card], to, new Set(),
      { ...options, instant: appear.has(card) || options.instant, delay: (options.delay ?? 0) + i * stagger }));
    for (const zone of touched) zone.layout();
    return Promise.all(landed).then(() => undefined);
  }

  /** Lets a card go loose on the felt, out of any zone, where it is. */
  release(card: CardSprite, by: MoveCause = 'api'): void {
    const was = this.where.get(card);
    if (!was) return;
    was.list.splice(was.list.indexOf(card), 1);
    this.where.delete(card);
    was.layout();
    this.emit('move', { cards: [card], from: was, to: undefined, by });
  }

  private fly(list: CardSprite[], to: Zone, left: Set<Zone>, options: MoveOptions): Promise<void> {
    const token = ++this.tokens;
    for (const card of list) {
      this.moving.set(card, token);
      if (!options.instant) card.depth = FLYING_DEPTH + ++this.flights;
    }
    for (const zone of left) if (zone !== to) zone.layout();
    // Everything already there makes room; the cards coming are left to their flights.
    to.layout();
    const places = to.places(to.list.length);
    const throws = { ...this.options.throws, ...options };
    const landed = list.map(async (card, i) => {
      const place = places[to.list.indexOf(card)] ?? to.next();
      if (options.instant) {
        animatorOf(this.board).stop(card, 'move');
        card.setPosition(place.x, place.y);
        card.angle = place.angle;
      } else {
        await throwCard(this.board, card, { x: place.x, y: place.y, angle: place.angle },
          { ...throws, delay: (throws.delay ?? 0) + i * 30 });
      }
      // Taken over by a later move: that one finishes the job.
      if (this.moving.get(card) !== token) return;
      this.moving.delete(card);
      const side = to.rules.faceUp;
      if (options.flip !== false && side !== undefined && card.card.faceUp !== side) {
        if (options.instant) card.setFaceUp(side);
        else await flipCard(this.board, card, { faceUp: side, lift: 10, duration: 220 });
      }
      if (this.where.get(card) === to) to.layout();
    });
    return Promise.all(landed).then(() => undefined);
  }

  // --- the game's sequences ------------------------------------------------

  /** Whether a `run` is going. */
  get busy(): boolean {
    return this.busyFlag;
  }

  /**
   * Runs a sequence - a deal, a shuffle and deal, an animation of a turn -
   * unless one is already running, so a button pressed twice is pressed once.
   */
  async run<T>(sequence: () => Promise<T>): Promise<T | undefined> {
    if (this.busyFlag) return undefined;
    this.busyFlag = true;
    try {
      return await sequence();
    } finally {
      this.busyFlag = false;
    }
  }

  // --- events --------------------------------------------------------------

  on<K extends keyof Events>(event: K, handler: (event: Events[K]) => void): Dispose {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(handler as (event: never) => void);
    return () => { set!.delete(handler as (event: never) => void); };
  }

  private emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) (handler as (e: Events[K]) => void)(payload);
  }

  // --- dragging --------------------------------------------------------------

  /**
   * Lets the player move cards by hand, by the zones' rules: a drag picks up
   * what `drag`/`canTake` allow, the outline shows where it would land, and
   * a drop moves it to the zone it is over most that `accepts` it - or sends
   * it back. With `flick`, a card let go fast is flicked, and drawn into the
   * zones that would accept it.
   */
  draggable(options: DragOptions = {}): Dispose {
    this.dragOff?.();
    const board = this.board;
    for (const card of this.sprites.values()) card.draggable = true;
    const flick = options.flick === true ? {} : options.flick || undefined;
    const settle = options.settle ?? 170;
    let outline: ReturnType<Board['graphic']> | undefined;
    if (options.highlight !== false) {
      const { width, height } = this.cardSize();
      outline = board.graphic(width + 6, height + 6, (pen, w, h) => {
        pen.strokeStyle = 'rgba(255, 209, 102, 0.95)';
        pen.lineWidth = 2.5;
        pen.beginPath();
        pen.roundRect(1.5, 1.5, w - 3, h - 3, 6);
        pen.stroke();
      }, { key: `table-outline-${width}x${height}`, depth: FLYING_DEPTH - 1 });
      outline.visible = false;
    }
    type Drag = { cards: CardSprite[]; from: Zone | undefined; grip: Point; offsets: Point[]; target?: Zone };
    let drag: Drag | undefined;

    const targetFor = (d: Drag): Zone | undefined => {
      const lead = d.cards[0];
      const rect = cardRect(lead, this.cardSize());
      const data = d.cards.map((c) => c.card);
      let best: Zone | undefined;
      let most = 0;
      for (const zone of this.zones) {
        if (zone === d.from || !zone.accepts(data, d.from)) continue;
        const area = overlap(rect, zone.bounds());
        if (area > most) { most = area; best = zone; }
      }
      return best;
    };

    const start = (pointer: BoardPointer, node: Node) => {
      const card = node as CardSprite;
      if (!this.sprites.has(card.card?.id) || this.sprites.get(card.card.id) !== card) return;
      const from = this.where.get(card);
      // In flight to somewhere: caught, it goes on from where it is.
      const catching = !from && flick?.loose !== false;
      const cards = from ? from.takes(card) : catching ? [card] : undefined;
      if (!cards || (from && cards.some((c) => this.moving.has(c) && !this.held.has(c)))) {
        pointer.refuse?.();
        return;
      }
      animatorOf(board).stop(card, 'move');
      if (!from) this.moving.delete(card);   // caught mid-flick
      drag = {
        cards, from, grip: { x: pointer.x - card.x, y: pointer.y - card.y },
        offsets: cards.map((c) => ({ x: c.x - card.x, y: c.y - card.y })),
      };
      cards.forEach((c, i) => { this.held.add(c); c.depth = HELD_DEPTH + i; c.angle = 0; });
    };

    const move = (pointer: BoardPointer) => {
      if (!drag) return;
      const x = pointer.x - drag.grip.x;
      const y = pointer.y - drag.grip.y;
      drag.cards.forEach((c, i) => c.setPosition(x + drag!.offsets[i].x, y + drag!.offsets[i].y));
      drag.target = targetFor(drag);
      if (outline) {
        outline.visible = drag.target !== undefined;
        if (drag.target) {
          const at = drag.target.next();
          outline.setPosition(at.x, at.y);
          outline.angle = at.angle;
        }
      }
    };

    const end = (pointer: BoardPointer) => {
      const d = drag;
      drag = undefined;
      if (!d) return;
      if (outline) outline.visible = false;
      for (const c of d.cards) this.held.delete(c);
      const to = targetFor(d);
      const velocity = pointer.velocity ?? { x: 0, y: 0 };
      const fast = Math.hypot(velocity.x, velocity.y) >= (flick?.speed ?? 450);
      const back = () => {
        if (d.from) void this.move(d.cards, d.from, { index: d.from.list.indexOf(d.cards[0]), duration: settle,
          spins: 0, arc: 6, pop: false, by: 'drag' });
      };
      if (flick && fast && d.cards.length === 1 && !to) {
        this.flickOut(d.cards[0], d.from, velocity, d.grip, flick, back);
        return;
      }
      if (!to) {
        if (d.from) {
          this.emit('refuse', { cards: d.cards, from: d.from, to: undefined });
          back();
        }
        return;
      }
      const say = options.decide?.({ cards: d.cards, from: d.from, to });
      if (say === false) { this.emit('refuse', { cards: d.cards, from: d.from, to }); back(); return; }
      if (say === 'hold') return;
      void this.move(d.cards, to, { duration: settle, spins: 0, arc: 6, pop: false, by: 'drag' });
    };

    board.on('dragstart', start);
    board.on('drag', move);
    board.on('dragend', end);
    const off = () => {
      board.off('dragstart', start as never);
      board.off('drag', move as never);
      board.off('dragend', end as never);
      outline?.destroy();
      for (const card of this.sprites.values()) card.draggable = false;
      if (this.dragOff === off) this.dragOff = undefined;
    };
    this.dragOff = off;
    return off;
  }

  /** A single card flicked: the zones that would take it pull it in. */
  private flickOut(card: CardSprite, from: Zone | undefined, velocity: Point, grip: Point,
    flick: FlickOptions & { loose?: boolean }, back: () => void): void {
    const targets = this.zones.filter((z) => z !== from && z.accepts([card.card], from));
    const { width, height } = this.cardSize();
    const token = ++this.tokens;
    this.moving.set(card, token);
    card.depth = FLYING_DEPTH + ++this.flights;
    void flickCard(this.board, card, velocity, {
      half: { x: width / 2, y: height / 2 },
      bounds: { left: 0, top: 0, right: this.board.width, bottom: this.board.height },
      ...flick,
      grip,
      magnets: targets.map((z) => ({ ...z.next(), reach: 90 })),
      onRest: (path) => {
        if (this.moving.get(card) !== token) return;
        this.moving.delete(card);
        const to = path.caught === undefined ? undefined : targets[path.caught];
        if (to) void this.move(card, to, { instant: true, by: 'flick' });
        else if (flick.loose !== false) this.release(card, 'flick');
        else back();
        flick.onRest?.(path);
      },
    });
  }

  /** Stops listening, and takes every card off the board. */
  destroy(): void {
    this.dragOff?.();
    for (const off of this.offs) off();
    this.clear();
    this.zones.length = 0;
    this.listeners.clear();
  }
}

/** A table on a board: zones that own their cards, moves, rules, drag-and-drop, sync. */
export function createTable(board: Board, options: TableOptions = {}): Table {
  return new Table(board, options);
}
