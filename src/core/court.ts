import { cardAssetBase } from './assets.js';
import { DeckTheme } from './deck-theme.js';
import { Rect } from './stack.js';

// The twelve court cards, and how to get one out of the source deck.
//
// The art is Dmitry Fomin's CC0 English pattern deck, in assets/cards/court -
// see ATTRIBUTION.md there. Everything in this file is what stands between
// those twelve files and a card you can put on a table, and none of it is
// guesswork: the numbers below were measured off the source by web-nert's
// tools/render-face-art.py, which baked them to WebP. This is the same
// pipeline with the baking taken out, so a palette can be chosen while the
// game is running rather than only while it is being built.
//
// The baked decks were 84 files and 4.1MB, and are gone: twelve sources gzip
// to about 490kB and cover every palette there will ever be, where seven
// directories of WebP covered exactly the seven somebody thought of.
//
// Nothing here touches a canvas - it is string and rectangle arithmetic, and
// it is in the Phaser-free half of the package on purpose.

/** The ranks that have a portrait. Everything else gets a pip. */
export const COURT_RANKS = ['J', 'Q', 'K'] as const;
export type CourtRank = (typeof COURT_RANKS)[number];

/** Rank letter to the word the source files are named with. */
export const COURT_FILE_RANK: Record<CourtRank, string> = {
  J: 'jack', Q: 'queen', K: 'king',
};

export function isCourtRank(rank: string): rank is CourtRank {
  return (COURT_RANKS as readonly string[]).includes(rank);
}

/**
 * Where a court source lives once the assets are served.
 *
 * Same contract as deckThemePath: under `cardAssetBase()`.
 */
export function courtSourcePath(rank: CourtRank, suit: string): string {
  return `${cardAssetBase()}/court/${COURT_FILE_RANK[rank]}-${suit}.svg`;
}

// --- the five inks ------------------------------------------------------

/**
 * The source deck is drawn in five colors and nothing else.
 *
 * There are 24 distinct hex values across the twelve files; the other 19 are
 * Inkscape rounding strays a unit or two off one of these, which is why
 * anything read out of the art is snapped to the nearest of the five rather
 * than matched exactly.
 */
export const COURT_SOURCE_INKS = {
  ink: '#5555aa',
  black: '#000000',
  gold: '#ffff55',
  red: '#ff5555',
  paper: '#ffffff',
} as const;

export type CourtInkRole = keyof typeof COURT_SOURCE_INKS;

/**
 * The roles a theme may move.
 *
 * Gold and red are the garment fields and carry the deck's color. Ink is
 * every line on every face, hand and lock of hair - 12% of the art but the
 * whole of its drawing - and moving it changes the deck's character more than
 * either field does.
 *
 * Paper is 42% of the art, and the rule about it has always been that it has
 * to stay in step with the card fill drawn underneath it or the art reads as
 * a sticker stuck on a white card. That rule used to mean "never move it";
 * now that a game can choose its own card stock it means the opposite - paper
 * follows the card. Leave it out and it stays the near-white the source was
 * drawn on.
 *
 * Black stays put. It is the mass the line work sits on rather than a color
 * anything is printed in, and a deck that moves it is a deck whose faces
 * dissolve into their own garments.
 */
export interface CourtPalette {
  ink: string;
  gold: string;
  red: string;
  /** The card stock: the card's own background. Defaults to COURT_PAPER. */
  paper?: string;
  /**
   * The white *inside* the drawing: faces, hands, linen, the blade of a
   * sword. Defaults to COURT_PAPER, which is what the source was drawn on.
   *
   * Separate from `paper` because a dark deck needs them to be. The source
   * has no white skin to recolor - a face is a *hole* in the drawing, and
   * what shows through it is the card's own background. So one color for both
   * means a dark card takes the King's face with it and leaves line work
   * floating on nothing.
   *
   * The two are told apart by what they touch rather than by anything in the
   * file: the background reaches the edge of the card and a face does not.
   * See `partBackground` in phaser/court-art.ts.
   */
  highlight?: string;
}

/** The seven themes. These were seven directories of WebP until they were
 * three hex values each, which is all they had ever been. */
export const COURT_PALETTES: Record<DeckTheme, CourtPalette> = {
  // The source as drawn - a websafe ramp, bright and a little electric.
  classic: { ink: '#5555aa', gold: '#ffff55', red: '#ff5555' },
  // What four-color offset on uncoated stock actually gets you. No screen
  // palette reaches #ff0000 and neither did any card press.
  press: { ink: '#4a4892', gold: '#e8b422', red: '#cf2436' },
  // Aged: everything pulled toward brown, nothing fully saturated, and the
  // drawing in sepia rather than blue. The stock under it is rag paper
  // rather than white - see DECK_STOCK - so the portraits are not islands
  // of bright card in a drawer-coloured deck.
  antique: { ink: '#6b4a32', gold: '#e0c080', red: '#a85c4a',
    paper: '#f2e6cd', highlight: '#efe0c2' },
  // Green throughout. One hue for all three roles is the hardest case, and
  // the only thing holding it apart is lightness: the three sit on an even
  // ladder because hue does none of the work here.
  millionaire: { ink: '#1e5540', gold: '#9ccf7a', red: '#2f8f5b' },
  // A terminal. Everything is one phosphor at four brightnesses, which is
  // what a monochrome monitor actually gave you: hue does none of the work
  // and the whole portrait is carried by how bright each part glows.
  //
  // `highlight` is the one that matters on a deck this dark. Skin and linen
  // are holes in the drawing that show the stock, and on near-black stock a
  // king with no highlight is a crown floating over nothing - so it is a
  // lit green rather than the paper, which is what puts a face back in.
  matrix: {
    ink: '#2bff6a', gold: '#b6ff7a', red: '#0f7a3c',
    paper: '#060b07', highlight: '#173b22',
  },
  // Tube light. The line work is the violet of the glass itself, the trim
  // is the yellow-white of a lit tube, and the garments are the magenta
  // that gives the deck its name.
  neon: {
    ink: '#b06cff', gold: '#ffe14d', red: '#ff2d95',
    paper: '#14082a', highlight: '#3a1d5c',
  },
  // Dark stock decks keep a light `highlight` so the faces do not vanish.
  midnight: {
    ink: '#3c4a74', gold: '#d9c27a', red: '#c4564e',
    paper: '#12182b', highlight: '#e9edf6',
  },
  casino: {
    ink: '#8a6d1f', gold: '#e6bd4a', red: '#b01e38',
    paper: '#0d0d10', highlight: '#f3e6c4',
  },
  arctic: {
    ink: '#3f7e9c', gold: '#ffffff', red: '#d9648a',
    paper: '#0e1a2e', highlight: '#e8f6fb',
  },
  delft: {
    ink: '#183a8c', gold: '#d6a53a', red: '#d2543c',
    paper: '#fbfcff', highlight: '#fbfcff',
  },
  blush: {
    ink: '#5a2b55', gold: '#d9a38c', red: '#c9606f',
    paper: '#fbf0e4', highlight: '#fdf7ef',
  },
  newsprint: {
    ink: '#3a3a3a', gold: '#a9a9a6', red: '#d42a1e',
    paper: '#e9e9e6', highlight: '#f4f4f1',
  },
};

const RGB = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const CORE = (Object.keys(COURT_SOURCE_INKS) as CourtInkRole[])
  .map((role) => ({ role, rgb: RGB(COURT_SOURCE_INKS[role]) }));

/** Which of the five a color out of the source art is, strays included. */
export function snapCourtInk(hex: string): CourtInkRole {
  const full = hex.length === 4
    ? `#${hex.slice(1).split('').map((c) => c + c).join('')}`
    : hex;
  const rgb = RGB(full.toLowerCase());
  let best = CORE[0];
  let closest = Infinity;
  for (const candidate of CORE) {
    const distance = candidate.rgb.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (distance < closest) { closest = distance; best = candidate; }
  }
  return best.role;
}

// --- the source, and the window taken out of it -------------------------

/**
 * The source geometry. Every fraction here was measured, not chosen.
 *
 * `seam`: the deck is double-ended, so the top half is one complete figure
 * and the bottom half is that same figure upside down, carrying nothing new.
 *
 * `ruleWipe`: the source clips each figure to a border rule at y 0.054, and
 * that rule doubles as the top edge of every crown, hat and sword in the
 * deck. Cropping below it decapitates all twelve. So the crop starts above
 * the rule and the rule itself gets painted out.
 *
 * `left`/`right`: set to where the *figure* reaches rather than to the border
 * rule. Between the rule at x 0.042 and the garment at 0.081 the source
 * leaves a white margin, and cropping at the rule carries that margin into
 * the art as a pale strip down the side of every court. Measured just above
 * the seam, where the figure is widest: 0.081 to 0.919 on all twelve, with
 * both edges set a hair inside so the garment bleeds off rather than stopping
 * on the card.
 *
 * `indexBox`: the source's own rank and its big decorative pip, painted out
 * because the board draws its own index over the top. Cropping in from the
 * left to dodge it does not work - the index sits directly above the
 * shoulder, so any window narrow enough to miss it also cuts off the crown.
 * The bottom edge is measured: the pip ends at y 0.250 and the figure starts
 * at 0.254 on every card, so the box stops in that gap.
 */
export const COURT_SOURCE = {
  width: 360,
  height: 540,
  seam: 0.50,
  left: 0.083,
  right: 0.911,
  top: 0.036,
  ruleWipe: 0.0585,
  indexBox: { left: 0.015, top: 0.010, right: 0.334, bottom: 0.252 },
} as const;

/**
 * The default card stock, and what the source's own marks get painted out
 * with.
 *
 * Not pure white: it has to match the card fill the board draws, or the patch
 * reads as a lighter rectangle sitting on the card. A game that sets its own
 * paper has to move both together, which is why `CourtPalette.paper` and
 * `CardStyle.paper` are the same decision stated once - see `courtPaper`.
 */
export const COURT_PAPER = '#fdfdfd';

/** The stock a palette is printed on, defaulted. */
export function courtPaper(palette: CourtPalette): string {
  return palette.paper ?? COURT_PAPER;
}

/** The white inside the drawing, defaulted. */
export function courtHighlight(palette: CourtPalette): string {
  return palette.highlight ?? COURT_PAPER;
}

/**
 * Background the edges of the art cannot reach, as fractions of the finished
 * picture.
 *
 * Telling the card's background from the figure's own whites is done by where
 * they connect, and on two of the twelve there is a piece of background that
 * connects to nothing: the band to the right of the jack of clubs' head, and
 * the sliver between the king of hearts' hair and his sword. Both are walled
 * in by the figure on every side and by the crop on none.
 *
 * No rule found them, and the reason is that no rule can. A face is a hole in
 * the drawing and so is one of these; they are the same thing to anything
 * that looks at shape or connection, which is why a flood that reaches these
 * also eats the queen of hearts' face. What separates them is knowing what
 * the picture is *of*.
 *
 * So they are written down. These twelve files are public-domain art from
 * 2012 that has not changed and will not, in the same way the crop window
 * above is measured off them rather than computed - and if one is ever
 * replaced, `court.spec.ts` checks that every seat here still lands on
 * something pale.
 */
export const COURT_BACKGROUND_SEEDS: Readonly<Record<string, readonly CourtSeed[]>> = {
  'J-clubs': [{ x: 0.850, y: 0.380 }],
  'K-hearts': [{ x: 0.769, y: 0.362 }],
};

/** A place in the finished art, as fractions of its width and height. */
export interface CourtSeed { x: number; y: number }

/**
 * The seeds for one card, in fractions of the finished art.
 *
 * Recorded against the half crop, so a cut that takes a different window has
 * to move them: back out to where they are on the page, then in again by that
 * window. Done by arithmetic rather than by a factor, because the two windows
 * do not start in the same place - the full one opens lower, at the wipe -
 * and a factor that happened to be right when they did would have gone quietly
 * wrong when they stopped.
 *
 * And the source is double-ended, so every walled-off patch has a twin half a
 * turn away: the sliver beside the king of hearts' sword is there twice on a
 * printed card, once each way up, and seeding only the first leaves the
 * second the wrong colour on any deck whose stock is not its highlight.
 */
export function courtSeeds(
  rank: string, suit: string, cut: CourtCut = 'half',
): readonly CourtSeed[] {
  const seeds = COURT_BACKGROUND_SEEDS[`${rank}-${suit}`] ?? [];
  if (cut === 'half') return seeds;
  return seeds.flatMap(({ x, y }) => [
    { x, y: seedIn(y, cut) },
    { x: 1 - x, y: 1 - seedIn(y, cut) },
  ]);
}

/** A seed's y, recorded against the half crop, in some other cut's window. */
function seedIn(y: number, cut: CourtCut): number {
  const { top, seam } = COURT_SOURCE;
  const onPage = top + y * (seam - top);
  const from = courtTop(cut);
  return (onPage - from) / (courtBottom(cut) - from);
}

/**
 * How tall the finished art is for a given width.
 *
 * Taken from the crop's own proportions rather than fixed. The window is
 * chosen to hold the figure and the card's art slot is then whatever shape
 * that turns out to be; sizing it the other way round is what forced the
 * crop to cut crowns off in the first place.
 */
export function courtArtHeight(width: number, cut: CourtCut = 'half'): number {
  const { left, right, width: sw, height: sh } = COURT_SOURCE;
  const window = courtBottom(cut) - courtTop(cut);
  return Math.round((width * (window * sh)) / ((right - left) * sw));
}

/**
 * How much of the source a card takes: one figure, or both.
 *
 * `full` is what a real card is. The source is double-ended - one figure and
 * the same figure upside down, meeting at the seam - and a printed court
 * shows all of it, which is what lets the card be picked up either way round
 * and is most of why a court looks like a court.
 *
 * `half` is this package's own, and it is not a shortcut. The mobile face has
 * one index rather than two and gives the whole bottom of the card to the
 * figure, so it wants one figure at twice the size. Handing that layout a
 * double-ended court would put two small kings where one large one was.
 */
export type CourtCut = 'half' | 'full';

/**
 * Where the window starts.
 *
 * The half crop opens at the page's own margin and keeps the blank strip
 * above the figure, which on the mobile face is card under the index and is
 * meant to be there. In a ruled panel that same strip is a gap between the
 * picture and its frame, so the full crop opens where the wipe ends instead -
 * which is where the figure starts, measured: the blank band came out at
 * 0.0248 of the art on all twelve, and that lands on `ruleWipe` to within a
 * pixel of any raster this is drawn at.
 */
function courtTop(cut: CourtCut): number {
  return cut === 'full' ? COURT_SOURCE.ruleWipe : COURT_SOURCE.top;
}

/** Where it stops: the seam for one figure, the far margin for both. */
function courtBottom(cut: CourtCut): number {
  return cut === 'full' ? 1 - COURT_SOURCE.ruleWipe : COURT_SOURCE.seam;
}

/**
 * How big to render the whole source so that the crop lands at `width`.
 *
 * The crop is a window onto the middle of the page, so the page has to be
 * drawn bigger than the piece wanted from it.
 */
export function courtSourceSize(width: number): { width: number; height: number } {
  const full = Math.round(width / (COURT_SOURCE.right - COURT_SOURCE.left));
  return { width: full, height: Math.round((full * COURT_SOURCE.height) / COURT_SOURCE.width) };
}

/** The window to lift out of a rendered source of this size. */
export function courtCropRect(
  source: { width: number; height: number }, cut: CourtCut = 'half',
): Rect {
  const { left, right } = COURT_SOURCE;
  const top = courtTop(cut);
  return {
    x: Math.round(left * source.width),
    y: Math.round(top * source.height),
    width: Math.round((right - left) * source.width),
    height: Math.round((courtBottom(cut) - top) * source.height),
  };
}

/**
 * The rectangles to paint over in paper before cropping: the border rule with
 * everything above it, and the source's own index.
 *
 * Wiping the full width above the rule costs nothing - the source clips its
 * figure to that line, so there is only white margin up there.
 */
export function courtWipeRects(
  source: { width: number; height: number }, cut: CourtCut = 'half',
): Rect[] {
  const { ruleWipe, indexBox } = COURT_SOURCE;
  const box = (l: number, t: number, r: number, b: number): Rect => ({
    x: Math.round(l * source.width),
    y: Math.round(t * source.height),
    width: Math.round((r - l) * source.width),
    height: Math.round((b - t) * source.height),
  });

  const rects = [
    box(0, 0, 1, ruleWipe),
    box(indexBox.left, indexBox.top, indexBox.right, indexBox.bottom),
  ];
  if (cut === 'half') return rects;

  // The far end of the card, which the half crop never reached. The source is
  // double-ended, so its second rule and second index are the first two
  // turned half a turn about the middle - which is exactly the reflection
  // below, and the reason neither needed measuring again.
  return [
    ...rects,
    box(0, 1 - ruleWipe, 1, 1),
    box(1 - indexBox.right, 1 - indexBox.bottom, 1 - indexBox.left, 1 - indexBox.top),
  ];
}

// --- preparing one file -------------------------------------------------

// Only fills and strokes, so a color mentioned in metadata or in an editor
// attribute is left alone.
const PAINT = /((?:fill|stroke)\s*[:=]\s*"?)(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\b/g;

/**
 * Swap the three movable roles, in the SVG rather than in the bitmap.
 *
 * Done before rasterising so the browser regenerates the blends: about 15% of
 * the art is antialiased pixels lying between two of the five colors, and
 * remapping those by nearest-neighbour after the fact bands every edge in the
 * deck.
 */
export function recolorCourt(svg: string, palette: CourtPalette): string {
  // Every white goes to the highlight, the card's background included. The
  // background is pulled back to the stock afterwards, on the canvas, by
  // `partBackground` - see there for why it cannot be done here.
  return svg.replace(PAINT, (whole, lead: string, hex: string) => {
    const role = snapCourtInk(hex);
    const want = role === 'ink' ? palette.ink
      : role === 'gold' ? palette.gold
        : role === 'red' ? palette.red
          : role === 'paper' ? courtHighlight(palette)
            : undefined;
    return want === undefined ? whole : lead + want;
  });
}

/**
 * Give the source the viewBox it should have had.
 *
 * These come out of Inkscape with width="360" height="540" and *no* viewBox,
 * which is the trap: without one there is no mapping from user units to the
 * viewport, so enlarging the svg element only enlarges the canvas. The
 * drawing stays 360x540 in the top-left corner and the rest comes back blank,
 * which looks exactly like art that failed to scale and is easy to go hunting
 * for in the renderer instead.
 */
export function withCourtViewBox(svg: string): string {
  if (svg.includes('viewBox')) return svg;
  return svg.replace('<svg', `<svg viewBox="0 0 ${COURT_SOURCE.width} ${COURT_SOURCE.height}"`);
}

/** One source file, recolored and made scalable. */
export function prepareCourt(svg: string, palette: CourtPalette): string {
  return recolorCourt(withCourtViewBox(svg), palette);
}
