import { throwCard } from '../play/flight.js';
import type { Board } from '../scene/board.js';
import { PIECE_DEPTH, PIECE_FLYING_DEPTH } from './chip-stack.js';
import { type PegMove, type PegState, type PegTrack, type PegTrackOptions, pegScore, pegTrack, scorePegs, startPegs } from './pegging.js';
import { pegBoardLook, pegLook } from './piece-paint.js';
import { Piece } from './piece.js';

// The cribbage board on the table: a wooden board (a piece, so it has a
// shadow and lies under the cards like anything else) and two pegs per
// player that leapfrog along it. `score` changes the state at once - the
// pegs are where the score says before they have moved - and hops the back
// peg over the front one into its hole.

export interface PegBoardOptions extends PegTrackOptions {
  id?: string;
  x: number;
  y: number;
  /** Degrees. A board turned to lie across the table. */
  angle?: number;
  /** One colour per player; there are as many lanes as colours. */
  colors: readonly string[];
  /** The wood. */
  wood?: string;
  /** Where the pegs start: each player's two pegs. Default both in the start holes. */
  state?: readonly PegState[];
}

export class PegBoard {
  readonly id: string;
  readonly track: PegTrack;
  readonly base: Piece;
  /** Each player's two pegs. */
  readonly pegs: [Piece, Piece][];
  private players: PegState[];
  private readonly angle: number;

  constructor(readonly board: Board, options: PegBoardOptions & { id: string }) {
    this.id = options.id;
    this.angle = options.angle ?? 0;
    this.track = pegTrack({ ...options, players: options.colors.length });
    this.base = new Piece(board, pegBoardLook(board, this.track, options.colors, options.wood));
    this.base.kind = 'peg-board';
    this.base.setPosition(options.x, options.y);
    this.base.angle = this.angle;
    this.base.depth = PIECE_DEPTH - 1000;
    const pitch = options.pitch ?? 6.4;
    this.players = options.colors.map((_, p) => options.state?.[p] ?? startPegs());
    this.pegs = options.colors.map((color) => [0, 1].map(() => {
      const peg = new Piece(board, pegLook(board, color, pitch * 0.92));
      peg.kind = 'peg';
      peg.shadowStrength = 0.8;
      return peg;
    }) as [Piece, Piece]);
    this.pegs.forEach((pair, p) => pair.forEach((peg, i) => this.seat(peg, p, this.players[p].pegs[i])));
  }

  /** Where hole `position` of `player`'s lane is, on the board. */
  hole(player: number, position: number): { x: number; y: number } {
    const local = this.track.hole(player, position);
    const a = (this.angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: this.base.x + local.x * c - local.y * s, y: this.base.y + local.x * s + local.y * c };
  }

  /** A player's pegs, as a copy. */
  state(player: number): PegState {
    return { pegs: [...this.players[player].pegs] as [number, number] };
  }

  /** A player's score: the front peg's hole. */
  score(player: number): number {
    return pegScore(this.players[player]);
  }

  /**
   * Scores `points` for a player: the back peg hops over the front one to
   * `front + points`. The state is the new one at once; resolves with the
   * move once the peg is in its hole.
   */
  peg(player: number, points: number): Promise<PegMove> {
    const move = scorePegs(this.players[player], points);
    this.players[player] = move.state;
    if (move.from === move.to) return Promise.resolve(move);
    const peg = this.pegs[player][move.peg];
    const to = this.hole(player, move.to);
    const from = this.hole(player, move.from);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    peg.depth = PIECE_FLYING_DEPTH + 20;
    return throwCard(this.board, peg, { x: to.x, y: to.y, angle: 0 }, {
      spins: 0, arc: 14 + Math.min(26, distance * 0.08), pop: true, ease: 'Sine.easeInOut',
      duration: Math.min(900, 320 + distance * 1.6),
      onLand: () => { peg.depth = this.depthAt(to.y); },
    }).then(() => move);
  }

  /** Puts both of a player's pegs back in the start holes, or where a saved state has them. */
  reset(player?: number, state: PegState = startPegs()): void {
    const all = player === undefined ? this.players.map((_, p) => p) : [player];
    for (const p of all) {
      this.players[p] = { pegs: [...state.pegs] as [number, number] };
      this.pegs[p].forEach((peg, i) => this.seat(peg, p, this.players[p].pegs[i]));
    }
  }

  private depthAt(y: number): number {
    return PIECE_DEPTH - 900 + Math.round(y);
  }

  private seat(peg: Piece, player: number, position: number): void {
    const at = this.hole(player, position);
    peg.setPosition(at.x, at.y, 0);
    peg.angle = 0;
    peg.depth = this.depthAt(at.y);
  }

  destroy(): void {
    this.base.destroy();
    for (const pair of this.pegs) for (const peg of pair) peg.destroy();
  }
}
