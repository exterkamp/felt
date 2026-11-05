import { describe, expect, it } from 'vitest';
import { colorCss, cssColor, defaultInk, inkOf, themeInk } from './ink.js';
import { DECK_STOCK, DECK_THEMES } from './deck-theme.js';

// These were in card-sprite.ts, where a node test could not reach them: that
// file imports Phaser, and importing Phaser outside a browser throws on
// `window`. Arithmetic that needs a browser to be tested is arithmetic that
// does not get tested, so the arithmetic moved.

describe('the ink a suit is printed in', () => {
  it('defaults to red, black, and gold for a suit nobody declared', () => {
    expect(defaultInk('hearts')).toBe(0xcf2436);
    expect(defaultInk('spades')).toBe(0x1a1a1a);
    expect(defaultInk('star')).toBe(0xd8a838);
  });

  it('takes a map', () => {
    const ink = { hearts: 0x2e8b57 };
    expect(inkOf(ink, 'hearts')).toBe(0x2e8b57);
  });

  it('falls back per suit, so a map may name only what it changes', () => {
    expect(inkOf({ hearts: 0x2e8b57 }, 'spades')).toBe(defaultInk('spades'));
  });

  it('takes a function', () => {
    expect(inkOf(() => 0x123456, 'clubs')).toBe(0x123456);
  });

  it('is the default when nothing is given', () => {
    expect(inkOf(undefined, 'diamonds')).toBe(defaultInk('diamonds'));
  });

  // The point of the whole arrangement: what a suit is printed in and what it
  // counts as are different questions, and a deck is allowed to answer them
  // differently. Green hearts are still red to every rule that asks.
  it('does not have to agree with what the suit counts as', () => {
    const green = { hearts: 0x2e8b57, diamonds: 0x2e8b57 };
    expect(inkOf(green, 'hearts')).toBe(0x2e8b57);
    expect(inkOf(green, 'hearts')).not.toBe(defaultInk('hearts'));
  });
});

describe('the two color spellings', () => {
  it('round-trips', () => {
    expect(colorCss(0xfdfdfd)).toBe('#fdfdfd');
    expect(cssColor('#fdfdfd')).toBe(0xfdfdfd);
    expect(cssColor(colorCss(0x2a5866))).toBe(0x2a5866);
  });

  // Six digits always: a stock whose top byte is small would otherwise be
  // written short and come back as a different color entirely.
  it('pads a color whose red channel is small', () => {
    expect(colorCss(0x0a1b2c)).toBe('#0a1b2c');
    expect(cssColor('#0a1b2c')).toBe(0x0a1b2c);
  });
});

describe('the ink a deck prints in', () => {
  it('gives both suits of a color the deck\'s own ink', () => {
    for (const theme of DECK_THEMES) {
      const ink = themeInk(theme);
      const { red, black } = DECK_STOCK[theme];
      expect(inkOf(ink, 'hearts')).toBe(red);
      expect(inkOf(ink, 'diamonds')).toBe(red);
      expect(inkOf(ink, 'spades')).toBe(black);
      expect(inkOf(ink, 'clubs')).toBe(black);
    }
  });

  // The distinction the whole of ink.ts exists for: matrix prints its hearts
  // in amber, and a heart is still red to every rule that asks.
  it('changes what a suit looks like and not what it counts as', () => {
    expect(inkOf(themeInk('matrix'), 'hearts')).toBe(DECK_STOCK.matrix.red);
    expect(inkOf(themeInk('matrix'), 'hearts')).not.toBe(defaultInk('hearts'));
  });

  // A suit no deck has heard of. `colorOf` says it is neither, so the deck
  // has nothing to say about it and the package's own color stands.
  it('leaves a suit that counts as neither alone', () => {
    expect(inkOf(themeInk('neon'), 'moons')).toBe(defaultInk('moons'));
  });
});
