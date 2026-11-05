import type { TweenHost } from './flight.js';
import { animatorOf } from '../scene/animator.js';

// Turning a card over, in three dimensions.
//
// phaser-card-engine could only fake this - squash the card to nothing along
// x, swap the picture, stretch it back - because a Container is flat. A card
// here has two sides, so a flip is what it is on a table: the card lifts,
// rolls half a turn about its long axis, and comes down the other side up.
// The GPU decides which side is showing at every frame, so there is no
// half-way moment to time a swap to.
//
// At the end the card's own `faceUp` is turned and the roll taken off, which
// is the same picture - the side that was facing away, mirrored
// back the right way round, is now the side facing the camera.

export interface Flippable {
  setFaceUp(faceUp: boolean): unknown;
  readonly card: { faceUp: boolean };
}

export interface FlipOptions {
  /** Milliseconds. Default 320. */
  duration?: number;
  /** How far it lifts off the table at the top of the roll. Default 18. */
  lift?: number;
  /** Which way it rolls: 1 rolls its right edge up, -1 its left. Default 1. */
  direction?: 1 | -1;
  /** Tipped towards the camera as it goes, for a little depth. Radians. Default 0. */
  tilt?: number;
  delay?: number;
  ease?: string;
  /** Whether it ends face up. Default: whichever side it was not. */
  faceUp?: boolean;
}

export function flipCard(host: TweenHost, sprite: Flippable, options: FlipOptions = {}): Promise<void> {
  const lift = options.lift ?? 18;
  const tilt = options.tilt ?? 0;
  const direction = options.direction ?? 1;
  let target = false;
  // Queued on the card's `flip` channel, and everything read when it
  // starts rather than when it was asked for: tapped five times, a card
  // flips five times, each from the side the last one left it on. The lift,
  // roll and tip are offsets on the card's resting pose, so no flip ever
  // starts from another's half-way height - which is how rapid taps used to
  // leave a card floating, and through the lens, larger.
  return animatorOf(host).play(sprite, {
    channel: 'flip',
    policy: 'queue',
    duration: options.duration ?? 320,
    delay: options.delay ?? 0,
    ease: options.ease ?? 'Sine.easeInOut',
    start: () => {
      target = options.faceUp ?? !sprite.card.faceUp;
      return target !== sprite.card.faceUp;
    },
    update: (t, offset) => {
      offset.turn = direction * Math.PI * t;
      offset.z = lift * Math.sin(Math.PI * t);
      offset.tilt = tilt * Math.sin(Math.PI * t);
    },
    // The offset is already off: half a turn less, and the other side up,
    // is the same picture.
    complete: () => { sprite.setFaceUp(target); },
  });
}
