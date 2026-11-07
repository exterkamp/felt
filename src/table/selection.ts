import type { CardSprite } from '../art/card-sprite.js';
import type { Dispose } from '../runtime/disposables.js';
import { type Offset, animatorOf, zeroOffset } from '../scene/animator.js';
import type { BoardPointer } from '../scene/board.js';
import { type Highlight, type HighlightStyle, Highlights } from './highlight.js';
import {
  type HintOptions, type LegalMove, type SelectionChange, type TapAction, SelectionSet, decideTap, hintMove,
  legalTargets,
} from './moves.js';
import type { MoveOptions, Table, TableTap, Zone } from './table.js';

// Selecting cards, and moving them by tapping: the other way to play a
// table, for a phone held in one hand and for anyone who cannot drag.
//
// `selectable(table)` listens to the table's taps and runs them through the
// tap-to-move state machine (`decideTap`, in moves.ts): a tap picks up what a
// drag would - the card, or its run - and lifts and lights it; the places it
// may go light up; a tap on one of them moves it there, by the same
// `accepts` a drop asks; a tap on one that refuses flashes red. Any move of
// a selected card - tapped, dragged, the game's own - lets go of the
// selection. It can also light up where a dragged card may go, flash a
// refused drop, and hint a move.

/** A move a tap made, or was refused. */
export interface SelectionMove {
  cards: readonly CardSprite[];
  from: Zone | undefined;
  to: Zone;
}

type SelectionEvents = {
  /** What is selected changed. */
  change: SelectionChange<CardSprite>;
  /** A tap moved the selection. */
  move: SelectionMove;
  /** A tap asked to move the selection somewhere that would not take it. */
  refuse: SelectionMove;
};

export interface SelectableOptions {
  /** Taps add cards to the selection (and take them out) rather than replacing it. Default false. */
  multi?: boolean;
  /** A tap on a place moves the selection there. Default true. */
  tapToMove?: boolean;
  /** How high a selected card is lifted off the felt, in board units. 0 for not at all. Default 10. */
  lift?: number;
  /** How a selected card is lit. Default 'selected'. */
  style?: HighlightStyle;
  /** Light the places the selection may go: true for 'target', a style, or false. Default true. */
  targets?: boolean | HighlightStyle;
  /**
   * Light the places a *dragged* card may go, once it is really being
   * dragged rather than tapped. True for 'target', a style, or false.
   * Default false.
   */
  dragTargets?: boolean | HighlightStyle;
  /** Flash a refused tap-move or drop: true for 'refused', a style, or false. Default true. */
  refused?: boolean | HighlightStyle;
  /** How a tap-move flies. Default a short, flat throw. */
  move?: MoveOptions;
  /** The game's say on a tap-move the rules allow: false refuses it. */
  decide?: (move: SelectionMove) => boolean | void;
  /** Taps the selection should leave alone - the stock, a button on the felt. */
  ignore?: (tap: TableTap) => boolean;
}

export interface ShowHintOptions extends HintOptions<CardSprite, Zone> {
  /** How long it shows, ms. Default 3000. Any move takes it off sooner. */
  for?: number;
  /** Default 'hint'. */
  style?: HighlightStyle;
}

const styleOf = (option: boolean | HighlightStyle | undefined, fallback: string, on: boolean): HighlightStyle | undefined =>
  option === undefined ? (on ? fallback : undefined) : option === false ? undefined : option === true ? fallback : option;

/** What is selected on a table, and the taps that change it. See `selectable`. */
export class Selection {
  /** The selected cards, as a set with change events. */
  readonly set = new SelectionSet<CardSprite>();
  private readonly highlights: Highlights;
  private readonly lit = new Map<CardSprite, Highlight>();
  private readonly lifted = new Map<CardSprite, Offset>();
  private targetLights: Highlight[] = [];
  private hintLights: Highlight[] = [];
  private dragging?: { cards: readonly CardSprite[]; from: Zone | undefined; real: boolean };
  private refusedDrop?: { cards: readonly CardSprite[]; to: Zone | undefined };
  private readonly listeners = new Map<keyof SelectionEvents, Set<(event: never) => void>>();
  private readonly offs: Dispose[] = [];
  private readonly style: HighlightStyle;
  private readonly targetStyle?: HighlightStyle;
  private readonly dragStyle?: HighlightStyle;
  private readonly refusedStyle?: HighlightStyle;

  constructor(readonly table: Table, readonly options: SelectableOptions = {}) {
    const board = table.board;
    this.highlights = Highlights.of(board);
    this.style = options.style ?? 'selected';
    this.targetStyle = styleOf(options.targets, 'target', true);
    this.dragStyle = styleOf(options.dragTargets, 'target', false);
    this.refusedStyle = styleOf(options.refused, 'refused', true);

    this.offs.push(this.set.on((change) => {
      for (const card of change.removed) { this.lit.get(card)?.remove(); this.lit.delete(card); this.raise(card, false); }
      for (const card of change.added) {
        this.lit.set(card, this.highlights.card(card, this.style));
        this.raise(card, true);
      }
      this.refreshTargets();
      this.emit('change', change);
    }));

    this.offs.push(table.on('tap', (tap) => {
      if (options.ignore?.(tap)) return;
      this.tap(tap);
    }));
    // Whatever moves a selected card lets go of the selection; any move
    // changes what the selection may go onto.
    this.offs.push(table.on('move', ({ cards }) => {
      if (cards.some((c) => this.set.has(c))) this.set.clear();
      else this.refreshTargets();
    }));

    // Dragging. A tap on a draggable card is a pick-up and a put-back too,
    // so nothing here acts until the pointer has really travelled.
    this.offs.push(table.on('take', ({ cards, from }) => { this.dragging = { cards, from, real: false }; }));
    const drag = (pointer: BoardPointer) => {
      const d = this.dragging;
      if (!d || d.real || pointer.distance < 8) return;
      d.real = true;
      this.refreshTargets();
    };
    this.offs.push(table.on('drop', () => { this.dragging = undefined; this.refreshTargets(); }));
    this.offs.push(table.on('refuse', ({ cards, to }) => { this.refusedDrop = { cards, to }; }));
    // The board says pointerup after the table has handled the drop: that is
    // when it is known whether the refused drop was a drag or only a tap.
    const up = (pointer: BoardPointer) => {
      const refused = this.refusedDrop;
      this.refusedDrop = undefined;
      if (!refused || pointer.distance < 8 || !this.refusedStyle) return;
      if (refused.to) void this.highlights.flash(refused.to, this.refusedStyle);
      for (const card of refused.cards) void this.highlights.flash(card, this.refusedStyle);
    };
    board.on('drag', drag);
    board.on('pointerup', up);
    this.offs.push(() => { board.off('drag', drag); board.off('pointerup', up); });
  }

  /** The selected cards, in the order they were selected. */
  get cards(): readonly CardSprite[] { return this.set.items; }
  get empty(): boolean { return this.set.empty; }
  /** The zone the (first) selected card is in. */
  get from(): Zone | undefined { return this.set.empty ? undefined : this.table.zoneOf(this.set.items[0]); }

  /** Selects exactly these. */
  select(cards: CardSprite | readonly CardSprite[]): void { this.set.set(cards); }
  add(cards: CardSprite | readonly CardSprite[]): void { this.set.add(cards); }
  remove(cards: CardSprite | readonly CardSprite[]): void { this.set.remove(cards); }
  toggle(card: CardSprite): void { this.set.toggle(card); }
  clear(): void { this.set.clear(); }

  /** Where the selection may go, by the zones' rules. */
  targets(): Zone[] {
    return legalTargets(this.cards, this.from, this.table.zones);
  }

  /**
   * Feeds a tap through the tap-to-move rules and does what they say - what
   * a tap on the board does. For a keyboard or a screen reader to drive the
   * same game: `tap({ card })`, then `tap({ zone })`. Answers what it did.
   */
  tap(tap: { card?: CardSprite; zone?: Zone }): TapAction<CardSprite, Zone> {
    this.prune();
    const action = decideTap(this.cards, tap, {
      zoneOf: (c) => this.table.zoneOf(c), multi: this.options.multi, tapToMove: this.options.tapToMove,
    });
    switch (action.kind) {
      case 'select': this.set.set(action.cards); break;
      case 'add': this.set.add(action.cards); break;
      case 'deselect': this.set.remove(action.cards); break;
      case 'clear': this.set.clear(); break;
      case 'move': {
        if (this.options.decide?.(action) === false) {
          this.refuse(action);
          return { kind: 'refuse', cards: action.cards, from: action.from, to: action.to };
        }
        this.set.clear();
        void this.table.move(action.cards, action.to, {
          duration: 260, spins: 0, arc: 10, pop: false, together: action.cards.length > 1,
          ...this.options.move, by: 'tap',
        });
        this.emit('move', action);
        break;
      }
      case 'refuse': this.refuse(action); break;
      case 'none': break;
    }
    return action;
  }

  /**
   * Moves the selection onto a zone, if the rules let it - a tap on that
   * zone, without the tap. Answers whether it went.
   */
  moveTo(zone: Zone): boolean {
    if (this.set.empty) return false;
    return this.tap({ zone }).kind === 'move';
  }

  /**
   * Lights up one move worth making - its cards and where they would go -
   * pulsing, until `for` runs out or anything moves. Answers the move, or
   * undefined if there is none to make.
   */
  hint(options: ShowHintOptions = {}): LegalMove<CardSprite, Zone> | undefined {
    this.clearHint();
    const move = hintMove(this.table.zones, options);
    if (!move) return undefined;
    const style = options.style ?? 'hint';
    const life = { for: options.for ?? 3000 };
    this.hintLights = [
      ...move.cards.map((card) => this.highlights.card(card, style, life)),
      this.highlights.zone(move.to, style, life),
    ];
    const off = this.table.on('move', () => { off(); this.clearHint(); });
    this.offs.push(off);
    return move;
  }

  /** Stops listening and lets go of the selection. */
  dispose(): void {
    this.set.clear();
    this.clearHint();
    for (const off of this.offs.splice(0)) off();
    this.listeners.clear();
  }

  on<K extends keyof SelectionEvents>(event: K, handler: (event: SelectionEvents[K]) => void): Dispose {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(handler as (event: never) => void);
    return () => { set!.delete(handler as (event: never) => void); };
  }

  private emit<K extends keyof SelectionEvents>(event: K, payload: SelectionEvents[K]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) (handler as (e: SelectionEvents[K]) => void)(payload);
  }

  private refuse(move: SelectionMove): void {
    if (this.refusedStyle) void this.highlights.flash(move.to, this.refusedStyle);
    this.emit('refuse', move);
  }

  private clearHint(): void {
    for (const h of this.hintLights) h.remove();
    this.hintLights = [];
  }

  /** Cards the table has taken off altogether are not selected any more. */
  private prune(): void {
    const gone = this.cards.filter((c) => c.isDestroyed || this.table.card(c.card.id) !== c);
    if (gone.length) this.set.remove(gone);
  }

  /** The places lit: where the dragged cards may go, while dragging; else where the selection may. */
  private refreshTargets(): void {
    for (const h of this.targetLights) h.remove();
    this.targetLights = [];
    const d = this.dragging;
    if (d?.real) {
      if (!this.dragStyle) return;
      this.targetLights = legalTargets(d.cards, d.from, this.table.zones)
        .map((zone) => this.highlights.zone(zone, this.dragStyle!));
      return;
    }
    this.prune();
    if (!this.targetStyle || this.set.empty) return;
    this.targetLights = this.targets().map((zone) => this.highlights.zone(zone, this.targetStyle!));
  }

  /**
   * Lifts a selected card a little off the felt, or sets it back down - on
   * its own channel, so it composes with throws, flips and the pick-up, and
   * as fast as taps come: an offset animated up, then held while it is
   * selected, and animated back down.
   */
  private raise(card: CardSprite, up: boolean): void {
    const lift = this.options.lift ?? 10;
    if (lift <= 0 || card.isDestroyed) return;
    const rise = lift * 0.3;
    void animatorOf(this.table.board).play(card, {
      channel: 'select', policy: 'latest', intent: up, duration: up ? 140 : 120, ease: 'Quad.easeOut',
      start: () => {
        const resting = this.lifted.get(card);
        if (up === (resting !== undefined)) return false;
        if (resting) { card.removeOffset(resting); this.lifted.delete(card); }
        return true;
      },
      update: (t, offset) => {
        const k = up ? t : 1 - t;
        offset.z = lift * k;
        offset.y = -rise * k;
      },
      complete: () => {
        if (!up || card.isDestroyed) return;
        const held = { ...zeroOffset(), z: lift, y: -rise };
        card.addOffset(held);
        this.lifted.set(card, held);
      },
    });
  }
}

/**
 * Lets the player select cards on a table by tapping, and move them by
 * tapping where they should go - by the zones' own `accepts` and
 * `drag`/`canTake`, exactly as a drag would. Works alongside
 * `table.draggable()`, or without it.
 */
export function selectable(table: Table, options: SelectableOptions = {}): Selection {
  return new Selection(table, options);
}
