import { CardSize, DEFAULT_CARD_SIZE, Rect, StackOrder, cardRect, stackOffsets } from './stack.js';

// A hand of cards, held rather than stacked.
//
// A stack is cards on a table: every card parallel, each offset from the last
// along a line. A hand is cards in a fist, and it is not the same shape at
// all - they pivot around the point where they are gripped, so each one is
// turned a little further than the one before it and the fan bulges upward in
// the middle. Riffling a hand open is a rotation, not a slide.
//
// Everything here is the same arithmetic as a stack with one axis swapped for
// an angle, which is why `step` and `maxSpread` mean what they already mean:
// degrees between one card and the next, and the most the whole fan may open
// to before it starts closing up again. A hand of thirteen holds the same
// width as a hand of five and simply packs tighter, exactly as a squeezed
// tableau column does.

export interface Hand {
  readonly id: string;
  /** Where the middle card of the fan sits. */
  readonly x: number;
  readonly y: number;
  /** Degrees between one card and the next. */
  readonly step: number;
  /** The most the whole fan may open to, in degrees. Zero is unlimited. */
  readonly maxSpread: number;
  /**
   * How far below the cards the hand is gripped, measured to their centres.
   *
   * This is the *size* of the fan, not its curviness - a fact worth stating
   * because the opposite is the natural guess and this comment used to make
   * it. Every card sits at `radius * sin(angle)` across and
   * `radius * (1 - cos(angle))` down, so doubling the radius doubles how far
   * apart the cards are and doubles the sag with it. The arc keeps exactly
   * the same proportions; what decides how curved a hand *looks* is how wide
   * it is opened, which is `step` and `maxSpread`.
   *
   * So: a big radius with a narrow spread is a wide, shallow hand laid on the
   * table; a small radius with a wide spread is the tight fan of a hand held
   * up at the corner.
   */
  readonly radius: number;
  /** Degrees the whole hand is turned - 180 for a player across the table. */
  readonly facing: number;
  readonly order: StackOrder;
}

export function defineHand(
  spec: Pick<Hand, 'id' | 'x' | 'y'> & Partial<Hand>,
): Hand {
  return {
    step: 8,
    maxSpread: 70,
    radius: 260,
    facing: 0,
    order: 'last-on-top',
    ...spec,
  };
}

/** Where one card in a hand sits, and how far it is turned. */
export interface HandPlace {
  x: number;
  y: number;
  /** Degrees, including the hand's facing. */
  angle: number;
}

const RADIANS = Math.PI / 180;

/**
 * Where every card in the hand sits, in order from one end to the other.
 *
 * A single card sits exactly on the hand's own point, square: a fan of one is
 * not a fan. Two cards straddle it evenly, and so on - the fan is always
 * centred on the anchor rather than growing out of one end, because a hand
 * you add a card to opens around its middle rather than creeping sideways.
 */
export function handPositions(hand: Hand, count: number): HandPlace[] {
  if (count <= 0) return [];

  // The same squeeze a stack does, in degrees instead of units.
  const gaps = Array.from({ length: Math.max(0, count - 1) }, () => hand.step);
  const spread = stackOffsets({ ...asStack(hand) }, gaps);
  const total = spread[spread.length - 1];

  return spread.map((offset) => {
    const turn = offset - total / 2;
    // Around the grip: the pivot sits `radius` below the anchor, so the
    // middle card lands on the anchor and the outer ones swing down and out.
    const local = {
      x: hand.radius * Math.sin(turn * RADIANS),
      y: hand.radius * (1 - Math.cos(turn * RADIANS)),
    };
    const face = hand.facing * RADIANS;
    const cos = Math.cos(face);
    const sin = Math.sin(face);
    return {
      x: hand.x + local.x * cos - local.y * sin,
      y: hand.y + local.x * sin + local.y * cos,
      angle: turn + hand.facing,
    };
  });
}

/** The squeeze needs only these two fields, and they mean the same thing. */
function asStack(hand: Hand) {
  return {
    id: hand.id, x: 0, y: 0, fan: 'none' as const, step: hand.step,
    maxSpread: hand.maxSpread, messy: 0, order: hand.order,
  };
}

/**
 * Where the next card to arrive will sit.
 *
 * Which is not where the last one is now: a hand re-fans around its middle
 * every time a card joins it, so this is the place in the hand *as it will
 * be*, and every other card is about to move too.
 */
export function nextHandPlace(hand: Hand, count: number): HandPlace {
  const places = handPositions(hand, count + 1);
  return places[places.length - 1];
}

/**
 * The rectangle the whole hand covers.
 *
 * Generous on purpose: it is the bounding box of the cards' own boxes, which
 * for a turned card is bigger than the card. Good enough for asking whether a
 * pointer is over the hand, which is all anything here uses it for.
 */
export function handBounds(
  hand: Hand, count: number, size: CardSize = DEFAULT_CARD_SIZE,
): Rect {
  const places = handPositions(hand, Math.max(1, count));
  // A card turned by t degrees needs this much room on each axis.
  const corners = places.flatMap((place) => {
    const t = Math.abs(place.angle * RADIANS);
    const width = size.width * Math.abs(Math.cos(t)) + size.height * Math.abs(Math.sin(t));
    const height = size.width * Math.abs(Math.sin(t)) + size.height * Math.abs(Math.cos(t));
    const box = cardRect(place, { width, height });
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ];
  });
  const left = Math.min(...corners.map((c) => c.x));
  const top = Math.min(...corners.map((c) => c.y));
  const right = Math.max(...corners.map((c) => c.x));
  const bottom = Math.max(...corners.map((c) => c.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
