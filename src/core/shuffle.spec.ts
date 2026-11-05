import { describe, expect, it } from 'vitest';
import { pickWeighted, seeded, shuffle } from './shuffle.js';
import { standardDeck } from './cards.js';

const ids = (faces: { suit: string; rank: string }[]) => faces.map((c) => `${c.suit}${c.rank}`).join();

describe('seeded', () => {
  it('gives the same numbers twice from the same seed', () => {
    const a = seeded(7);
    const b = seeded(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('gives different numbers from different seeds', () => {
    expect(seeded(7)()).not.toBe(seeded(8)());
  });

  it('stays inside zero and one', () => {
    const random = seeded(3);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('shuffle', () => {
  it('deals the same order twice from the same seed', () => {
    expect(ids(shuffle(standardDeck(), seeded(4)))).toBe(ids(shuffle(standardDeck(), seeded(4))));
    expect(ids(shuffle(standardDeck(), seeded(4)))).not.toBe(ids(shuffle(standardDeck(), seeded(5))));
  });

  it('keeps every card and loses none', () => {
    const deck = standardDeck();
    const shuffled = shuffle(deck, seeded(1));
    expect(shuffled).toHaveLength(52);
    expect([...shuffled].sort((a, b) => ids([a]).localeCompare(ids([b]))))
      .toEqual([...deck].sort((a, b) => ids([a]).localeCompare(ids([b]))));
  });

  it('leaves the array it was given alone', () => {
    const deck = standardDeck();
    const before = ids(deck);
    shuffle(deck, seeded(2));
    expect(ids(deck)).toBe(before);
  });

  // The items themselves are not copied: whether a card is cloned on a deal is
  // a decision about a card model, and one of these games makes it one way and
  // one the other.
  it('shuffles the same items rather than copies of them', () => {
    const deck = standardDeck();
    expect(shuffle(deck, seeded(2)).includes(deck[0])).toBe(true);
  });

  it('actually moves the cards about', () => {
    expect(ids(shuffle(standardDeck(), seeded(9)))).not.toBe(ids(standardDeck()));
  });
});

describe('pickWeighted', () => {
  it('picks in proportion, near enough, over many rolls', () => {
    const random = seeded(11);
    const counts: Record<string, number> = { common: 0, rare: 0 };
    for (let i = 0; i < 4000; i++) {
      counts[pickWeighted({ common: 3, rare: 1 }, random)!]++;
    }
    expect(counts['common'] / counts['rare']).toBeGreaterThan(2.5);
    expect(counts['common'] / counts['rare']).toBeLessThan(3.5);
  });

  it('never picks something weighing nothing', () => {
    const random = seeded(12);
    for (let i = 0; i < 200; i++) {
      expect(pickWeighted({ yes: 1, no: 0 }, random)).toBe('yes');
    }
  });

  it('has nothing to say when everything weighs nothing', () => {
    expect(pickWeighted({ no: 0 }, seeded(1))).toBeUndefined();
    expect(pickWeighted({}, seeded(1))).toBeUndefined();
  });
});
