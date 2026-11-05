import { describe, expect, it } from 'vitest';
import { defineHand, handBounds, handPositions, nextHandPlace } from './hand.js';

const hand = defineHand({ id: 'h', x: 100, y: 200, step: 10, maxSpread: 0, radius: 200 });

describe('a hand', () => {
  it('is not a fan when it holds one card', () => {
    expect(handPositions(hand, 1)).toEqual([{ x: 100, y: 200, angle: 0 }]);
  });

  it('holds nothing when it is empty', () => {
    expect(handPositions(hand, 0)).toEqual([]);
  });

  // A hand opens around its middle rather than creeping out of one end, which
  // is what stops the whole fan drifting sideways as cards arrive.
  it('stays centred on its own point as it grows', () => {
    for (const count of [2, 5, 8, 13]) {
      const places = handPositions(hand, count);
      const middle = (places[0].angle + places[places.length - 1].angle) / 2;
      expect(middle).toBeCloseTo(0);
      const centreX = (places[0].x + places[places.length - 1].x) / 2;
      expect(centreX).toBeCloseTo(100);
    }
  });

  it('turns each card a step further than the one before', () => {
    const places = handPositions(hand, 5);
    const turns = places.map((p) => p.angle);
    expect(turns).toEqual([-20, -10, 0, 10, 20]);
  });

  // The whole difference from a stack: the outer cards swing down and out
  // around a grip below the hand.
  it('curves, with the middle card highest', () => {
    const places = handPositions(hand, 5);
    expect(places[2].y).toBeLessThan(places[0].y);
    expect(places[0].y).toBeCloseTo(places[4].y);
    expect(places[0].x).toBeLessThan(places[2].x);
    expect(places[4].x).toBeGreaterThan(places[2].x);
  });

  // The radius is the size of the fan, not its curviness. Worth pinning,
  // because the natural guess is the opposite and the comment on the field
  // used to say the opposite.
  it('spreads the cards further for a bigger grip distance', () => {
    const small = handPositions(defineHand({ ...hand, radius: 120 }), 5);
    const large = handPositions(defineHand({ ...hand, radius: 480 }), 5);
    const width = (places: { x: number }[]) => places[4].x - places[0].x;
    const dip = (places: { y: number }[]) => places[0].y - places[2].y;
    expect(width(large)).toBeCloseTo(width(small) * 4);
    expect(dip(large)).toBeCloseTo(dip(small) * 4);
    // Turned the same amount either way: only the scale changes.
    expect(small.map((p) => p.angle)).toEqual(large.map((p) => p.angle));
  });

  it('keeps the same arc whatever the grip distance', () => {
    const shape = (radius: number) => {
      const places = handPositions(defineHand({ ...hand, radius }), 5);
      return (places[0].y - places[2].y) / (places[4].x - places[0].x);
    };
    expect(shape(120)).toBeCloseTo(shape(480));
    expect(shape(120)).toBeCloseTo(shape(2000));
  });

  // What actually changes how curved a hand looks is how far it is opened.
  it('curves harder the wider it is opened', () => {
    const shape = (step: number) => {
      const places = handPositions(defineHand({ ...hand, step }), 5);
      return (places[0].y - places[2].y) / (places[4].x - places[0].x);
    };
    expect(shape(20)).toBeGreaterThan(shape(6));
  });
});

describe('squeezing a hand', () => {
  const capped = defineHand({ id: 'h', x: 0, y: 0, step: 10, maxSpread: 40, radius: 200 });

  it('opens to its full step while it fits', () => {
    expect(handPositions(capped, 5).map((p) => p.angle)).toEqual([-20, -10, 0, 10, 20]);
  });

  it('packs tighter rather than opening past its spread', () => {
    const places = handPositions(capped, 9);
    expect(places[0].angle).toBeCloseTo(-20);
    expect(places[8].angle).toBeCloseTo(20);
    expect(places[1].angle - places[0].angle).toBeCloseTo(5);
  });

  it('holds the same width at any size', () => {
    for (const count of [5, 9, 13, 26]) {
      const places = handPositions(capped, count);
      expect(places[places.length - 1].angle - places[0].angle).toBeCloseTo(40);
    }
  });
});

describe('facing', () => {
  it('turns the whole hand, cards and curve together', () => {
    const across = defineHand({ ...hand, facing: 180 });
    const mine = handPositions(hand, 3);
    const theirs = handPositions(across, 3);
    // Same point, opposite way up, and the fan dips the other way.
    expect(theirs[1].x).toBeCloseTo(mine[1].x);
    expect(theirs[1].angle).toBeCloseTo(180);
    expect(theirs[0].y).toBeLessThan(theirs[1].y);
    expect(mine[0].y).toBeGreaterThan(mine[1].y);
  });
});

describe('the next card', () => {
  it('goes at the end of the hand the new card makes', () => {
    const next = nextHandPlace(hand, 4);
    expect(next).toEqual(handPositions(hand, 5)[4]);
  });

  // Every other card moves when one arrives, which a stack only does when
  // squeezed and a hand does always.
  it('is not simply one step past the card that is there now', () => {
    const before = handPositions(hand, 4);
    const after = handPositions(hand, 5);
    expect(after[3].angle).not.toBeCloseTo(before[3].angle);
  });
});

describe('the room a hand takes', () => {
  it('covers a card when it holds one', () => {
    const bounds = handBounds(hand, 1);
    expect(bounds.width).toBeCloseTo(60);
    expect(bounds.height).toBeCloseTo(84);
  });

  it('grows as the fan opens, and allows for the turn', () => {
    const one = handBounds(hand, 1);
    const many = handBounds(hand, 9);
    expect(many.width).toBeGreaterThan(one.width);
    expect(many.height).toBeGreaterThan(one.height);
  });
});
