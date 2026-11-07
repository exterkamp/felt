import { type ThrowOptions, throwCard } from '../play/flight.js';
import type { Board } from '../scene/board.js';
import { PIECE_DEPTH, PIECE_FLYING_DEPTH } from './chip-stack.js';
import { type TokenStyle, tokenLook } from './piece-paint.js';
import { Piece } from './piece.js';

// A token: the dealer button, the blinds, a PASS marker, a player's colour.
// A disc or a pill with words on it, that moves between places.

export interface TokenOptions extends TokenStyle {
  /** Names it in `state()`. */
  id?: string;
  x?: number;
  y?: number;
  angle?: number;
}

export class Token extends Piece {
  override kind = 'token';
  readonly id: string;
  private style: TokenStyle;

  constructor(board: Board, options: TokenOptions & { id: string }) {
    super(board, tokenLook(board, options));
    this.id = options.id;
    this.style = { ...options };
    this.setPosition(options.x ?? 0, options.y ?? 0);
    this.angle = options.angle ?? 0;
    this.interactive = true;
    this.settle();
  }

  /** What it says. */
  get label(): string | undefined { return this.style.label; }

  /** Says something else, or changes colour: another look, painted once. */
  relabel(style: TokenStyle): this {
    this.style = { ...this.style, ...style };
    return this.restyle(tokenLook(this.board as Board, this.style));
  }

  /** Puts it at its depth for where it lies. */
  settle(): void {
    this.depth = PIECE_DEPTH + Math.round(this.y) * 256 + 200;
  }

  /**
   * Slides it to a place, lifted a little on the way - the dealer button
   * pushed to the next seat. Resolves when it is there. Asked again while
   * moving, it goes on from where it is to the new place.
   */
  moveTo(x: number, y: number, options: ThrowOptions = {}): Promise<void> {
    this.depth = PIECE_FLYING_DEPTH;
    return throwCard(this.board as Board, this, { x, y, angle: options.settleAngle ?? this.angle }, {
      spins: 0, arc: 14, pop: true, ease: 'Sine.easeInOut', ...options,
      onLand: () => { this.settle(); options.onLand?.(); },
    });
  }
}
