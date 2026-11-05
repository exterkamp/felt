import { CARD_HEIGHT, CARD_WIDTH } from './cards.js';

// Where a stack of cards lives, and where each card in it sits.
//
// The primitive every card game on a table needs and none of them share: a
// named place with a position, which cards land on and build up from. A
// foundation is one. So is a stock, a waste, a free cell, a tableau column, a
// peak position, a reserve, and the hole in the middle of Black Hole. Between
// two games there are eleven kinds of pile and they are all this.
//
// It is geometry and nothing else - no Phaser, no sprites, no scene. That is
// deliberate rather than incidental: where the sixth card of a squeezed fan
// sits is arithmetic, and arithmetic that needs a browser to be tested is
// arithmetic that does not get tested. What a renderer adds is drawing the
// card at the point this hands it. See the demo.

export interface Point {
  x: number;
  y: number;
}

/** A place in a pile: where the card goes, and how far it is turned. */
export interface Place extends Point {
  /** Degrees. Zero unless the stack is messy. */
  angle: number;
}

/** A rectangle by its top-left corner, which is what overlap maths wants. */
export interface Rect extends Point {
  width: number;
  height: number;
}

/**
 * Which way a stack grows.
 *
 * `none` is a squared pile: every card on top of the last, which is what a
 * stock, a waste and a foundation all are. The rest fan, so that the cards
 * underneath still show something of themselves - an index, usually.
 */
export type FanDirection = 'none' | 'up' | 'down' | 'left' | 'right';

/**
 * Which end of a stack is drawn on top of the rest.
 *
 * Not geometry - every card sits in exactly the same place either way - but
 * the difference between a pile you can read and one you cannot, because it
 * decides *which edge of each card the one above it covers*.
 *
 * A card carries its index in its top-left corner, so the edge left showing
 * is the whole question:
 *
 * | fan | last-on-top shows | first-on-top shows |
 * | --- | --- | --- |
 * | down | each card's top edge - **the index** | each card's bottom edge |
 * | up | each card's bottom edge | each card's top edge - **the index** |
 * | right | each card's left edge - **the index** | each card's right edge |
 * | left | each card's right edge | each card's left edge - **the index** |
 * | none | the newest card | the oldest card |
 *
 * So a tableau fanning down wants last-on-top and the same tableau fanning up
 * wants first-on-top, and a pile that gets this backwards is a column of
 * blank slivers with one readable card at the end. `readableOrder` below
 * answers it for you.
 *
 * The other half is squared piles, where it is not about legibility at all: a
 * waste shows the card you just turned (last) and a face-down stock shows the
 * card you will turn next (first, near enough) - and a deck whose top card is
 * the bottom of the pile is a deck that deals from the wrong end.
 */
export type StackOrder = 'last-on-top' | 'first-on-top';

export interface Stack {
  /** What the game calls this place. Anything unique will do. */
  readonly id: string;
  /** Where the *first* card's centre goes. */
  readonly x: number;
  readonly y: number;
  readonly fan: FanDirection;
  /** Units between one card and the next. Ignored when the fan is none. */
  readonly step: number;
  /**
   * How much room the fan may take, beyond the first card.
   *
   * Zero means unlimited. Otherwise a stack that would outgrow it squeezes:
   * every gap shrinks by the same factor until the whole thing fits. A
   * tableau column that reaches the bottom of the screen has to do something,
   * and squeezing is the one thing that keeps every card's index visible
   * rather than hiding the last few off the edge.
   */
  readonly maxSpread: number;
  /** Which end of the pile is drawn over the rest. See StackOrder. */
  readonly order: StackOrder;
  /**
   * How roughly this pile was made, from 0 to 1.
   *
   * Zero is a squared pile - a pile dealt by hand, and what everything here
   * did before this existed. One is the most a card will be turned, which is
   * `MESSY_TURN` degrees either way. In between is linear, so 0.25 is a
   * quarter of that and reads as a pile somebody was a little careless with.
   *
   * A dial rather than an angle because that is how it gets used: a game
   * decides how rough its foundations look, not how many degrees a card may
   * be off by. `MESSY_TURN` is exported for anyone who wants the number.
   *
   * What it is for: nertz players do not place cards on the foundations in
   * the middle of the table, they pitch them, and a foundation at the end of
   * a hand is a fan of near-misses rather than a neat stack.
   *
   * The turn is worked out from the card's place in the pile rather than
   * rolled, so a pile looks the same every time it is drawn. A pile that
   * shuffled its own angles on every render would shimmer.
   */
  readonly messy: number;
}

export function defineStack(
  spec: Pick<Stack, 'id' | 'x' | 'y'> & Partial<Stack>,
): Stack {
  return { fan: 'none', step: 0, maxSpread: 0, messy: 0, order: 'last-on-top', ...spec };
}

/**
 * The order that leaves every card's index showing, for a given fan.
 *
 * Down and right cover the card before, so the newest card belongs on top;
 * up and left cover the card after, so the oldest does. A squared pile has no
 * index to worry about and gets last-on-top, which is what a waste wants.
 *
 * Offered rather than applied: a game may well want the other one - a stock
 * showing its next card, a hand fanned so the cards read from the far end -
 * and this is a default worth knowing rather than a rule.
 */
export function readableOrder(fan: FanDirection): StackOrder {
  return fan === 'up' || fan === 'left' ? 'first-on-top' : 'last-on-top';
}

/** Whether a fan runs along the y axis. */
function vertical(fan: FanDirection): boolean {
  return fan === 'up' || fan === 'down';
}

/** Which way along its axis a fan travels: down and right are positive. */
function sign(fan: FanDirection): number {
  return fan === 'up' || fan === 'left' ? -1 : 1;
}

/**
 * How far each card sits from the first, along the fan's axis.
 *
 * `gaps` is the distance *before* each card, so gaps[0] belongs to the second
 * card and the first is always at zero. Per-card rather than one step for the
 * pile, because the gap a card needs depends on what is underneath it: a card
 * lying on a face-down one only has to clear its edge, and a card lying on a
 * face-up one has to clear its index.
 *
 * That is the one piece of this that looks like overkill until you have a
 * pile of six face-down cards with a king-to-ace run on top of it, which
 * Klondike deals on its seventh column.
 */
export function stackOffsets(stack: Stack, gaps: readonly number[]): number[] {
  const offsets = [0];
  for (const gap of gaps) offsets.push(offsets[offsets.length - 1] + gap);

  const spread = offsets[offsets.length - 1];
  if (!stack.maxSpread || spread <= stack.maxSpread) return offsets;

  // Squeeze. Every gap by the same factor, so the fan stays even rather than
  // cramming the last few cards and leaving the first ones roomy.
  const squeeze = stack.maxSpread / spread;
  return offsets.map((offset) => offset * squeeze);
}

/**
 * Where every card in this stack sits, in order from the bottom.
 *
 * `gapBefore` is asked for the gap before the card at each index from 1 up;
 * without it the stack's own step is used for every card, which is what a
 * squared pile or an evenly fanned one wants.
 */
/**
 * The most a card is ever turned, in degrees, at `messy: 1`.
 *
 * Twelve, which is a pile four people have been throwing at all evening. Half
 * of it still reads as a pile rather than a spill, and a quarter is the sort
 * of untidiness nobody would remark on.
 */
export const MESSY_TURN = 12;

/**
 * How far the card at `index` is turned on this pile.
 *
 * Settled rather than rolled: the same pile and the same place always give
 * the same angle, so a board that redraws a pile - which this one does on
 * every move - does not reshuffle the way it looks. Mixing the stack's own id
 * in is what stops four foundations side by side being turned identically.
 */
export function stackAngle(stack: Pick<Stack, 'id' | 'messy'>, index: number): number {
  const messy = Math.max(0, Math.min(1, stack.messy));
  if (!messy) return 0;
  return (scatter(stack.id, index) * 2 - 1) * messy * MESSY_TURN;
}

/** A number in 0..1 from a name and a place, and the same one every time. */
function scatter(id: string, index: number): number {
  let hash = 2166136261 ^ index;
  for (let at = 0; at < id.length; at++) {
    hash = Math.imul(hash ^ id.charCodeAt(at), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

export function stackPositions(
  stack: Stack,
  count: number,
  gapBefore?: (index: number) => number,
): Place[] {
  if (count <= 0) return [];
  const step = stack.fan === 'none' ? 0 : stack.step;
  const gaps = Array.from({ length: Math.max(0, count - 1) }, (_, i) =>
    gapBefore ? gapBefore(i + 1) : step,
  );

  const along = sign(stack.fan);
  return stackOffsets(stack, gaps).map((offset, index) => ({
    ...(vertical(stack.fan)
      ? { x: stack.x, y: stack.y + offset * along }
      : { x: stack.x + offset * along, y: stack.y }),
    angle: stackAngle(stack, index),
  }));
}

/** Where the next card to land on this stack would sit. */
export function nextPosition(
  stack: Stack,
  count: number,
  gapBefore?: (index: number) => number,
): Place {
  const positions = stackPositions(stack, count + 1, gapBefore);
  return positions[positions.length - 1];
}

/**
 * How far above the felt each card in the stack is drawn, bottom of the pile
 * first - so `depths[i]` belongs to the same card as `positions[i]`.
 *
 * Zero for the card furthest back and `count - 1` for the one in front,
 * whichever end of the pile that is. Add your own base to keep a dragged card
 * above everything.
 */
export function stackDepths(stack: Pick<Stack, 'order'>, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    stack.order === 'last-on-top' ? i : count - 1 - i,
  );
}

/**
 * Which card is drawn over all the others, as an index into the pile.
 *
 * The card a finger actually lands on, which is not always the card the rules
 * call the top of the pile: a first-on-top stack draws its *oldest* card in
 * front. A game picking cards up by touch wants this one; a game asking what
 * may legally be played wants its own rules.
 */
export function topCardIndex(stack: Pick<Stack, 'order'>, count: number): number | undefined {
  if (count <= 0) return undefined;
  return stack.order === 'last-on-top' ? count - 1 : 0;
}

export interface CardSize {
  width: number;
  height: number;
}

export const DEFAULT_CARD_SIZE: CardSize = { width: CARD_WIDTH, height: CARD_HEIGHT };

/** The rectangle a card centred on a point covers. */
export function cardRect(at: Point, size: CardSize = DEFAULT_CARD_SIZE): Rect {
  return {
    x: at.x - size.width / 2,
    y: at.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

/**
 * The rectangle the whole stack covers, empty or not.
 *
 * An empty stack still has a place on the table - it is the outline printed
 * on the felt - so this answers for one card at the anchor when the count is
 * zero. That is what makes an empty foundation a thing you can drop onto.
 */
export function stackBounds(
  stack: Stack,
  count: number,
  size: CardSize = DEFAULT_CARD_SIZE,
  gapBefore?: (index: number) => number,
): Rect {
  const positions = stackPositions(stack, Math.max(1, count), gapBefore);
  const rects = positions.map((at) => cardRect(at, size));
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** How much area two rectangles share. Zero if they do not touch. */
export function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export interface StackContents {
  stack: Stack;
  /** How many cards are on it, which decides how much of the table it covers. */
  count: number;
  gapBefore?: (index: number) => number;
}

/**
 * Which stack a dropped card is being offered to.
 *
 * By overlap rather than by where the pointer is, and by the *most* overlapped
 * rather than the first that touches. A card held between two columns should
 * go to the one it is mostly over, which is what a hand on a real table does
 * and is not what "the pointer is inside this rectangle" gives you - with a
 * finger on a phone the pointer is under the card and often over the wrong
 * pile entirely.
 *
 * Returns nothing when the card is over no stack at all, which is a drop that
 * should snap back rather than one that should guess.
 */
export function stackUnder(
  card: Rect,
  stacks: readonly StackContents[],
  size: CardSize = DEFAULT_CARD_SIZE,
): Stack | undefined {
  let best: Stack | undefined;
  let bestArea = 0;
  for (const { stack, count, gapBefore } of stacks) {
    const area = overlap(card, stackBounds(stack, count, size, gapBefore));
    if (area > bestArea) {
      best = stack;
      bestArea = area;
    }
  }
  return best;
}
