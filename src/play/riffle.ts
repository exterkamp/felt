import { Stack, riffleSplit, stackPositions } from '../core/index.js';
import type { TweenHost } from './flight.js';
import { orderStack } from './order.js';
import { animatorOf } from '../scene/animator.js';

/** Cards being riffled, and the riffle they are in. */
const riffling = new WeakMap<object, Promise<void>>();

// Shuffling, as a thing you can watch.
//
// The deck is already shuffled before any of this runs - `shuffle` did it,
// against whatever random the game handed it, and that is the only thing that
// decides what order the cards are in. This animates a riffle that *arrives*
// at that order: `riffleSplit` works backwards from the finished deck to a
// pair of packets and a drop order that would produce it, and the cards go
// where that says. An animation that invented its own interleaving would
// land the deck somewhere other than where the game put it, and the lie
// shows: the card on top would not be the card dealt first.
//
// In phaser-card-engine every card had to stop being a sprite for the length
// of the shuffle - snapshotted into a texture and swapped for a Mesh, because
// a Container cannot bend - and swapped back at the end. Here a card bends:
// `bow`, `tilt` and `turn` are properties of every card and the shader does
// the rest, so the riffle is nothing but tweens on the cards themselves.

export interface RiffleOptions {
  /** How many times. Default one. */
  rounds?: number;
  /** How far the two packets part, either side of the stack. Default 54. */
  spread?: number;
  /** Milliseconds for the cut, and for the bow. Default 170. */
  duration?: number;
  /** Milliseconds between one card springing free and the next. Default 9. */
  stagger?: number;
  /** How far a card lifts on its way over. Default 14. */
  lift?: number;
  /** How deep the top of each packet bows. Default 0.3. */
  bow?: number;
  /**
   * How far the cards are tipped, top edge towards the camera, so the curve
   * reads from overhead. Default 0.62 rad.
   */
  tilt?: number;
  /** How far each packet leans. Default 0.34 rad. */
  turn?: number;
  /** How high the packets are held off the table. Default 10. */
  hold?: number;
  /** Where the randomness comes from. Default Math.random. */
  random?: () => number;
}

/** What a riffle moves: a card that can be placed, ordered and bent. */
export interface Riffled {
  x: number;
  y: number;
  z: number;
  angle: number;
  depth: number;
  bow: number;
  tilt: number;
  turn: number;
  /** A card's shadow strength, if it has one - softened while it is held. */
  shadowStrength?: number;
}

/** Where a riffle draws: above the felt and the cards, while it lasts. */
export const RIFFLE_DEPTH = 10_000;
/**
 * And above that again for a card still in a hand. A card that has landed
 * takes its place in the pile by depth, and the pile grows past fifty - so
 * without a band of its own a packet of twenty-six would end up underneath
 * the pile it is dropping onto, about half way through.
 */
export const RIFFLE_HAND_DEPTH = RIFFLE_DEPTH + 1_000;

/**
 * Riffles a pile, and resolves when it is squared up again.
 *
 * Cosmetic from end to end: the cards are in the order the game put them in,
 * and in that same order when this resolves.
 */
export async function riffleShuffle(
  host: TweenHost, sprites: readonly Riffled[], stack: Stack, options: RiffleOptions = {},
): Promise<void> {
  if (sprites.length < 2) return;
  // Asked again while it is running - a shuffle button tapped twice - the
  // deck is already being shuffled: hand back that shuffle rather than start
  // a second one fighting it for every card.
  const already = sprites.map((sprite) => riffling.get(sprite)).find(Boolean);
  if (already) return already;
  const run = riffle(host, sprites, stack, options);
  for (const sprite of sprites) riffling.set(sprite, run);
  try {
    await run;
  } finally {
    for (const sprite of sprites) if (riffling.get(sprite) === run) riffling.delete(sprite);
  }
}

async function riffle(
  host: TweenHost, sprites: readonly Riffled[], stack: Stack, options: RiffleOptions,
): Promise<void> {
  // Whatever else the cards were doing ends first, at its end: a flip in
  // the middle of a riffle is a card the riffle cannot square.
  const animator = animatorOf(host);
  for (const sprite of sprites) animator.finish(sprite);
  const rounds = options.rounds ?? 1;
  const spread = options.spread ?? 54;
  const duration = options.duration ?? 170;
  const stagger = options.stagger ?? 9;
  const lift = options.lift ?? 14;
  const bow = options.bow ?? 0.3;
  // Towards the camera: the ends of a bowed packet curl up at the thumbs,
  // and tipped this way that is the end you see. Negative in the engine's
  // terms, where a positive tilt sends the top edge away.
  const tilt = -(options.tilt ?? 0.62);
  const turn = options.turn ?? 0.34;
  const hold = options.hold ?? 10;
  const random = options.random ?? Math.random;

  const home = stackPositions(stack, sprites.length);
  const reach = new Array<number>(sprites.length).fill(1);
  // Twenty-six cards held half a unit apart each throw a shadow, and the
  // halos stack into a black slab under the packet. Held, a card's shadow is
  // faint; it gets its own back when it lands.
  const shadows = sprites.map((sprite) => sprite.shadowStrength);
  sprites.forEach((sprite, i) => {
    sprite.depth = RIFFLE_DEPTH + i;
    if (sprite.shadowStrength !== undefined) sprite.shadowStrength = 0.25;
  });
  try {
    for (let round = 0; round < rounds; round++) {
      const split = riffleSplit(sprites.length, random);
      // The cut: two packets, parted and leaning away from each other, held
      // off the table, the card on top of each drawn in front.
      const moves: Promise<void>[] = [];
      const packet = (indices: number[], side: number) => {
        indices.forEach((at, depth) => {
          const card = sprites[at];
          reach[at] = indices.length > 1 ? depth / (indices.length - 1) : 1;
          card.depth = RIFFLE_HAND_DEPTH + depth;
          moves.push(host.tweens.to(card, {
            x: stack.x + side * spread,
            // A shallow lean down the packet, so it reads as a stack of cards
            // in a hand rather than as one card sliding sideways.
            y: stack.y + depth * 0.5,
            z: hold + depth * 0.25,
            angle: 0,
            tilt,
            turn: side * turn,
            bow: 0,
            duration,
            ease: 'Cubic.easeOut',
          }));
        });
      };
      packet(split.left, -1);
      packet(split.right, 1);
      await Promise.all(moves);

      // The bow: both halves flexed under the thumbs. Least at the bottom of
      // the packet and most at the top, which is the one card whose whole
      // length can be seen.
      await Promise.all(sprites.map((card, at) => host.tweens.to(card, {
        tilt: tilt * 1.15,
        bow: bow * (0.55 + 0.45 * reach[at]),
        duration: duration * 0.8,
        ease: 'Quad.easeOut',
      })));

      // The release: cards spring flat as they fall, in the order they fell,
      // and each leaves the in-hand band the moment it lands.
      await Promise.all(sprites.map((card, at) => host.tweens.to(card, {
        x: home[at].x,
        y: home[at].y - lift,
        z: 0,
        angle: home[at].angle,
        bow: 0,
        turn: 0,
        tilt: 0,
        delay: at * stagger,
        duration,
        ease: 'Quad.easeIn',
        // The lift is taken back on arrival rather than tweened out, so the
        // card drops the last few units instead of easing into the pile.
        onComplete: () => {
          card.y = home[at].y;
          card.depth = RIFFLE_DEPTH + at;
          if (shadows[at] !== undefined) card.shadowStrength = shadows[at];
        },
      })));
    }
  } finally {
    sprites.forEach((card, at) => {
      if (shadows[at] !== undefined) card.shadowStrength = shadows[at];
    });
    for (const card of sprites) {
      card.bow = 0;
      card.tilt = 0;
      card.turn = 0;
      card.z = 0;
    }
  }
  orderStack(sprites, stack);
}
