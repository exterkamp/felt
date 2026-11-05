import type { TweenHost } from './flight.js';

// Turning a card over, in three dimensions.
//
// phaser-card-engine could only fake this - squash the card to nothing along
// x, swap the picture, stretch it back - because a Container is flat. A card
// here has two sides, so a flip is what it is on a table: the card lifts,
// rolls half a turn about its long axis, and comes down the other side up.
// The GPU decides which side is showing at every frame, so there is no
// half-way moment to time a swap to.
//
// At the end the card's own `faceUp` is turned and its roll put back to
// zero, which is the same picture - the side that was facing away, mirrored
// back the right way round, is now the side facing the camera.

export interface Flippable {
  turn: number;
  z: number;
  tilt: number;
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
  const target = options.faceUp ?? !sprite.card.faceUp;
  if (target === sprite.card.faceUp) return Promise.resolve();
  const lift = options.lift ?? 18;
  const tilt = options.tilt ?? 0;
  const direction = options.direction ?? 1;
  const ground = sprite.z;
  const startTilt = sprite.tilt;
  const startTurn = sprite.turn;
  const state = { t: 0 };
  return host.tweens.add({
    targets: state,
    t: 1,
    duration: options.duration ?? 320,
    delay: options.delay ?? 0,
    ease: options.ease ?? 'Sine.easeInOut',
    onUpdate: () => {
      const t = state.t;
      sprite.turn = startTurn + direction * Math.PI * t;
      sprite.z = ground + lift * Math.sin(Math.PI * t);
      sprite.tilt = startTilt + tilt * Math.sin(Math.PI * t);
    },
    onComplete: () => {
      sprite.setFaceUp(target);
      sprite.turn = startTurn;
      sprite.z = ground;
      sprite.tilt = startTilt;
    },
  }).promise;
}
