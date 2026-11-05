import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACK_COLORS,
  DECK_STOCK,
  DECK_THEMES,
  DECK_THEME_LABELS,
  DEFAULT_BACK_COLOR,
  DEFAULT_DECK_THEME,
  SEAT_COLORS,
  asBackColor,
  asDeckTheme,
  backColorCss,
  backColorHex,
  deckThemePath,
  seatColor,
} from './deck-theme.js';

describe('deck themes', () => {
  it('has a label for every theme and no more', () => {
    expect(Object.keys(DECK_THEME_LABELS).sort()).toEqual([...DECK_THEMES].sort());
  });

  it('falls back rather than letting an unknown name through', () => {
    expect(asDeckTheme('press')).toBe('press');
    expect(asDeckTheme('nonsense')).toBe(DEFAULT_DECK_THEME);
    expect(asDeckTheme(undefined)).toBe(DEFAULT_DECK_THEME);
    expect(asDeckTheme(7)).toBe(DEFAULT_DECK_THEME);
  });

  // The names of three decks that used to exist. A theme name is a storage
  // format - it sits in a player's localStorage and in a lobby's wire
  // traffic - so retiring one is not just deleting a line: somebody out
  // there is still holding it, and what they must get is the default rather
  // than a 404 on a texture and a card with no art at all.
  it('retires a deck without stranding whoever was holding it', () => {
    for (const gone of ['felt', 'royal', 'steel']) {
      expect(asDeckTheme(gone)).toBe(DEFAULT_DECK_THEME);
    }
  });

  it('points at the art where a consumer is asked to serve it', () => {
    expect(deckThemePath('antique', 'back.webp')).toBe('/cards/art/antique/back.webp');
  });

  // The back is the one picture of a card this package still ships, and a
  // theme listed without one is a face-down card with nothing on it. Cheap
  // to check and the only thing standing between a new deck and that.
  it('ships a back for every theme, and no backs for decks that are gone', () => {
    const art = join(import.meta.dirname, '..', '..', 'assets', 'cards', 'art');
    for (const theme of DECK_THEMES) {
      expect(existsSync(join(art, theme, 'back.webp'))).toBe(true);
    }
    for (const gone of ['felt', 'royal', 'steel']) {
      expect(existsSync(join(art, gone))).toBe(false);
    }
  });
});

describe('the stock a deck is printed on', () => {
  it('names one for every theme and no more', () => {
    expect(Object.keys(DECK_STOCK).sort()).toEqual([...DECK_THEMES].sort());
  });

  // Solitaire is alternating colours from end to end. A deck whose two inks
  // are hard to sort is a deck that cannot be played, and the decks most at
  // risk are the ones that abandoned red and black altogether.
  it('suggests a back color that is one of the deck colors', () => {
    for (const theme of DECK_THEMES) {
      expect((BACK_COLORS as readonly number[])).toContain(DECK_STOCK[theme].back);
    }
  });

  it('keeps the two inks apart on every deck', () => {
    const luma = (c: number) =>
      0.299 * ((c >> 16) & 0xff) + 0.587 * ((c >> 8) & 0xff) + 0.114 * (c & 0xff);
    for (const theme of DECK_THEMES) {
      const { paper, red, black } = DECK_STOCK[theme];
      // The two suits, from each other.
      const apart = Math.abs(((red >> 16) & 0xff) - ((black >> 16) & 0xff))
        + Math.abs(((red >> 8) & 0xff) - ((black >> 8) & 0xff))
        + Math.abs((red & 0xff) - (black & 0xff));
      expect(apart).toBeGreaterThan(90);
      // And both of them from the stock they are printed on.
      expect(Math.abs(luma(red) - luma(paper))).toBeGreaterThan(60);
      expect(Math.abs(luma(black) - luma(paper))).toBeGreaterThan(60);
    }
  });
});

describe('back colors', () => {
  it('gives the four seats four different colors', () => {
    expect(SEAT_COLORS).toHaveLength(4);
    expect(new Set(SEAT_COLORS).size).toBe(4);
    expect(SEAT_COLORS.every((c) => (BACK_COLORS as readonly number[]).includes(c))).toBe(true);
  });

  it('answers for a seat that does not exist rather than returning nothing', () => {
    expect(seatColor(0)).toBe(BACK_COLORS[0]);
    expect(seatColor(99)).toBe(SEAT_COLORS[SEAT_COLORS.length - 1]);
  });

  // The round trip that matters: a color goes to storage as hex and has to
  // come back as the same number.
  it('round-trips through hex and back', () => {
    for (const color of BACK_COLORS) {
      expect(backColorHex(color)).toHaveLength(6);
      expect(asBackColor(backColorHex(color))).toBe(color);
      expect(asBackColor(backColorCss(color).slice(1))).toBe(color);
    }
  });

  it('refuses a color that is not one of the deck colors', () => {
    expect(asBackColor('ff00ff')).toBe(DEFAULT_BACK_COLOR);
    expect(asBackColor(undefined)).toBe(DEFAULT_BACK_COLOR);
  });

  const luma = (c: number) =>
    0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);

  it('adds the six palette decks under stable ids', () => {
    for (const id of ['midnight', 'casino', 'arctic', 'delft', 'blush', 'newsprint']) {
      expect(DECK_THEMES).toContain(id);
      expect(asDeckTheme(id)).toBe(id);
    }
    expect(DECK_THEME_LABELS.casino).toBe('Casino Night');
  });

  // The engine's rule for every deck: the two inks are separable by
  // lightness as well as hue, on the deck's own stock.
  it('keeps the two suit inks apart by lightness, and both readable on the stock', () => {
    for (const theme of DECK_THEMES) {
      const { paper, red, black } = DECK_STOCK[theme];
      if (theme === 'matrix') continue; // two phosphors; sorted by hue by design
      expect(Math.abs(luma(red) - luma(black)), `${theme} red vs black`).toBeGreaterThan(40);
      expect(Math.abs(luma(red) - luma(paper)), `${theme} red vs paper`).toBeGreaterThan(50);
      expect(Math.abs(luma(black) - luma(paper)), `${theme} black vs paper`).toBeGreaterThan(50);
    }
  });
});
