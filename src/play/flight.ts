import {
  Hand, Stack, handPositions, nextHandPlace, nextPosition, stackPositions,
} from '../core/index.js';
import type { Tweens } from '../scene/tweens.js';

/** Anything with tweens - a board, or a bare `{ tweens }` in a test. */
export interface TweenHost { readonly tweens: Tweens }

/** What a throw moves. A CardSprite is one; so is a plain object in a test. */
export interface Movable {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  z?: number;
}

// Throwing a card.
//
// A card pitched across a table spins - one turn, near enough, in whichever
// direction the wrist happened to give it - and arrives flat. That is the
// whole of what this does, and the two details that make it look right are
// both about how it *ends*.
//
// It lands on an exact angle rather than wherever the spin happens to stop.
// A card thrown at a pile is usually replaced the instant it arrives by the
// pile's own redraw, and if the throw finished at 7 degrees while the pile
// draws at 0, the card visibly snaps as one sprite takes over from the other.
// So the spin is computed backwards from the angle it has to rest at.
//
// And the turn is a whole one, with jitter. Landing on a multiple of 360 is
// what leaves the card upright; the jitter is what stops ten consecutive
// throws looking like one animation played ten times.

/** Where a card can be thrown: a point, a stack, a hand, or a place in one. */
export type ThrowTarget =
  | { x: number; y: number; angle?: number }
  | Stack
  | Hand
  | { stack: Stack; count: number; gapBefore?: (index: number) => number }
  | { hand: Hand; count: number };

function isStack(target: ThrowTarget): target is Stack {
  return (target as Stack).fan !== undefined && (target as Stack).id !== undefined;
}

function isHand(target: ThrowTarget): target is Hand {
  return (target as Hand).radius !== undefined && (target as Hand).facing !== undefined;
}

/**
 * Where a throw at this target lands, and at what angle.
 *
 * A bare point lands on itself, square unless it says otherwise. A stack lands
 * where its *next* card goes - throwing at a pile of six puts the card on top
 * of the six rather than underneath them, which is what anybody means by
 * throwing a card at a pile. A hand lands in the fan, at the angle that card
 * is held at, which is the part that matters: a card thrown into a hand and
 * settled square would jump the moment the hand redrew it.
 */
export function throwLanding(
  target: ThrowTarget,
): { x: number; y: number; angle?: number } {
  if (isStack(target)) return nextPosition(target, 0);
  if (isHand(target)) return nextHandPlace(target, 0);
  if ('stack' in target) return nextPosition(target.stack, target.count, target.gapBefore);
  if ('hand' in target) return nextHandPlace(target.hand, target.count);
  return target;
}

export interface ThrowOptions {
  /** Milliseconds. Left out, it is worked out from how far the card goes. */
  duration?: number;
  /** Whole turns before it settles. Default one; zero throws it flat. */
  spins?: number;
  /** The angle it comes to rest at, in degrees. Default upright. */
  settleAngle?: number;
  /** The scale it comes to rest at. Left out, the card's scale is untouched. */
  settleScale?: number;
  ease?: string;
  delay?: number;
  /**
   * A small bounce as it arrives - the card overshoots its size by a few per
   * cent and comes back. Reads as weight rather than as a card being placed.
   */
  pop?: boolean;
  /**
   * How high it rises off the table on the way, in board units. A card
   * pitched across a table is in the air, and with a lens that is a card that
   * grows a little and throws its shadow further at the top of the arc.
   * Default 0, which is the flat throw phaser-card-engine had.
   */
  arc?: number;
  onLand?: () => void;
}

// Nothing in here touches a canvas - a tween is added through the host it is
// handed - which means the whole file is tested in node against a stepped
// clock, and the two bugs that got past phaser-card-engine both lived in code
// that could not be.
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const MIN_MS = 220;
const MAX_MS = 700;
const MS_PER_UNIT = 0.9;
const POP_SCALE = 1.06;
const POP_MS = 110;

/**
 * How long a throw of this length should take.
 *
 * Distance rather than a constant, because a card flicked to the next column
 * and a card thrown the length of the board are not the same gesture, and
 * giving them the same duration makes the short one look slow and the long
 * one look teleported.
 */
export function flightDuration(distance: number): number {
  return clamp(MIN_MS + distance * MS_PER_UNIT, MIN_MS, MAX_MS);
}

/**
 * The angle to tween to: `spins` whole turns away, ending exactly on
 * `settle`.
 *
 * Exactly, and this is the one number in the file that must not be fuzzed. A
 * first draft added a few degrees of jitter to the turn so that consecutive
 * throws would differ, which landed every card a few degrees off its resting
 * angle - and the tween's own onComplete then snapped it straight, which is
 * precisely the artefact the exact landing exists to prevent. A test of the
 * arithmetic caught it; watching it would not have, at seven degrees.
 *
 * The variety comes from the direction instead, which is free. A game that
 * wants a pile to look thrown rather than stacked varies `settleAngle` per
 * card - that is a decision about how a pile looks, and it belongs to the
 * game rather than to the throw.
 */
export function spinTarget(from: number, settle: number, spins: number): number {
  const direction = Math.random() < 0.5 ? -1 : 1;
  let delta = (settle - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return from + direction * 360 * spins + delta;
}

/**
 * Throws one card, and resolves when it lands.
 *
 * The card is not added to anything and nothing about a game's state changes:
 * this moves a sprite and tells you when it got there. What happens on
 * arrival - joining a pile, being redrawn by it, being refused - is the
 * game's business, which is why `onLand` and the promise both exist.
 */
export function throwCard(
  host: TweenHost,
  sprite: Movable,
  target: ThrowTarget,
  options: ThrowOptions = {},
): Promise<void> {
  const landing = throwLanding(target);
  const distance = Math.hypot(landing.x - sprite.x, landing.y - sprite.y);
  const duration = options.duration ?? flightDuration(distance);
  // The target's own angle, when it has one: a card joining a hand has to
  // arrive at the angle that hand holds it at.
  const settleAngle = options.settleAngle ?? landing.angle ?? 0;
  const spins = options.spins ?? 1;

  const arc = options.arc ?? 0;
  const ground = sprite.z ?? 0;

  return new Promise((resolve) => {
    const flight: Record<string, unknown> = {
      targets: sprite,
      x: landing.x,
      y: landing.y,
      angle: spinTarget(sprite.angle, settleAngle, spins),
      duration,
      delay: options.delay ?? 0,
      // Out of the hand fast and slowing into the table, which is how a
      // thrown thing behaves and what makes the landing read as an arrival
      // rather than as the end of a slide.
      ease: options.ease ?? 'Cubic.easeOut',
      // The arc rides on the flight's own progress rather than a tween of
      // its own, so it peaks exactly half way along however the flight eases.
      onUpdate: arc ? (_tween: unknown, _target: unknown, progress: number) => {
        sprite.z = ground + arc * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
      } : undefined,
      onComplete: () => {
        sprite.angle = settleAngle;
        if (arc) sprite.z = ground;
        if (options.pop !== false) pop(host, sprite, options.settleScale ?? sprite.scaleX);
        options.onLand?.();
        resolve();
      },
    };
    if (options.settleScale !== undefined) {
      flight['scaleX'] = options.settleScale;
      flight['scaleY'] = options.settleScale;
    }
    host.tweens.add(flight as Parameters<Tweens['add']>[0]);
  });
}

/**
 * A card that arrived under its own steam rather than being set down.
 *
 * Its own tween rather than part of the flight, because a card can be flipped
 * or redrawn the moment it lands and the two would fight over scaleX. This
 * only has to leave the card the size it found it.
 */
function pop(host: TweenHost, sprite: Movable, base: number): void {
  host.tweens.add({
    targets: sprite,
    scaleX: base * POP_SCALE,
    scaleY: base * POP_SCALE,
    duration: POP_MS / 2,
    yoyo: true,
    ease: 'Quad.easeOut',
    onComplete: () => { sprite.scaleX = base; sprite.scaleY = base; },
  });
}

/**
 * The angle to tween to so a card takes the short way round.
 *
 * Angles are not wrapped here, but they used to be - Phaser kept `angle` to
 * ±180 - and they still drift: a card that has been thrown has a few whole
 * turns in its angle. A hand turned to face across the table holds cards at
 * 189 degrees, and tweening a card at -171 to 189 is a tween through 360
 * degrees: the card does a full spin on its way to a position five degrees
 * from where it started.
 *
 * That is not a hypothetical. It shipped, and what it looked like was two
 * cards in an untouched hand spinning whenever a third was dealt to it -
 * which is a strange enough thing to see that it took measuring to believe.
 */
export function shortestTurn(from: number, to: number): number {
  return spinTarget(from, to, 0);
}

export interface DealOptions extends ThrowOptions {
  /** Milliseconds between one card leaving and the next. Default 90. */
  stagger?: number;
}

/**
 * Throws a handful of cards, one after another, and resolves when the last
 * one lands.
 *
 * Every card gets its own landing place: throwing five at a stack deals them
 * onto it in order, each one going where it will actually sit rather than all
 * five landing on the same spot and sorting themselves out afterwards.
 */
export function dealCards(
  host: TweenHost,
  sprites: readonly Movable[],
  target: ThrowTarget,
  options: DealOptions = {},
): Promise<void> {
  const stagger = options.stagger ?? 90;
  const places = landingsFor(target, sprites.length);
  return Promise.all(
    sprites.map((sprite, i) =>
      throwCard(host, sprite, places[i], { ...options, delay: (options.delay ?? 0) + i * stagger }),
    ),
  ).then(() => undefined);
}

/** Where each of `count` cards thrown at this target should land. */
export function landingsFor(
  target: ThrowTarget, count: number,
): { x: number; y: number; angle?: number }[] {
  if (isStack(target)) return stackPositions(target, count);
  if (isHand(target)) return handPositions(target, count);
  if ('stack' in target) {
    // Onto the end of what is already there.
    const all = stackPositions(target.stack, target.count + count, target.gapBefore);
    return all.slice(target.count);
  }
  if ('hand' in target) {
    // Into the hand as it will be once they have all arrived - a hand re-fans
    // around its middle every time, so dealing five means every card lands
    // where it sits in the hand of five and not where it would sit in the
    // hand of one.
    return handPositions(target.hand, target.count + count).slice(target.count);
  }
  return Array.from({ length: count }, () => target);
}
