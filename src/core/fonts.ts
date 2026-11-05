// The typefaces, named for the canvas.
//
// Phaser has no access to CSS custom properties, so an app's `--font-body`
// cannot be read from here - the families have to be named again. That is why
// this is in the package rather than in either game: the names were already
// repeated once per app, identically, and a third copy is how they drift.
//
// The four faces are in assets/fonts with their licences. An app still has to
// declare its own @font-face rules over them; these constants only say what
// to ask the canvas for once it has.
//
// Weight rides in `fontStyle` rather than a separate field because Phaser
// composes its canvas font as `${fontStyle} ${fontSize} ${fontFamily}`, and
// `700 15px Cinzel` is a valid CSS font shorthand while `bold` would give us
// whatever the browser's synthetic bold looks like on a variable face.
export const DISPLAY_FONT = '"Cinzel", Georgia, serif';
export const BODY_FONT = '"Jost", "Helvetica Neue", Arial, sans-serif';
export const DISPLAY_WEIGHT = '700';

// The rank in a card's corner, and nothing else - not part of the app's
// voice, which is the two faces above.
//
// A card index is its own typographic problem: eleven glyphs that have to be
// told apart instantly inside a box a few units tall, with no context to
// disambiguate them. Jost fails it on one glyph - its J is the only rank
// with a descender, hanging six units below every other and putting the hook
// that distinguishes it from a bar under the card below in a fanned pile.
// Archivo is a grotesque drawn for signage and small print, its J sits on
// the baseline like the rest, and this is the size everything about it was
// intended for.
export const CARD_INDEX_FONT = '"Archivo", Helvetica, Arial, sans-serif';

// Every family/weight pair worth having before anything draws.
//
// document.fonts.load only resolves for the exact combination asked for, so
// a weight missing from this list is a weight that can still be rasterized
// in the fallback face.
//
// Mostly these are the canvas's, for the reason in fontsReady below. The
// exception is Schoolbell, which is drawn in the DOM and never on the board:
// it is what the record book is written in, and a page nobody has opened yet
// is the one place a face could still be arriving when it is first wanted.
// Asking for it up here means it never is.
const PRELOAD_FACES = [
  `${DISPLAY_WEIGHT} 16px "Cinzel"`,
  `400 16px "Cinzel"`,
  `700 16px "Jost"`,
  `400 16px "Jost"`,
  `700 16px "Archivo"`,
  `400 16px "Schoolbell"`,
];

// Canvas text is rendered at this many times the pixel ratio and displayed
// back down.
//
// Everything on the board already renders at devicePixelRatio, which for a
// locally installed font is enough: system faces ship with hinting tuned for
// exactly this, snapping stems onto the pixel grid at text sizes. A webfont
// has none of that, so at 1:1 its curves land wherever they land and the
// card indexes came out visibly stepped - the cost of trading Helvetica,
// which was never really Helvetica but whatever hinted face the machine
// substituted, for a face we actually control.
//
// 2 is supersampling: four times the texture pixels for a glyph that is a
// few dozen pixels across, which is nothing next to the card art, and the
// downsample is what does the antialiasing the hinting would have.
export const TEXT_OVERSAMPLE = 2;

let pending: Promise<void> | undefined;

/**
 * Resolves once the canvas can draw in the real faces.
 *
 * Phaser rasterizes a Text object at the moment it is created and never
 * re-draws it when a font arrives later - so a scene built before the woff2
 * has loaded is a scene permanently set in Georgia, with the wrong metrics
 * baked into every label's width. Await this before creating the game.
 *
 * It never rejects. A font that fails to load is a board in the fallback
 * face, which is worse-looking but perfectly playable; a board that never
 * appears is not. The 3s cap is for the same reason - `font-display: block`
 * means the DOM is holding its text back too, so an unbounded wait here is
 * an unbounded wait on a blank screen.
 */
export function fontsReady(): Promise<void> {
  if (pending) return pending;
  const fonts = (document as Document).fonts;
  if (!fonts) return (pending = Promise.resolve());

  pending = Promise.race([
    Promise.all(PRELOAD_FACES.map((face) => fonts.load(face).catch(() => undefined)))
      .then(() => fonts.ready)
      .then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  return pending;
}
