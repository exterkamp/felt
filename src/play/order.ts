import { Hand, Stack, handPositions, stackDepths } from '../core/index.js';
import { TweenHost, shortestTurn } from './flight.js';
import { animatorOf } from '../scene/animator.js';

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
  layPlaces(host, sprites, handPositions(hand, sprites.length), stackDepths(hand, sprites.length), options);
}

/**
 * Lays any cards out at given places and depths: each tweened to its place on
 * its `move` channel, turned the short way, or put there at once with a
 * duration of zero. What `layHand` does for a hand; a `Table` uses it for
 * every pile.
 */
export function layPlaces(
  host: TweenHost, sprites: readonly Fanned[], places: readonly { x: number; y: number; angle: number }[],
  depths: readonly number[], options: LayHandOptions = {},
): void {
  const duration = options.duration ?? 160;
  const animator = animatorOf(host);
  sprites.forEach((sprite, i) => {
    const place = places[i];
    sprite.depth = (options.base ?? 0) + depths[i];
    if (options.except?.includes(sprite)) return;
    if (duration <= 0) {
      if (animator.busy(sprite, 'move')) {
        void animator.play(sprite, { channel: 'move', policy: 'interrupt', duration: 0,
          update: () => { sprite.x = place.x; sprite.y = place.y; sprite.angle = place.angle; } });
        return;
      }
      sprite.x = place.x;
      sprite.y = place.y;
      sprite.angle = place.angle;
      return;
    }
    // Already there: nothing to tween (and nothing to cut off).
    if (sprite.x === place.x && sprite.y === place.y && sprite.angle === place.angle
      && !animator.busy(sprite, 'move')) return;
    let from = { x: 0, y: 0, angle: 0, to: 0 };
    void animator.play(sprite, {
      channel: 'move',
      policy: 'interrupt',
      intent: `lay ${place.x} ${place.y} ${place.angle}`,
      duration,
      ease: options.ease ?? 'Cubic.easeOut',
      start: () => {
        from = { x: sprite.x, y: sprite.y, angle: sprite.angle, to: shortestTurn(sprite.angle, place.angle) };
      },
      update: (t) => {
        sprite.x = from.x + (place.x - from.x) * t;
        sprite.y = from.y + (place.y - from.y) * t;
        sprite.angle = from.angle + (from.to - from.angle) * t;
      },
    });
  });
}
