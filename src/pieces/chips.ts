import { seeded } from '../core/shuffle.js';

// Chips, as numbers.
//
// A chip is its denomination and nothing else: two red fives are the same
// chip, so a stack is a list of values from the bottom up and its worth is
// their sum. Everything a dealer does with them - pay a bet out of a stack,
// break a hundred into twenties' worth of smaller ones, colour up a pile of
// whites - is arithmetic on those lists, and lives here, where it runs in
// node and is tested without a canvas. The board's chips (chip-stack.ts) only
// show what these functions decide.

/** How one denomination is painted. */
export interface Denomination {
  value: number;
  /** The body of the chip. Any CSS colour. */
  color: string;
  /** The edge spots and the ring round the inlay. */
  spot: string;
  /** The value printed on the inlay. Default the body colour. */
  ink?: string;
  /** What is printed, if not the value (`1K` for 1000 and so on). */
  label?: string;
}

/**
 * The usual casino colours: white 1, red 5, green 25, black 100, purple 500,
 * yellow 1000, brown 5000. Any set will do - pass your own to a `ChipSet`.
 */
export const CASINO_CHIPS: readonly Denomination[] = [
  { value: 1, color: '#efebe0', spot: '#2a63b8', ink: '#2a63b8' },
  { value: 5, color: '#c6232b', spot: '#f4efe2' },
  { value: 25, color: '#1d8048', spot: '#f4efe2' },
  { value: 100, color: '#1c1c1f', spot: '#f4efe2', ink: '#1c1c1f' },
  { value: 500, color: '#6a2fa0', spot: '#f2c230' },
  { value: 1000, color: '#efb21f', spot: '#1c1c1f', ink: '#7a4b00' },
  { value: 5000, color: '#8a5a2b', spot: '#f4efe2' },
];

/** What a chip of this value says on its face: 5, 25, 1K, 2.5K, 1M. */
export function chipLabel(value: number): string {
  const short = (n: number, unit: string) => `${Number.isInteger(n) ? n : Number(n.toFixed(1))}${unit}`;
  if (value >= 1e6 && value % 1e5 === 0) return short(value / 1e6, 'M');
  if (value >= 1000 && value % 100 === 0) return short(value / 1000, 'K');
  return String(value);
}

/** The sum of a stack. */
export function stackValue(chips: readonly number[]): number {
  let sum = 0;
  for (const chip of chips) sum += chip;
  return sum;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/**
 * The fewest chips that make `amount`, from an unlimited supply of each
 * value - what the bank hands over. Highest first. Throws if it cannot be
 * made (7 out of fives).
 *
 * Not greedy: greedy is right for the casino set but wrong for some (6 out
 * of 1, 3 and 4 is 3+3, not 4+1+1), and a set is the game's to choose.
 */
export function makeChange(amount: number, values: readonly number[]): number[] {
  if (amount === 0) return [];
  if (!(amount > 0) || !Number.isInteger(amount)) throw new Error(`felt chips: cannot make ${amount}`);
  const coins = [...new Set(values)].filter((v) => v > 0 && v <= amount).sort((a, b) => b - a);
  const g = coins.reduce((acc, v) => gcd(acc, v), 0);
  if (!g || amount % g !== 0) throw new Error(`felt chips: ${amount} cannot be made from ${values.join(', ')}`);
  // Greedy first: for a canonical set (every casino set) it is the answer,
  // and it is the common case by far; checked against the table only when
  // the set might not be.
  const greedy = greedyChange(amount, coins);
  if (greedy && canonical(coins)) return greedy;
  const n = amount / g;
  const best = new Int32Array(n + 1).fill(-1);
  const pick = new Int32Array(n + 1);
  best[0] = 0;
  for (let a = 1; a <= n; a++) {
    for (const coin of coins) {
      const c = coin / g;
      if (c > a || best[a - c] < 0) continue;
      if (best[a] < 0 || best[a - c] + 1 < best[a]) { best[a] = best[a - c] + 1; pick[a] = coin; }
    }
  }
  if (best[n] < 0) throw new Error(`felt chips: ${amount} cannot be made from ${values.join(', ')}`);
  const out: number[] = [];
  for (let a = n; a > 0; a -= pick[a] / g) out.push(pick[a]);
  return out.sort((a, b) => b - a);
}

function greedyChange(amount: number, coins: readonly number[]): number[] | undefined {
  const out: number[] = [];
  let left = amount;
  for (const coin of coins) while (left >= coin) { out.push(coin); left -= coin; }
  return left === 0 ? out : undefined;
}

/** Whether every value is a whole multiple of the next smaller one - then greedy is optimal. */
function canonical(coins: readonly number[]): boolean {
  for (let i = 0; i + 1 < coins.length; i++) if (coins[i] % coins[i + 1] !== 0) return false;
  return true;
}

/**
 * Which chips of a stack add up to exactly `amount`, fewest first - as
 * indices into the stack, nearest the top first - or undefined if none do.
 */
export function exactChips(chips: readonly number[], amount: number): number[] | undefined {
  if (amount === 0) return [];
  if (amount < 0) return undefined;
  const counts = new Map<number, number>();
  for (const chip of chips) counts.set(chip, (counts.get(chip) ?? 0) + 1);
  const values = [...counts.keys()].sort((a, b) => b - a);
  const g = values.reduce((acc, v) => gcd(acc, v), amount);
  const n = amount / g;
  if (n > 2_000_000) return undefined;
  // Bounded change-making: best[a] the fewest chips to make a, over the
  // values so far, and how many of each value it took.
  const INF = 1 << 30;
  let best = new Int32Array(n + 1).fill(INF);
  best[0] = 0;
  const took: Int32Array[] = [];
  for (const value of values) {
    const c = value / g;
    const most = counts.get(value)!;
    const next = new Int32Array(n + 1).fill(INF);
    const k = new Int32Array(n + 1);
    for (let a = 0; a <= n; a++) {
      for (let m = 0; m <= most && m * c <= a; m++) {
        const prev = best[a - m * c];
        if (prev === INF) continue;
        if (prev + m < next[a]) { next[a] = prev + m; k[a] = m; }
      }
    }
    took.push(k);
    best = next;
  }
  if (best[n] === INF) return undefined;
  const want = new Map<number, number>();
  let a = n;
  for (let i = values.length - 1; i >= 0; i--) {
    const m = took[i][a];
    if (m) want.set(values[i], m);
    a -= m * (values[i] / g);
  }
  const out: number[] = [];
  for (let i = chips.length - 1; i >= 0; i--) {
    const left = want.get(chips[i]) ?? 0;
    if (left > 0) { out.push(i); want.set(chips[i], left - 1); }
  }
  return out;
}

/** One chip broken into smaller ones. */
export interface BrokenChip {
  /** Its value. */
  value: number;
  /** What it was broken into, highest first. */
  into: number[];
}

/** What paying an amount out of a stack does to it. */
export interface Payment {
  /** The chips paid, in the order they leave (top of the stack first). */
  pay: number[];
  /** The stack left behind, bottom first. */
  keep: number[];
  /** Chips that had to be broken to make the amount, in the order they were. */
  broken: BrokenChip[];
}

/**
 * Pays `amount` out of a stack, the way a dealer would: with chips already
 * in it if some of them add up, the fewest that do; otherwise by breaking
 * the smallest chip that lets it be paid, and then paying.
 *
 * Throws if the stack is short, or the amount cannot be made from the set
 * at all.
 */
export function payFrom(chips: readonly number[], amount: number, values: readonly number[]): Payment {
  const total = stackValue(chips);
  if (amount > total) throw new Error(`felt chips: ${amount} is more than the stack's ${total}`);
  let stack = [...chips];
  const broken: BrokenChip[] = [];
  for (let round = 0; round < 64; round++) {
    const exact = exactChips(stack, amount);
    if (exact) {
      const taken = new Set(exact);
      return {
        pay: exact.map((i) => stack[i]),
        keep: stack.filter((_, i) => !taken.has(i)),
        broken,
      };
    }
    // Break one chip: the smallest whose change lets the amount be paid,
    // else the largest one, and look again.
    const distinct = [...new Set(stack)].sort((a, b) => a - b);
    let done = false;
    for (const value of distinct) {
      const smaller = values.filter((v) => v < value);
      let into: number[];
      try { into = makeChange(value, smaller); } catch { continue; }
      const at = stack.lastIndexOf(value);
      const trial = [...stack.slice(0, at), ...stack.slice(at + 1), ...into];
      if (exactChips(trial, amount)) {
        stack = trial;
        broken.push({ value, into });
        done = true;
        break;
      }
    }
    if (done) continue;
    const largest = distinct.reverse().find((value) => {
      try { makeChange(value, values.filter((v) => v < value)); return true; } catch { return false; }
    });
    if (largest === undefined) break;
    const into = makeChange(largest, values.filter((v) => v < largest));
    const at = stack.lastIndexOf(largest);
    stack = [...stack.slice(0, at), ...stack.slice(at + 1), ...into];
    broken.push({ value: largest, into });
  }
  throw new Error(`felt chips: ${amount} cannot be paid out of ${chips.join(', ')}`);
}

/**
 * The stack made up again in the fewest chips - colouring up: twenty-five
 * whites become one green. Highest at the bottom.
 */
export function colorUp(chips: readonly number[], values: readonly number[]): number[] {
  return makeChange(stackValue(chips), values);
}

/** Where one chip of a stack is drawn, from the stack's base. */
export interface ChipPlace {
  x: number;
  y: number;
  /** Degrees: chips in a real stack do not line their spots up. */
  angle: number;
  /** Which column of a stack taller than `perColumn`, and how high in it. */
  column: number;
  row: number;
}

export interface ChipLayout {
  /** Of a chip, in board units. Default 40. */
  diameter?: number;
  /**
   * How far up the board each chip sits from the one under it: the chip's
   * thickness, seen from a little in front. Default 0.075 of the diameter.
   */
  step?: number;
  /** Chips to a column before the next one starts beside it. Default 20. */
  perColumn?: number;
  /** 0 squared up, 1 a stack pushed about on the felt. Default 0.6. */
  messy?: number;
  /** The same seed is the same mess, chip for chip. */
  seed?: number;
}

/**
 * Where every chip of a stack of `count` is drawn, from the bottom: each a
 * chip's thickness above the last, nudged a little off true and turned at
 * random (from the seed, so a stack looks the same every time it is drawn
 * and on every screen), and a new column beside it every `perColumn`.
 *
 * Chip `i`'s place depends only on `i` and the seed, never on the count, so
 * a chip added to a stack never moves the ones already in it.
 */
export function chipStackLayout(count: number, layout: ChipLayout = {}): ChipPlace[] {
  const d = layout.diameter ?? 40;
  const step = layout.step ?? d * 0.075;
  const per = Math.max(1, layout.perColumn ?? 20);
  const messy = layout.messy ?? 0.6;
  const seed = layout.seed ?? 0;
  const out: ChipPlace[] = [];
  for (let i = 0; i < count; i++) {
    const column = Math.floor(i / per);
    const row = i % per;
    const r = seeded(Math.imul(seed ^ 0x9e3779b9, 31) + i * 7919);
    // A wobble that grows a little up the column - a tall stack leans.
    const lean = 1 + row / per;
    // `+ 0`: a squared-up stack is at 0, not -0.
    out.push({
      x: column * d * 1.12 + (r() - 0.5) * d * 0.08 * messy * lean + 0,
      y: -row * step + (r() - 0.5) * d * 0.03 * messy + 0,
      angle: (r() - 0.5) * 70 * Math.max(messy, 0.15),
      column, row,
    });
  }
  return out;
}

/**
 * A set of denominations: their looks by value, and the arithmetic over
 * them. One per game; `CASINO_CHIPS` by default.
 */
export class ChipSet {
  readonly denominations: readonly Denomination[];
  /** Every value, highest first. */
  readonly values: readonly number[];

  constructor(denominations: readonly Denomination[] = CASINO_CHIPS) {
    this.denominations = [...denominations].sort((a, b) => b.value - a.value);
    this.values = this.denominations.map((d) => d.value);
  }

  /** The look of a value. Throws for a value the set does not have. */
  of(value: number): Denomination {
    const found = this.denominations.find((d) => d.value === value);
    if (!found) throw new Error(`felt chips: no ${value} chip in this set`);
    return found;
  }

  makeChange(amount: number): number[] { return makeChange(amount, this.values); }
  payFrom(chips: readonly number[], amount: number): Payment { return payFrom(chips, amount, this.values); }
  colorUp(chips: readonly number[]): number[] { return colorUp(chips, this.values); }
}
