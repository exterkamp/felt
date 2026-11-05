import { afterEach, describe, expect, it } from 'vitest';
import { cardAssetBase, setCardAssetBase } from './assets.js';
import { courtSourcePath } from './court.js';
import { deckThemePath } from './deck-theme.js';

afterEach(() => setCardAssetBase('/cards'));

describe('where the art is served from', () => {
  it('is /cards until somebody says otherwise', () => {
    expect(cardAssetBase()).toBe('/cards');
    expect(deckThemePath('press', 'back.webp')).toBe('/cards/art/press/back.webp');
    expect(courtSourcePath('K', 'spades')).toBe('/cards/court/king-spades.svg');
  });

  // The case this exists for: a demo published under a project path, where an
  // absolute /cards/... is a 404 at somebody else's site.
  it('moves every path together', () => {
    setCardAssetBase('/phaser-card-engine/cards');
    expect(deckThemePath('antique', 'back.webp'))
      .toBe('/phaser-card-engine/cards/art/antique/back.webp');
    expect(courtSourcePath('Q', 'hearts'))
      .toBe('/phaser-card-engine/cards/court/queen-hearts.svg');
  });

  // import.meta.env.BASE_URL ends in a slash, and every caller would
  // otherwise have to remember to take it off.
  it('takes a trailing slash off rather than doubling it', () => {
    setCardAssetBase('/somewhere/cards/');
    expect(cardAssetBase()).toBe('/somewhere/cards');
    expect(deckThemePath('press', 'back.webp')).toBe('/somewhere/cards/art/press/back.webp');
  });

  it('takes an absolute URL, for art on another host', () => {
    setCardAssetBase('https://cdn.example.com/cards');
    expect(courtSourcePath('J', 'clubs'))
      .toBe('https://cdn.example.com/cards/court/jack-clubs.svg');
  });
});
