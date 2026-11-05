import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  RANKS,
  STANDARD_SUITS,
  SUITS,
  cardName,
  colorOf,
  defineSuits,
  isBlack,
  isRed,
  isStandardSuit,
  rankValue,
  sameColor,
  sameFace,
  standardDeck,
} from './cards.js';

describe('the deck', () => {
  it('is fifty-two faces, one of each', () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}-${c.rank}`)).size).toBe(52);
  });

  it('comes out suit by suit, in the order foundations sit in', () => {
    const deck = standardDeck();
    expect(deck.slice(0, 13).every((c) => c.suit === 'spades')).toBe(true);
    expect(deck[0]).toEqual({ suit: 'spades', rank: 'A' });
    expect(deck[12]).toEqual({ suit: 'spades', rank: 'K' });
  });

  it('is built twice without either build touching the other', () => {
    const first = standardDeck();
    first[0].rank = 'K';
    expect(standardDeck()[0].rank).toBe('A');
  });
});

describe('suits and colors', () => {
  it('knows which suits are red', () => {
    expect(SUITS.filter(isRed)).toEqual(['hearts', 'diamonds']);
  });

  it('answers the question a tableau actually asks', () => {
    expect(sameColor('hearts', 'diamonds')).toBe(true);
    expect(sameColor('spades', 'clubs')).toBe(true);
    expect(sameColor('hearts', 'spades')).toBe(false);
  });

  it('knows which suits a deck is built from', () => {
    expect(SUITS.every(isStandardSuit)).toBe(true);
    expect(isStandardSuit('star')).toBe(false);
  });

  it('gives the four their colors', () => {
    expect(SUITS.map(colorOf)).toEqual(['black', 'red', 'red', 'black']);
    expect(SUITS.filter(isRed)).toEqual(['hearts', 'diamonds']);
    expect(SUITS.filter(isBlack)).toEqual(['spades', 'clubs']);
  });

  // The reason isBlack exists rather than !isRed: once a game can add suits,
  // "not red" stops meaning "black", and a gold star is neither.
  it('says nothing about the color of a suit it has never heard of', () => {
    expect(colorOf('star')).toBeUndefined();
    expect(isRed('star')).toBe(false);
    expect(isBlack('star')).toBe(false);
  });

  it('will not call an unknown suit the same color as anything', () => {
    expect(sameColor('star', 'spades')).toBe(false);
    expect(sameColor('star', 'hearts')).toBe(false);
    expect(sameColor('star', 'star')).toBe(false);
    expect(sameColor('spades', 'clubs')).toBe(true);
  });
});

describe('a game adding suits of its own', () => {
  it('gets them in the vocabulary without this package knowing them', () => {
    const vocab = defineSuits({ star: { color: 'gold' }, rose: { color: 'red' } });
    expect(vocab.all).toEqual([...SUITS, 'star', 'rose']);
    expect(vocab.isStandard('star')).toBe(false);
    expect(vocab.isStandard('hearts')).toBe(true);
  });

  it('decides for itself what color they are', () => {
    const vocab = defineSuits({ star: { color: 'gold' }, rose: { color: 'red' } });
    expect(vocab.colorOf('star')).toBe('gold');
    expect(vocab.isRed('rose')).toBe(true);
    expect(vocab.sameColor('rose', 'hearts')).toBe(true);
  });

  // A suit that is neither red nor black is both questions answered no, which
  // is what stops a rule about alternating colors quietly swallowing it.
  it('lets a suit be neither red nor black', () => {
    const vocab = defineSuits({ star: { color: 'gold' } });
    expect(vocab.isRed('star')).toBe(false);
    expect(vocab.isBlack('star')).toBe(false);
    expect(vocab.sameColor('star', 'spades')).toBe(false);
    expect(vocab.sameColor('star', 'hearts')).toBe(false);
    // Two golds are the same color as each other, though.
    expect(vocab.sameColor('star', 'star')).toBe(true);
  });

  // And a game whose rules want the new suit treated as one of the two says
  // so - which is nertz's case, where a star is gold on the card and black to
  // the tableau.
  it('lets a suit play as black while being printed in gold', () => {
    const vocab = defineSuits({ star: { color: 'black' } });
    expect(vocab.isBlack('star')).toBe(true);
    expect(vocab.sameColor('star', 'clubs')).toBe(true);
    expect(vocab.sameColor('star', 'hearts')).toBe(false);
  });

  it('leaves the four standard suits exactly as they were', () => {
    const vocab = defineSuits({ rose: { color: 'red' } });
    expect(SUITS.map((s) => vocab.colorOf(s))).toEqual(SUITS.map(colorOf));
    // And nothing global is mutated by anybody defining anything.
    expect(colorOf('rose')).toBeUndefined();
  });

  it('is the four and nothing else when a game adds none', () => {
    expect(STANDARD_SUITS.all).toEqual([...SUITS]);
    expect(defineSuits().all).toEqual([...SUITS]);
  });
});

describe('ranks', () => {
  it('counts the ace as one and the king as thirteen', () => {
    expect(rankValue('A')).toBe(1);
    expect(rankValue('K')).toBe(13);
    expect(RANKS.map(rankValue)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('names a card the way a person would say it', () => {
    expect(cardName({ suit: 'hearts', rank: 'Q' })).toBe('Q of hearts');
  });

  it('compares two faces by rank and suit', () => {
    expect(sameFace({ suit: 'hearts', rank: '9' }, { suit: 'hearts', rank: '9' })).toBe(true);
    expect(sameFace({ suit: 'hearts', rank: '9' }, { suit: 'spades', rank: '9' })).toBe(false);
  });
});

describe('the shape of a card', () => {
  it('keeps poker proportions', () => {
    expect(CARD_ASPECT).toBeCloseTo(5 / 7);
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(CARD_ASPECT);
  });
});
