// How a riffle falls.
//
// The shuffling itself is `shuffle` - a Fisher-Yates against a supplied
// random, which is the only thing that should ever decide what order a deck
// is in. This is the other half: given a deck already in its final order,
// which of those cards were in the left hand and which in the right, and in
// what order they dropped.
//
// Backwards, in other words. A riffle animation that made up its own
// interleaving would land the deck somewhere other than the order the game
// had already decided on, so this takes the order as given and works out a
// riffle that produces it.
//
// Nothing here draws anything - see phaser/shuffle.ts, which does.

export interface RiffleSplit {
  /** Target positions that were in the left packet, bottom of it first. */
  left: number[];
  right: number[];
  /** Which packet the card at each target position fell from. */
  from: ('left' | 'right')[];
}

/**
 * Deal `count` positions out into two packets, by the Gilbert-Shannon-Reeds
 * model: with L cards left in one hand and R in the other, the next to drop
 * comes from the left with probability L/(L+R).
 *
 * Which is what a real riffle does, and why it is worth the six lines over
 * strict alternation. Two even piles dropped one-and-one is a perfect
 * faro - a real shuffle drops in runs of one to three, and the runs are what
 * the eye reads as shuffling rather than as zipping.
 */
export function riffleSplit(count: number, random: () => number = Math.random): RiffleSplit {
  const split: RiffleSplit = { left: [], right: [], from: [] };
  if (count <= 0) return split;

  // Cut near the middle, but not exactly: a deck cut dead centre every time
  // looks mechanical, and a real cut is off by a few cards.
  const drift = Math.round((random() - 0.5) * count * 0.12);
  let inLeft = Math.max(1, Math.min(count - 1, Math.round(count / 2) + drift));
  let inRight = count - inLeft;

  for (let at = 0; at < count; at++) {
    const fromLeft = inLeft > 0 && (inRight === 0 || random() < inLeft / (inLeft + inRight));
    if (fromLeft) {
      split.from.push('left');
      split.left.push(at);
      inLeft--;
    } else {
      split.from.push('right');
      split.right.push(at);
      inRight--;
    }
  }
  return split;
}
