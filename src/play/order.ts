import { Hand, Stack, handPositions, stackDepths } from '../core/index.js';
import { TweenHost, shortestTurn } from './flight.js';

// Which card of a pile is drawn in front, and a hand re-fanned.
//
// `orderStack` is all phaser-card-engine's was minus the half that existed
// to work round Phaser: there, a Container ignored depth and had to be sorted
// by hand, and forgetting to once turned every first-on-top pile into a
// last-on-top one. A board here sorts by depth itself, so this only has to
// set the numbers.

/** Anything with a depth. */
export interface Ordered { depth: number }

/**
 * Puts one stack's sprites in the order its `order` asks for.
 *
 * `base` separates one pile from another: give each stack a band of its own
 * (its index times a hundred, say) and piles keep their relative order
 * instead of interleaving wherever two of them overlap. A card in hand wants
 * a base above all of them.
 */
export function orderStack(sprites: readonly Ordered[], stack: Stack, base = 0): void {
  const depths = stackDepths(stack, sprites.length);
  sprites.forEach((sprite, i) => { sprite.depth = base + depths[i]; });
}

export interface LayHandOptions {
  /** Depth band for this hand, keeping it clear of other piles. */
  base?: number;
  /** How long the re-fan takes. Zero puts the cards there at once. */
  duration?: number;
  ease?: string;
  /**
   * Cards something else is already moving - a card in flight on its way
   * into this hand. Counted in the fan, so the rest make room, and given
   * their depth, but not tweened: the throw and the re-fan would fight.
   */
  except?: readonly object[];
}

interface Fanned extends Ordered { x: number; y: number; angle: number }

/**
 * Re-fans a hand: every card to its place, turned the short way, in order.
 *
 * A hand opens around its middle, so a card arriving moves every card already
 * in it. Each turns the short way - see `shortestTurn` - because a hand
 * across the table holds cards at 189 degrees and a card reporting -171 would
 * otherwise spin all the way round to get five degrees.
 */
export function layHand(
  host: TweenHost, sprites: readonly Fanned[], hand: Hand, options: LayHandOptions = {},
): void {
  const places = handPositions(hand, sprites.length);
  const depths = stackDepths(hand, sprites.length);
  const duration = options.duration ?? 160;
  sprites.forEach((sprite, i) => {
    const place = places[i];
    sprite.depth = (options.base ?? 0) + depths[i];
    if (options.except?.includes(sprite)) return;
    if (duration <= 0) {
      sprite.x = place.x;
      sprite.y = place.y;
      sprite.angle = place.angle;
      return;
    }
    host.tweens.add({
      targets: sprite,
      x: place.x,
      y: place.y,
      angle: shortestTurn(sprite.angle, place.angle),
      duration,
      ease: options.ease ?? 'Cubic.easeOut',
    });
  });
}
