// Where the card art is served from.
//
// The package asks one thing of a consumer: copy `assets/cards` somewhere and
// say where. The default is `/cards`, which is what both games use and what
// every path in here returns unless told otherwise.
//
// It is settable because "somewhere" is not always the root. A demo published
// to GitHub Pages lives under `/phaser-card-engine/`, and an absolute
// `/cards/court/king-spades.svg` on that host is a 404 at someone else's
// site - the one failure that cannot be caught by building, because the build
// is where the wrong path is produced.

let base = '/cards';

/** Where card art is being served from. No trailing slash. */
export function cardAssetBase(): string {
  return base;
}

/**
 * Point the package at a different directory.
 *
 * Call it once, before anything loads art - which in Phaser means before a
 * scene's `preload`, so in practice before the game is created.
 *
 * A trailing slash is taken off rather than rejected: `import.meta.env.BASE_URL`
 * ends in one, and every caller would otherwise have to remember to strip it.
 */
export function setCardAssetBase(next: string): void {
  base = next.replace(/\/+$/, '');
}
