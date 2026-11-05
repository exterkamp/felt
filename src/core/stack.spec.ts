import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARD_SIZE,
  cardRect,
  defineStack,
  nextPosition,
  overlap,
  readableOrder,
  stackBounds,
  MESSY_TURN,
  stackAngle,
  stackDepths,
  stackOffsets,
  stackPositions,
  stackUnder,
  topCardIndex,
} from './stack.js';

const squared = defineStack({ id: 'stock', x: 100, y: 100 });
const column = defineStack({ id: 'tableau-0', x: 100, y: 100, fan: 'down', step: 30 });

describe('a squared stack', () => {
  it('puts every card in the same place', () => {
    const at = stackPositions(squared, 4);
    expect(at).toHaveLength(4);
    expect(at.every((p) => p.x === 100 && p.y === 100)).toBe(true);
  });

  it('has no cards to place when it is empty', () => {
    expect(stackPositions(squared, 0)).toEqual([]);
  });

  it('still covers a card-s worth of table when empty, because it is a place', () => {
    expect(stackBounds(squared, 0)).toEqual(cardRect({ x: 100, y: 100 }));
  });
});

describe('a fanned stack', () => {
  it('steps each card down from the one before', () => {
    expect(stackPositions(column, 3)).toEqual([
      { x: 100, y: 100, angle: 0 },
      { x: 100, y: 130, angle: 0 },
      { x: 100, y: 160, angle: 0 },
    ]);
  });

  it('goes the other way when it fans up', () => {
    const up = defineStack({ id: 'up', x: 0, y: 0, fan: 'up', step: 10 });
    expect(stackPositions(up, 3).map((p) => p.y)).toEqual([0, -10, -20]);
  });

  it('runs along x when it fans sideways', () => {
    const right = defineStack({ id: 'r', x: 0, y: 5, fan: 'right', step: 12 });
    expect(stackPositions(right, 3)).toEqual([
      { x: 0, y: 5, angle: 0 }, { x: 12, y: 5, angle: 0 }, { x: 24, y: 5, angle: 0 },
    ]);
    const left = defineStack({ id: 'l', x: 0, y: 5, fan: 'left', step: 12 });
    expect(stackPositions(left, 2).map((p) => p.x)).toEqual([0, -12]);
  });

  // The gap a card needs depends on what is under it: clearing a face-down
  // card's edge is cheaper than clearing a face-up card's index. This is the
  // pile Klondike deals on its seventh column.
  it('takes a different gap before each card when asked', () => {
    const gaps = [11, 11, 30, 30];
    const at = stackPositions(column, 5, (index) => gaps[index - 1]);
    expect(at.map((p) => p.y)).toEqual([100, 111, 122, 152, 182]);
  });
});

describe('squeezing', () => {
  const capped = defineStack({ id: 'c', x: 0, y: 0, fan: 'down', step: 30, maxSpread: 60 });

  it('leaves a stack that fits alone', () => {
    expect(stackPositions(capped, 3).map((p) => p.y)).toEqual([0, 30, 60]);
  });

  it('shrinks every gap by the same factor rather than cramming the end', () => {
    // Four cards want 90 units and may have 60, so every gap becomes 20.
    expect(stackPositions(capped, 4).map((p) => p.y)).toEqual([0, 20, 40, 60]);
  });

  it('keeps the whole pile inside its room however long it gets', () => {
    for (const count of [5, 10, 20, 52]) {
      const at = stackPositions(capped, count);
      expect(at[at.length - 1].y).toBeCloseTo(60);
    }
  });

  it('squeezes uneven gaps in proportion too', () => {
    // Ninety units of gap into sixty is two thirds of each.
    const at = stackOffsets(capped, [10, 50, 30]);
    [0, 20 / 3, 40, 60].forEach((want, i) => expect(at[i]).toBeCloseTo(want));
  });

  it('does not squeeze when there is no cap', () => {
    const at = stackPositions(column, 20);
    expect(at[19].y).toBe(100 + 19 * 30);
  });
});

describe('a messy pile', () => {
  const neat = defineStack({ id: 'foundation-0', x: 100, y: 100 });
  const thrown = defineStack({ id: 'foundation-0', x: 100, y: 100, messy: 0.5 });

  // What every pile did before this existed, and what a pile dealt by hand
  // still looks like.
  it('is square by default', () => {
    expect(neat.messy).toBe(0);
    expect(stackPositions(neat, 5).every((place) => place.angle === 0)).toBe(true);
  });

  it('turns each card, and never past the dial', () => {
    const places = stackPositions(thrown, 52);
    expect(places.every((place) => Math.abs(place.angle) <= MESSY_TURN / 2)).toBe(true);
    expect(places.some((place) => place.angle !== 0)).toBe(true);
  });

  // The dial is linear, so the numbers a game picks mean something next to
  // each other: half as messy is half the angle, not some curve of it.
  it('is linear in the dial', () => {
    const half = defineStack({ id: 'foundation-0', x: 0, y: 0, messy: 0.5 });
    const full = defineStack({ id: 'foundation-0', x: 0, y: 0, messy: 1 });
    for (let at = 0; at < 8; at++) {
      expect(stackAngle(half, at)).toBeCloseTo(stackAngle(full, at) / 2, 6);
    }
  });

  it('reaches MESSY_TURN at one, and no further', () => {
    const full = defineStack({ id: 'foundation-0', x: 0, y: 0, messy: 1 });
    const angles = stackPositions(full, 200).map((place) => Math.abs(place.angle));
    expect(Math.max(...angles)).toBeLessThanOrEqual(MESSY_TURN);
    expect(Math.max(...angles)).toBeGreaterThan(MESSY_TURN * 0.9);
  });

  // A dial is a dial: somebody will pass 2, or -1, and neither should make a
  // pile of cards spin.
  it('ignores a dial turned past its ends', () => {
    const over = defineStack({ id: 'foundation-0', x: 0, y: 0, messy: 4 });
    const full = defineStack({ id: 'foundation-0', x: 0, y: 0, messy: 1 });
    expect(stackAngle(over, 3)).toBe(stackAngle(full, 3));
    const under = defineStack({ id: 'foundation-0', x: 0, y: 0, messy: -1 });
    expect(stackAngle(under, 3)).toBe(0);
  });

  it('turns them both ways', () => {
    const angles = stackPositions(thrown, 40).map((place) => place.angle);
    expect(angles.some((angle) => angle > 0.5)).toBe(true);
    expect(angles.some((angle) => angle < -0.5)).toBe(true);
  });

  // The important one. A board redraws a pile on every move, and a pile that
  // rolled its angles fresh each time would shimmer.
  it('gives the same pile the same angles every time', () => {
    expect(stackPositions(thrown, 12).map((p) => p.angle))
      .toEqual(stackPositions(thrown, 12).map((p) => p.angle));
    expect(stackAngle(thrown, 7)).toBe(stackAngle(thrown, 7));
  });

  // Four foundations in a row, turned identically, would read as a pattern
  // rather than as four piles somebody threw at.
  it('does not turn two piles the same way', () => {
    const other = defineStack({ id: 'foundation-1', x: 100, y: 100, messy: 4 });
    expect(stackPositions(thrown, 10).map((p) => p.angle))
      .not.toEqual(stackPositions(other, 10).map((p) => p.angle));
  });



  it('leaves where the cards sit alone', () => {
    expect(stackPositions(thrown, 3).map((p) => [p.x, p.y]))
      .toEqual(stackPositions(neat, 3).map((p) => [p.x, p.y]));
  });
});

describe('where the next card lands', () => {
  it('is the anchor for an empty stack', () => {
    expect(nextPosition(column, 0)).toEqual({ x: 100, y: 100, angle: 0 });
  });

  it('is one step past the last card', () => {
    expect(nextPosition(column, 2)).toEqual({ x: 100, y: 160, angle: 0 });
  });

  // A squeezed stack moves every card when one more arrives, so "where the
  // next card lands" is only true of the board after it has landed.
  it('accounts for the squeeze the new card causes', () => {
    const capped = defineStack({ id: 'c', x: 0, y: 0, fan: 'down', step: 30, maxSpread: 60 });
    expect(nextPosition(capped, 3).y).toBeCloseTo(60);
  });
});

describe('identifying which stack a card is over', () => {
  const stacks = [
    { stack: defineStack({ id: 'left', x: 0, y: 0 }), count: 1 },
    { stack: defineStack({ id: 'right', x: 70, y: 0 }), count: 1 },
  ];

  it('picks the one the card is mostly over, not the first it touches', () => {
    // Centred at 45: overlapping both, but more of it is on the right.
    const card = cardRect({ x: 45, y: 0 });
    expect(stackUnder(card, stacks)?.id).toBe('right');
    expect(stackUnder(cardRect({ x: 25, y: 0 }), stacks)?.id).toBe('left');
  });

  it('answers with nothing when the card is over no stack at all', () => {
    expect(stackUnder(cardRect({ x: 400, y: 400 }), stacks)).toBeUndefined();
  });

  it('counts the whole of a fanned pile, not just its anchor', () => {
    const fanned = [{
      stack: defineStack({ id: 'column', x: 0, y: 0, fan: 'down', step: 30 }),
      count: 5,
    }];
    // Level with the fifth card, which is 120 units below the anchor.
    expect(stackUnder(cardRect({ x: 0, y: 120 }), fanned)?.id).toBe('column');
    expect(stackUnder(cardRect({ x: 0, y: 400 }), fanned)).toBeUndefined();
  });

  it('measures a fanned pile by the gaps it was actually drawn with', () => {
    const drawn = (gap: number) => [{
      stack: defineStack({ id: 'column', x: 0, y: 0, fan: 'down', step: 30 }),
      count: 3,
      gapBefore: () => gap,
    }];
    // A card 120 below the anchor is over the pile drawn at its full step -
    // the third card is at 60 and a card is 84 tall, so they still touch -
    // and over nothing at all when the same three cards were drawn tight.
    expect(stackUnder(cardRect({ x: 0, y: 120 }), drawn(30))?.id).toBe('column');
    expect(stackUnder(cardRect({ x: 0, y: 120 }), drawn(5))).toBeUndefined();
  });
});

describe('rectangles', () => {
  it('centres a card on its point', () => {
    expect(cardRect({ x: 0, y: 0 })).toEqual({
      x: -DEFAULT_CARD_SIZE.width / 2,
      y: -DEFAULT_CARD_SIZE.height / 2,
      ...DEFAULT_CARD_SIZE,
    });
  });

  it('measures how much two of them share', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(overlap(a, { x: 5, y: 0, width: 10, height: 10 })).toBe(50);
    expect(overlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(0);
    expect(overlap(a, a)).toBe(100);
  });
});

describe('which end of the stack is on top', () => {
  const cards = 4;

  it('draws the newest card in front by default', () => {
    const stack = defineStack({ id: 's', x: 0, y: 0, fan: 'down', step: 20 });
    expect(stack.order).toBe('last-on-top');
    expect(stackDepths(stack, cards)).toEqual([0, 1, 2, 3]);
    expect(topCardIndex(stack, cards)).toBe(cards - 1);
  });

  it('draws the oldest card in front when asked to', () => {
    const stack = defineStack({
      id: 's', x: 0, y: 0, fan: 'up', step: 20, order: 'first-on-top',
    });
    expect(stackDepths(stack, cards)).toEqual([3, 2, 1, 0]);
    expect(topCardIndex(stack, cards)).toBe(0);
  });

  // The whole point: it changes nothing about where the cards are.
  it('moves no card an inch either way', () => {
    const down = defineStack({ id: 'a', x: 10, y: 10, fan: 'down', step: 20 });
    const flipped = defineStack({
      id: 'b', x: 10, y: 10, fan: 'down', step: 20, order: 'first-on-top',
    });
    expect(stackPositions(flipped, 5)).toEqual(stackPositions(down, 5));
    expect(stackBounds(flipped, 5)).toEqual(stackBounds(down, 5));
  });

  it('has nothing on top of an empty stack', () => {
    expect(topCardIndex(defineStack({ id: 's', x: 0, y: 0 }), 0)).toBeUndefined();
    expect(stackDepths(defineStack({ id: 's', x: 0, y: 0 }), 0)).toEqual([]);
  });

  // Down and right cover the card before them; up and left cover the card
  // after. So which order leaves an index showing depends on the direction,
  // and getting it backwards is a column of blank slivers.
  it('knows which order leaves the indexes showing', () => {
    expect(readableOrder('down')).toBe('last-on-top');
    expect(readableOrder('right')).toBe('last-on-top');
    expect(readableOrder('up')).toBe('first-on-top');
    expect(readableOrder('left')).toBe('first-on-top');
    expect(readableOrder('none')).toBe('last-on-top');
  });

  it('puts the card in front at the end of the pile the fan grows from', () => {
    // A fan running up with its oldest card in front: that card is the one
    // lowest on screen, and it is the one a finger lands on.
    const stack = defineStack({
      id: 's', x: 0, y: 100, fan: 'up', step: 20, order: 'first-on-top',
    });
    const at = stackPositions(stack, 3);
    const front = topCardIndex(stack, 3)!;
    expect(at[front]).toEqual({ x: 0, y: 100, angle: 0 });
    expect(Math.max(...at.map((p) => p.y))).toBe(at[front].y);
  });
});
