// A cribbage board, as numbers.
//
// Each player has a lane of 121 holes - out along one row of 60, back along
// the next, and the game hole at the end - and two start holes, and two
// pegs. Scoring moves the *back* peg: it jumps over the front one to land
// as many holes ahead of it as were scored, so the gap between the two pegs
// is always the last score, and anyone can check the count. That is the
// whole of the logic, and it is here, away from the drawing, where it is
// tested.

/** Where one player's two pegs are. A position is a hole: -1 and 0 the start holes, 1-121 the track. */
export interface PegState {
  pegs: [number, number];
}

/** The game hole. */
export const PEG_GAME = 121;

/** Both pegs in the start holes. */
export function startPegs(): PegState {
  return { pegs: [0, -1] };
}

/** A player's score: where the front peg is (0 before scoring). */
export function pegScore(state: PegState): number {
  return Math.max(0, Math.max(state.pegs[0], state.pegs[1]));
}

/** What a score did: which peg (0 or 1) went from which hole to which. */
export interface PegMove {
  state: PegState;
  peg: 0 | 1;
  from: number;
  to: number;
}

/**
 * Scores `points`: the back peg leapfrogs the front one to `front + points`,
 * stopping in the game hole. A score of nothing moves nothing (`peg` is the
 * back one, and `from === to`).
 */
export function scorePegs(state: PegState, points: number): PegMove {
  const [a, b] = state.pegs;
  const back: 0 | 1 = a < b ? 0 : 1;
  const from = state.pegs[back];
  const front = Math.max(a, b);
  if (!(points > 0)) return { state: { pegs: [a, b] }, peg: back, from, to: from };
  const to = Math.min(PEG_GAME, Math.max(front, 0) + Math.round(points));
  const pegs: [number, number] = [a, b];
  pegs[back] = to;
  return { state: { pegs }, peg: back, from, to };
}

export interface PegTrackOptions {
  /** Lanes, one per player. Default 2. */
  players?: number;
  /** Between holes, board units. Default 6.4. */
  pitch?: number;
  /** The extra space between groups of five. Default 4. */
  groupGap?: number;
  /** Between the out row and the back row of a lane. Default 9. */
  rowGap?: number;
  /** Between one lane and the next. Default 7. */
  laneGap?: number;
  /** Round the holes to the board's edge. Default 10. */
  margin?: number;
}

/** A board's holes, from its middle. */
export interface PegTrack {
  readonly width: number;
  readonly height: number;
  readonly players: number;
  /** Where hole `position` (-1 to 121) of a player's lane is, from the board's middle. */
  hole(player: number, position: number): { x: number; y: number };
  /** Every hole on the board, for painting it. */
  holes(): { x: number; y: number; player: number; position: number }[];
}

/**
 * Lays out a long cribbage board: per player, holes 1-60 left to right,
 * 61-120 right to left on the row below, in groups of five; the two start
 * holes at the left of the out row and the game hole at the left of the
 * back one.
 */
export function pegTrack(options: PegTrackOptions = {}): PegTrack {
  const players = options.players ?? 2;
  const pitch = options.pitch ?? 6.4;
  const gap = options.groupGap ?? 4;
  const rowGap = options.rowGap ?? 9;
  const laneGap = options.laneGap ?? 7;
  const margin = options.margin ?? 10;
  const start = pitch * 3.2;
  const run = 59 * pitch + 11 * gap;
  const width = margin * 2 + start + run;
  const lane = rowGap * 2 + laneGap;
  const height = margin * 2 + players * lane - laneGap - rowGap;
  const left = -width / 2 + margin + start;
  const top = -height / 2 + margin;
  const along = (k: number) => left + (k - 1) * pitch + Math.floor((k - 1) / 5) * gap;
  const hole = (player: number, position: number) => {
    const y = top + player * lane;
    if (position <= 0) return { x: left - pitch * (position === 0 ? 1.6 : 2.8), y };
    if (position <= 60) return { x: along(position), y };
    if (position <= 120) return { x: along(121 - position), y: y + rowGap };
    return { x: left - pitch * 2.2, y: y + rowGap };
  };
  return {
    width, height, players, hole,
    holes: () => {
      const out: { x: number; y: number; player: number; position: number }[] = [];
      for (let p = 0; p < players; p++) {
        for (let position = -1; position <= PEG_GAME; position++) out.push({ ...hole(p, position), player: p, position });
      }
      return out;
    },
  };
}
