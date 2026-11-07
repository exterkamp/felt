import { type FlickOptions, type Magnet, flickCard } from '../play/flick.js';
import { popCard, throwCard } from '../play/flight.js';
import type { Dispose } from '../runtime/disposables.js';
import { animatorOf } from '../scene/animator.js';
import type { Board, BoardPointer } from '../scene/board.js';
import type { Node } from '../scene/node.js';
import { ChipSet, type Payment, exactChips, makeChange } from './chips.js';
import { Chip, ChipStack, type ChipStackOptions, PIECE_FLYING_DEPTH, type StackHost } from './chip-stack.js';
import { rollDice } from './dice.js';
import { Die, type DieOptions } from './die.js';
import type { PegState } from './pegging.js';
import { PegBoard, type PegBoardOptions } from './peg-board.js';
import { Token, type TokenOptions } from './token.js';

// The pieces on a table: what a Table is for cards, for everything else.
//
// A parallel API to the Table rather than zones of it, on purpose. A Table
// zone owns *cards* - identified, ordered, face up or down, synced by id -
// and its rules are about cards. Chips are none of that: two red fives are
// the same chip, a stack is a quantity, and what a dealer does with one
// (pays a bet out of it, breaks a hundred, colours up) has no card
// counterpart; dice and a peg board are not containers at all. So the words
// are the Table's - `stack()` for `pile()`, `move`, `draggable`, `on`,
// `state()`/`restore()` - and the arithmetic is chips.ts's, and neither
// needs the other.

export interface PiecesOptions {
  /** The denominations. Default the casino set. */
  set?: ChipSet;
  /** Of a chip, board units. Default 40. */
  diameter?: number;
}

/** How chips get from one stack to another. */
export interface ChipMoveOptions {
  /** Milliseconds each chip flies. Default from the distance. */
  duration?: number;
  /** Milliseconds between one chip leaving and the next. Default 45. */
  stagger?: number;
  /** How high they rise on the way. Default 18. */
  arc?: number;
  /** No flight: there at once. */
  instant?: boolean;
  /** Recorded on the `move` event. */
  by?: string;
}

export interface PiecesMove {
  chips: readonly Chip[];
  from: ChipStack | undefined;
  to: ChipStack;
  /** What changed hands. */
  value: number;
  by: string;
}

/** Plain data: everything needed to put the pieces back as they were. */
export interface PiecesState {
  stacks: { id: string; x: number; y: number; chips: number[] }[];
  tokens: { id: string; x: number; y: number; angle: number; label?: string }[];
  dice: { id: string; x: number; y: number; value: number; yaw: number }[];
  pegs: { id: string; players: PegState[] }[];
}

interface Events {
  move: PiecesMove;
  roll: { dice: readonly Die[]; values: number[] };
  drop: { node: Node; at: { x: number; y: number } };
}

export interface PiecesDragOptions {
  /** Which stacks chips may be dropped on. Default any. */
  accepts?: (chips: readonly Chip[], to: ChipStack, from: ChipStack | undefined) => boolean;
  /** Which chips can be picked up. Default every chip, and the ones on top of it come too. */
  canTake?: (chip: Chip, stack: ChipStack) => boolean;
  /** Let go while moving, chips and tokens slide on: a flick's options, or false. Default on. */
  flick?: FlickOptions | false;
  /** Dragging a die throws it, rolled from this seed source. Default Math.random. */
  dice?: false | (() => number);
}

export class Pieces implements StackHost {
  readonly set: ChipSet;
  readonly diameter: number;
  private readonly stackList: ChipStack[] = [];
  private readonly tokenList: Token[] = [];
  private readonly diceList: Die[] = [];
  private readonly boards: PegBoard[] = [];
  private readonly listeners = new Map<string, Set<(event: never) => void>>();
  private serial = 0;
  private flights = 0;
  /** Chips in the air, and which flight each is on: a chip sent on again is still in the air. */
  private readonly moving = new Map<Chip, number>();
  private dragOff?: Dispose;
  /** Whether pieces are draggable by hand: what a new chip or token is made as. */
  private handling = false;

  constructor(readonly board: Board, options: PiecesOptions = {}) {
    this.set = options.set ?? new ChipSet();
    this.diameter = options.diameter ?? 40;
    board.once('destroy', () => this.dragOff?.());
  }

  // --- making things -------------------------------------------------------

  /** A chip of this value, on the board, not in any stack. */
  chip(value: number, at?: { x: number; y: number }): Chip {
    const chip = new Chip(this.board, value, this.set, this.diameter);
    chip.draggable = this.handling;
    if (at) chip.setPosition(at.x, at.y);
    return chip;
  }

  /** A place for chips. */
  stack(options: ChipStackOptions): ChipStack {
    const id = options.id ?? this.nextId('stack');
    if (this.stackById(id)) throw new Error(`felt pieces: a stack called ${id} is already here`);
    const stack = new ChipStack(this, { ...options, id });
    this.stackList.push(stack);
    return stack;
  }

  /** A dealer button, a blind, a marker. */
  token(options: TokenOptions): Token {
    const token = new Token(this.board, { ...options, id: options.id ?? this.nextId('token') });
    token.draggable = this.handling;
    this.tokenList.push(token);
    return token;
  }

  /** A die. */
  die(options: DieOptions = {}): Die {
    const die = new Die(this.board, { ...options, id: options.id ?? this.nextId('die') });
    this.diceList.push(die);
    return die;
  }

  /** A cribbage board. */
  pegBoard(options: PegBoardOptions): PegBoard {
    const board = new PegBoard(this.board, { ...options, id: options.id ?? this.nextId('pegs') });
    this.boards.push(board);
    return board;
  }

  private nextId(kind: string): string {
    let id: string;
    do id = `${kind}-${++this.serial}`; while (this.stackById(id) || this.find(id));
    return id;
  }

  get stacks(): readonly ChipStack[] { return this.stackList; }
  get tokens(): readonly Token[] { return this.tokenList; }
  get dice(): readonly Die[] { return this.diceList; }
  get pegBoards(): readonly PegBoard[] { return this.boards; }

  stackById(id: string): ChipStack | undefined {
    return this.stackList.find((s) => s.id === id);
  }

  private find(id: string): Token | Die | PegBoard | undefined {
    return this.tokenList.find((t) => t.id === id) ?? this.diceList.find((d) => d.id === id)
      ?? this.boards.find((b) => b.id === id);
  }

  /** The stack under a point, if any - the front one where they overlap. */
  stackAt(at: { x: number; y: number }, slack = 0): ChipStack | undefined {
    return [...this.stackList].sort((a, b) => b.y - a.y).find((s) => s.contains(at, slack));
  }

  /** Takes a stack off the table, and its chips with it. */
  removeStack(stack: ChipStack): void {
    for (const chip of [...stack.chips]) { stack.release(chip); chip.destroy(); }
    const at = this.stackList.indexOf(stack);
    if (at >= 0) this.stackList.splice(at, 1);
  }

  // --- moving chips ----------------------------------------------------------

  /** Whether any chip is in the air. */
  get busy(): boolean {
    return this.moving.size > 0;
  }

  /**
   * Moves chips to a stack: they leave where they were at once (so the
   * values read right straight away) and fly, one after another, to their
   * places on top of it. Resolves when the last has landed.
   */
  move(chips: Chip | readonly Chip[] | ChipStack, to: ChipStack, options: ChipMoveOptions = {}): Promise<void> {
    const list = chips instanceof ChipStack ? [...chips.chips].reverse()
      : Array.isArray(chips) ? [...chips] : [chips as Chip];
    if (!list.length) return Promise.resolve();
    const from = list[0].stack;
    const sources = new Set(list.map((c) => c.stack).filter((s): s is ChipStack => s !== undefined));
    for (const chip of list) to.adopt(chip);
    for (const source of sources) if (source !== to) source.layout(140);
    this.emit('move', { chips: list, from, to, value: list.reduce((n, c) => n + c.value, 0), by: options.by ?? 'api' });
    if (options.instant) {
      to.layout();
      return Promise.resolve();
    }
    const stagger = options.stagger ?? 45;
    return Promise.all(list.map((chip, i) => {
      const index = to.chips.indexOf(chip);
      const place = to.place(index);
      const flight = ++this.flights;
      this.moving.set(chip, flight);
      chip.depth = PIECE_FLYING_DEPTH + flight;
      const distance = Math.hypot(place.x - chip.x, place.y - chip.y);
      return throwCard(this.board, chip, place, {
        duration: options.duration ?? Math.min(620, 260 + distance * 0.7),
        delay: i * stagger,
        spins: 0,
        arc: options.arc ?? 18,
        pop: false,
        ease: 'Cubic.easeOut',
      }).then(() => {
        if (this.moving.get(chip) !== flight) return;
        this.moving.delete(chip);
        if (chip.stack === to && !chip.isDestroyed) {
          const at = to.chips.indexOf(chip);
          chip.depth = to.depthOf(at);
          const p = to.place(at);
          chip.setPosition(p.x, p.y, 0);
          chip.angle = p.angle;
          void popCard(this.board, chip, 0.03);
        }
      });
    })).then(() => undefined);
  }

  /**
   * Pays `amount` from one stack to another - a bet, a blind, a payout -
   * making change in `from` first if no chips in it add up: the chip that
   * has to be broken pops into smaller ones on the stack, and then the
   * fewest chips that make the amount fly across. Resolves with what was
   * paid; the stacks' values are right as soon as it is called.
   */
  pay(from: ChipStack, to: ChipStack, amount: number, options: ChipMoveOptions = {}): Promise<Payment> {
    const payment = this.set.payFrom(from.values, amount);
    for (const broken of payment.broken) this.breakChip(from, broken.value, broken.into);
    const indices = exactChips(from.values, amount)!;
    const chips = indices.map((i) => from.chips[i]);
    return this.move(chips, to, { by: 'pay', ...options }).then(() => payment);
  }

  /** Every chip of several stacks into one: bets swept into the pot. */
  collect(froms: readonly ChipStack[], to: ChipStack, options: ChipMoveOptions = {}): Promise<void> {
    return Promise.all(froms.filter((s) => s !== to && !s.empty)
      .map((s) => this.move(s, to, { by: 'collect', stagger: 30, ...options }))).then(() => undefined);
  }

  /**
   * Breaks one chip of `value` at the top of the stack into `into` (its
   * change, by default), in place: it pops and the change takes its room.
   */
  breakChip(stack: ChipStack, value: number,
    into: readonly number[] = makeChange(value, this.set.values.filter((v) => v < value))): Chip[] {
    const at = stack.values.lastIndexOf(value);
    if (at < 0) throw new Error(`felt pieces: no ${value} chip in ${stack.id}`);
    const old = stack.chips[at];
    stack.release(old);
    old.destroy();
    const made = into.map((v) => {
      const chip = this.chip(v);
      stack.adopt(chip);
      return chip;
    });
    stack.layout();
    for (const chip of made) void popCard(this.board, chip, 0.12);
    return made;
  }

  /** Makes a stack up again in the fewest chips, in place. */
  colorUp(stack: ChipStack): void {
    this.replaceChips(stack, this.set.colorUp(stack.values));
    for (const chip of stack.chips) void popCard(this.board, chip, 0.06);
  }

  /**
   * Takes chips off the top of a stack into a new stack: `count` of them,
   * or `{ value }` worth (made change for, if need be). The new stack is
   * at `at`, and the chips fly there.
   */
  split(stack: ChipStack, take: number | { value: number }, at: { x: number; y: number },
    options: ChipMoveOptions & { id?: string } = {}): ChipStack {
    const into = this.stack({ id: options.id, x: at.x, y: at.y });
    if (typeof take === 'number') {
      void this.move(stack.chips.slice(Math.max(0, stack.count - take)).reverse(), into, options);
    } else {
      void this.pay(stack, into, take.value, options);
    }
    return into;
  }

  /** Puts one stack on top of another, and takes the empty one away. */
  merge(stack: ChipStack, into: ChipStack, options: ChipMoveOptions = {}): Promise<void> {
    const done = this.move(stack, into, { by: 'merge', ...options });
    this.stackList.splice(this.stackList.indexOf(stack), 1);
    return done;
  }

  private replaceChips(stack: ChipStack, values: readonly number[]): void {
    for (const chip of [...stack.chips]) {
      stack.release(chip);
      this.moving.delete(chip);
      chip.destroy();
    }
    for (const value of values) stack.adopt(this.chip(value));
    stack.layout();
  }

  // --- dice ------------------------------------------------------------------

  /**
   * Rolls several dice at once from one seed - a pair for craps - each
   * thrown from `from` to its own place near `to`. The values come from the
   * seed (or `values`), never from the animation: two screens rolling with
   * one seed see the same faces. Resolves with them once all have stopped.
   */
  roll(dice: readonly Die[], options: { seed?: number; values?: readonly number[];
    from?: { x: number; y: number }; to?: readonly { x: number; y: number }[] } = {}): Promise<number[]> {
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    const values = options.values ? [...options.values] : rollDice(seed, dice.length);
    this.emit('roll', { dice, values });
    return Promise.all(dice.map((die, i) => die.roll({
      value: values[i], seed: (seed + i * 7919) >>> 0, from: options.from, to: options.to?.[i],
    })));
  }

  // --- saving ------------------------------------------------------------------

  /** Everything, as plain data: what save, undo and a network can carry. */
  state(): PiecesState {
    return {
      stacks: this.stackList.map((s) => ({ id: s.id, x: s.x, y: s.y, chips: s.values })),
      tokens: this.tokenList.map((t) => ({ id: t.id, x: t.x, y: t.y, angle: t.angle, label: t.label })),
      // The yaw rounded: worked back out of a rotation, it is never quite the number it was set from.
      dice: this.diceList.map((d) => ({ id: d.id, x: d.x, y: d.y, value: d.value, yaw: Math.round(d.yaw * 1e6) / 1e6 })),
      pegs: this.boards.map((b) => ({ id: b.id, players: Array.from({ length: b.track.players }, (_, p) => b.state(p)) })),
    };
  }

  /**
   * Puts everything as a state says, at once: stacks made, moved, emptied
   * or taken away to match, tokens and dice set down, pegs in their holes.
   * Tokens, dice and peg boards are matched by id and must already exist.
   */
  restore(state: PiecesState): void {
    const keep = new Set(state.stacks.map((s) => s.id));
    for (const stack of [...this.stackList]) if (!keep.has(stack.id)) this.removeStack(stack);
    for (const saved of state.stacks) {
      const stack = this.stackById(saved.id) ?? this.stack({ id: saved.id, x: saved.x, y: saved.y });
      for (const chip of stack.chips) animatorOf(this.board).stop(chip, 'move');
      stack.moveTo(saved.x, saved.y);
      if (stack.values.join() !== saved.chips.join()) this.replaceChips(stack, saved.chips);
      else stack.layout();
    }
    for (const saved of state.tokens) {
      const token = this.tokenList.find((t) => t.id === saved.id);
      if (!token) continue;
      animatorOf(this.board).stop(token, 'move');
      if (saved.label !== undefined && saved.label !== token.label) token.relabel({ label: saved.label });
      token.setPosition(saved.x, saved.y, 0);
      token.angle = saved.angle;
      token.settle();
    }
    for (const saved of state.dice) this.diceList.find((d) => d.id === saved.id)?.set(saved.value, saved.x, saved.y, saved.yaw);
    for (const saved of state.pegs) {
      const board = this.boards.find((b) => b.id === saved.id);
      saved.players.forEach((p, i) => board?.reset(i, p));
    }
  }

  // --- events ------------------------------------------------------------------

  on<K extends keyof Events>(event: K, handler: (event: Events[K]) => void): Dispose {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(handler as (event: never) => void);
    return () => { set!.delete(handler as (event: never) => void); };
  }

  private emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) (handler as (e: Events[K]) => void)(payload);
  }

  // --- by hand -------------------------------------------------------------------

  /**
   * Lets the player move pieces by hand. A chip picked up brings every chip
   * on top of it, lifted and swinging as one; dropped on a stack that
   * accepts them they join it, dropped on the felt they become a stack of
   * their own, flicked they slide and are drawn into a stack they pass
   * close to. A token is carried and flicked the same way. A die dragged
   * and let go is thrown where it was going and rolls.
   */
  draggable(options: PiecesDragOptions = {}): Dispose {
    this.dragOff?.();
    const board = this.board;
    const animator = animatorOf(board);
    const accepts = options.accepts ?? (() => true);
    const canTake = options.canTake ?? (() => true);
    const flicks = options.flick === false ? undefined : options.flick ?? {};
    // Every chip and token from now on, too: change made, a stack restored.
    this.handling = true;
    for (const s of this.stackList) for (const c of s.chips) c.draggable = true;
    for (const t of this.tokenList) t.draggable = true;
    let held: { lead: Node; group: Chip[]; from?: ChipStack; grip: { x: number; y: number };
      rel: { x: number; y: number }[] } | undefined;
    let throwing: { die: Die; start: { x: number; y: number } } | undefined;

    const follow = () => {
      if (!held) return;
      held.group.forEach((chip, i) => {
        if (chip === held!.lead) return;
        chip.setPosition(held!.lead.x + held!.rel[i].x, held!.lead.y + held!.rel[i].y);
      });
    };

    const dragstart = (pointer: BoardPointer, node: Node) => {
      if (node instanceof Chip) {
        const from = node.stack;
        if (!from || !canTake(node, from) || this.moving.has(node)) { pointer.refuse?.(); return; }
        // It and the chips on it - in its own column, not the next one over.
        const index = from.chips.indexOf(node);
        const per = from.layoutOptions.perColumn ?? 20;
        const group = from.chips.slice(index, (Math.floor(index / per) + 1) * per);
        for (const chip of group) animator.stop(chip, 'move');
        held = { lead: node, group, from, grip: { x: pointer.x - node.x, y: pointer.y - node.y },
          rel: group.map((c) => ({ x: c.x - node.x, y: c.y - node.y })) };
        group.forEach((chip, i) => { chip.depth = PIECE_FLYING_DEPTH + 50_000 + i; });
        board.pickUp?.carry(node, group.filter((c) => c !== node));
        return;
      }
      if (node instanceof Token) {
        animator.stop(node, 'move');
        held = { lead: node, group: [], grip: { x: pointer.x - node.x, y: pointer.y - node.y }, rel: [] };
        node.depth = PIECE_FLYING_DEPTH + 60_000;
        return;
      }
      pointer.refuse?.();
    };
    const drag = (pointer: BoardPointer) => {
      if (!held) return;
      held.lead.setPosition(pointer.x - held.grip.x, pointer.y - held.grip.y);
      follow();
    };
    const dragend = (pointer: BoardPointer) => {
      const was = held;
      held = undefined;
      if (!was) return;
      const at = { x: pointer.x, y: pointer.y };
      this.emit('drop', { node: was.lead, at });
      const speed = Math.hypot(pointer.velocity.x, pointer.velocity.y);
      if (was.lead instanceof Token) {
        const token = was.lead;
        if (flicks && speed > 160) {
          void flickCard(board, token, pointer.velocity, {
            half: { x: token.width / 2, y: token.height / 2 },
            bounds: { left: 0, top: 0, right: board.width, bottom: board.height }, ...flicks,
            onRest: () => token.settle(),
          });
        } else token.settle();
        return;
      }
      const group = was.group;
      const lead = was.lead as Chip;
      const targets = this.stackList.filter((s) => s !== was.from && accepts(group, s, was.from));
      const over = targets.find((s) => s.contains(at, 6));
      if (over) { void this.move(group, over, { by: 'drag', arc: 6 }); return; }
      if (flicks && speed > 160) {
        // Slides on, the others riding with the one held; drawn into a
        // stack that would take them, as a flicked card is into a pile.
        const magnets: Magnet[] = targets.map((s) => ({ x: s.x, y: s.y, angle: 0, reach: this.diameter * 1.6 }));
        board.on('update', follow);
        held = was;
        void flickCard(board, lead, pointer.velocity, {
          half: { x: this.diameter / 2, y: this.diameter / 2 },
          bounds: { left: 0, top: 0, right: board.width, bottom: board.height },
          magnets, ...flicks,
          onRest: (path) => {
            board.off('update', follow);
            held = undefined;
            const caught = path.caught !== undefined ? targets[path.caught] : undefined;
            this.settleGroup(group, was.from, caught, { x: lead.x, y: lead.y }, 'flick');
          },
        });
        return;
      }
      // Set down on its own stack: back where it was. Anywhere else: a new stack.
      const home = was.from && was.from.contains(at, 6);
      this.settleGroup(group, was.from, home ? was.from : undefined, { x: lead.x, y: lead.y }, 'drag');
    };
    const pointerdown = (pointer: BoardPointer) => {
      const die = pointer.node?.data['die'];
      if (options.dice !== false && die instanceof Die && !die.rolling) throwing = { die, start: { x: pointer.x, y: pointer.y } };
    };
    const pointerup = (pointer: BoardPointer) => {
      const t = throwing;
      throwing = undefined;
      if (!t || pointer.distance < 12) return;
      const random = typeof options.dice === 'function' ? options.dice : Math.random;
      const v = pointer.velocity;
      const to = {
        x: Math.max(30, Math.min(board.width - 30, pointer.x + v.x * 0.18)),
        y: Math.max(30, Math.min(board.height - 30, pointer.y + v.y * 0.18)),
      };
      const seed = Math.floor(random() * 2 ** 31);
      const value = rollDice(seed, 1)[0];
      this.emit('roll', { dice: [t.die], values: [value] });
      void t.die.roll({ value, seed, from: { x: t.die.x, y: t.die.y }, to });
    };
    board.on('dragstart', dragstart);
    board.on('drag', drag);
    board.on('dragend', dragend);
    board.on('pointerdown', pointerdown);
    board.on('pointerup', pointerup);
    const off = () => {
      board.off('dragstart', dragstart);
      board.off('drag', drag);
      board.off('dragend', dragend);
      board.off('pointerdown', pointerdown);
      board.off('pointerup', pointerup);
      board.off('update', follow);
      this.handling = false;
      for (const s of this.stackList) for (const c of s.chips) c.draggable = false;
      for (const t of this.tokenList) t.draggable = false;
      if (this.dragOff === off) this.dragOff = undefined;
    };
    this.dragOff = off;
    return off;
  }

  /** Chips let go of: into a stack, or a new one where they lie. */
  private settleGroup(group: Chip[], from: ChipStack | undefined, into: ChipStack | undefined,
    at: { x: number; y: number }, by: string): void {
    if (into === from && from) {
      from.layout(160);
      return;
    }
    if (into) { void this.move(group, into, { by, arc: 4, stagger: 0, duration: 180 }); return; }
    const loose = this.stack({ x: at.x, y: at.y });
    for (const chip of group) loose.adopt(chip);
    from?.layout(140);
    loose.layout(160);
    this.emit('move', { chips: group, from, to: loose, value: group.reduce((n, c) => n + c.value, 0), by });
    // An emptied stack nobody named stays a place on the table; one made by hand goes.
    if (from && from.empty && /^stack-\d+$/.test(from.id)) this.stackList.splice(this.stackList.indexOf(from), 1);
  }

  /** Takes everything off the board. */
  destroy(): void {
    this.dragOff?.();
    for (const stack of [...this.stackList]) this.removeStack(stack);
    for (const token of this.tokenList.splice(0)) token.destroy();
    for (const die of this.diceList.splice(0)) die.destroy();
    for (const board of this.boards.splice(0)) board.destroy();
  }
}

/** Pieces for a board: chips, stacks, tokens, dice and peg boards. */
export function createPieces(board: Board, options: PiecesOptions = {}): Pieces {
  return new Pieces(board, options);
}
