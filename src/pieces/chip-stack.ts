import { animatorOf } from '../scene/animator.js';
import type { Board } from '../scene/board.js';
import { throwCard } from '../play/flight.js';
import { type ChipLayout, type ChipPlace, ChipSet, chipStackLayout, stackValue } from './chips.js';
import { chipLook } from './piece-paint.js';
import { Piece } from './piece.js';

// Chips on the board, and the stacks they sit in.
//
// A stack is a place on the felt - a player's bank, a betting circle, the
// pot - that owns its chips, bottom first, and lays them out: each one a
// chip's thickness further up the board than the one under it, nudged and
// turned a little at random (from the stack's seed, so it is the same mess
// on every screen and after every redraw), twenty to a column. That is what
// makes a stack of twenty look like a stack from straight above: the rim of
// every chip under the top one shows as a sliver, edge spots and all.

/** Depths: every piece sits above the cards' zones, and below a card in the air. */
export const PIECE_DEPTH = 500_000;
/** A chip or token in flight, over everything but a card in flight. */
export const PIECE_FLYING_DEPTH = 900_000;

/** What a stack needs from the pieces it belongs to. */
export interface StackHost {
  readonly board: Board;
  readonly set: ChipSet;
  readonly diameter: number;
  /** A chip of this value, on the board, not in any stack. */
  chip(value: number, at?: { x: number; y: number }): Chip;
}

/** One chip. Its value is what it is. */
export class Chip extends Piece {
  /** The stack it is in, if any. */
  stack?: ChipStack;
  override kind = 'chip';

  constructor(board: Board, readonly value: number, set: ChipSet, diameter: number) {
    super(board, chipLook(board, set.of(value), diameter));
    this.interactive = true;
  }
}

export interface ChipStackOptions extends Omit<ChipLayout, 'diameter'> {
  /** Names it in `state()`. Default `stack-1`, `stack-2`... */
  id?: string;
  /** Where its bottom chip sits. */
  x: number;
  y: number;
  /** Its chips, bottom first. */
  chips?: readonly number[];
  /** What it says when it is empty, for the game: a name, a seat. */
  label?: string;
}

/** A hash of a string, for a stack's seed. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A place on the felt that holds chips. Made by `pieces.stack()`. */
export class ChipStack {
  readonly id: string;
  label?: string;
  private _x: number;
  private _y: number;
  /** Bottom first. Changed by the pieces' moves; read it, do not edit it. */
  readonly chips: Chip[] = [];
  readonly layoutOptions: ChipLayout;

  constructor(readonly host: StackHost, options: ChipStackOptions & { id: string }) {
    this.id = options.id;
    this.label = options.label;
    this._x = options.x;
    this._y = options.y;
    this.layoutOptions = {
      diameter: host.diameter,
      step: options.step,
      perColumn: options.perColumn,
      messy: options.messy,
      seed: options.seed ?? seedOf(options.id),
    };
    for (const value of options.chips ?? []) this.adopt(host.chip(value));
    this.layout();
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }

  /** Its chips' values, bottom first. */
  get values(): number[] { return this.chips.map((c) => c.value); }
  /** What it is worth. */
  get value(): number { return stackValue(this.values); }
  get count(): number { return this.chips.length; }
  get empty(): boolean { return this.chips.length === 0; }
  get top(): Chip | undefined { return this.chips[this.chips.length - 1]; }

  /** Where chip `index` of it sits, on the board. */
  place(index: number): ChipPlace {
    // The layout of one chip depends only on its index, so ask for it alone.
    const all = chipStackLayout(index + 1, this.layoutOptions);
    const p = all[index];
    return { ...p, x: this._x + p.x, y: this._y + p.y };
  }

  /** The depth chip `index` is drawn at: stacks nearer the bottom of the board in front. */
  depthOf(index: number): number {
    return PIECE_DEPTH + Math.round(this._y) * 256 + Math.min(255, index);
  }

  /** Moves the stack, and its chips with it. `duration` 0 jumps. */
  moveTo(x: number, y: number, duration = 0): void {
    this._x = x;
    this._y = y;
    this.layout(duration);
  }

  /**
   * Puts every chip where it belongs. Chips still flying in are left to
   * land; with a duration, the rest slide there rather than jump.
   */
  layout(duration = 0): void {
    const board = this.host.board;
    const animator = animatorOf(board);
    const places = chipStackLayout(this.chips.length, this.layoutOptions);
    this.chips.forEach((chip, i) => {
      if (animator.busy(chip, 'move')) return;
      const p = places[i];
      const x = this._x + p.x;
      const y = this._y + p.y;
      chip.depth = this.depthOf(i);
      if (duration > 0 && (Math.abs(chip.x - x) > 0.01 || Math.abs(chip.y - y) > 0.01)) {
        void throwCard(board, chip, { x, y, angle: p.angle }, { duration, spins: 0, pop: false, ease: 'Quad.easeOut' });
        return;
      }
      chip.setPosition(x, y, 0);
      chip.angle = p.angle;
    });
  }

  /**
   * Whether a point is over the stack: its bottom chip, the column of chips
   * above it, and any columns beside it.
   */
  contains(at: { x: number; y: number }, slack = 0): boolean {
    const r = this.host.diameter / 2 + slack;
    const columns = Math.max(1, Math.ceil(this.chips.length / (this.layoutOptions.perColumn ?? 20)));
    const step = this.layoutOptions.step ?? this.host.diameter * 0.075;
    const height = Math.min(this.chips.length, this.layoutOptions.perColumn ?? 20) * step;
    const right = (columns - 1) * this.host.diameter * 1.12;
    return at.x >= this._x - r && at.x <= this._x + right + r && at.y >= this._y - height - r && at.y <= this._y + r;
  }

  /** @internal Takes a chip in at the top, from anywhere, without moving it. */
  adopt(chip: Chip, index = this.chips.length): void {
    chip.stack?.release(chip);
    chip.stack = this;
    this.chips.splice(index, 0, chip);
  }

  /** @internal Lets a chip go, without moving it. */
  release(chip: Chip): void {
    const at = this.chips.indexOf(chip);
    if (at >= 0) this.chips.splice(at, 1);
    if (chip.stack === this) chip.stack = undefined;
  }
}
