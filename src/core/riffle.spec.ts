import { describe, expect, it } from 'vitest';
import { riffleSplit } from './riffle.js';
import { seeded, shuffle } from './shuffle.js';
import { buildDeck, shuffledDeck } from './cards.js';

describe('a shuffled deck', () => {
  it('is fifty-two cards, all of them', () => {
    const deck = shuffledDeck(seeded(1));
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.id)).size).toBe(52);
  });

  it('is the same deal twice from the same seed, and not from another', () => {
    const ids = (random: () => number) => shuffledDeck(random).map((card) => card.id).join();
    expect(ids(seeded(7))).toBe(ids(seeded(7)));
    expect(ids(seeded(7))).not.toBe(ids(seeded(8)));
  });

  it('is the long way written short', () => {
    expect(shuffledDeck(seeded(3)).map((c) => c.id))
      .toEqual(shuffle(buildDeck(), seeded(3)).map((c) => c.id));
  });

  it('comes face down, like a deck', () => {
    expect(shuffledDeck(seeded(1)).every((card) => !card.faceUp)).toBe(true);
  });
});

describe('the riffle a deck fell out of', () => {
  it('accounts for every card exactly once', () => {
    const split = riffleSplit(52, seeded(4));
    expect(split.from).toHaveLength(52);
    expect([...split.left, ...split.right].sort((a, b) => a - b))
      .toEqual([...Array(52).keys()]);
  });

  it('says which packet each position fell from, and agrees with itself', () => {
    const split = riffleSplit(52, seeded(5));
    for (const at of split.left) expect(split.from[at]).toBe('left');
    for (const at of split.right) expect(split.from[at]).toBe('right');
  });

  it('cuts near the middle', () => {
    for (let seed = 1; seed < 20; seed++) {
      const split = riffleSplit(52, seeded(seed));
      expect(Math.abs(split.left.length - 26), `seed ${seed}`).toBeLessThanOrEqual(8);
    }
  });

  // The runs are the point of using the real model rather than alternating:
  // one-and-one every time is a faro, which does not read as a shuffle.
  it('drops in runs rather than strictly alternating', () => {
    const split = riffleSplit(52, seeded(6));
    let runs = 0;
    for (let at = 1; at < split.from.length; at++) {
      if (split.from[at] === split.from[at - 1]) runs++;
    }
    expect(runs).toBeGreaterThan(5);
  });

  it('keeps each packet in its own order', () => {
    const split = riffleSplit(52, seeded(9));
    expect([...split.left].sort((a, b) => a - b)).toEqual(split.left);
    expect([...split.right].sort((a, b) => a - b)).toEqual(split.right);
  });

  it('has nothing to say about an empty deck, and does not crash on one', () => {
    expect(riffleSplit(0)).toEqual({ left: [], right: [], from: [] });
    expect(riffleSplit(1).from).toHaveLength(1);
  });
});
