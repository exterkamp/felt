import { CARD_ASPECT, CARD_WIDTH, Rank } from './cards.js';
import type { CourtCut } from './court.js';

// What a card face looks like, as numbers.
//
// Three faces, because a card is laid out for the thing it is read on.
//
//   mobile    a large index with its suit beside it in the top-left, one big
//             suit filling the rest, and no second corner at all
//   standard  the card as it is printed: rank over suit in two opposite
//             corners, and a true count of pips in the classic arrangement
//   jumbo     the same, with indices at roughly twice the size - the deck
//             sold for players who cannot read a standard one across a table
//
// `mobile` is Nertz's, which is the one of the two games that had thought
// hardest about a card seen four at a time on a phone: once a card is legible
// at a glance the second index is redundant, and dropping it is what paid for
// everything else being bigger. It is still the default for that reason.
//
// What the other two buy is the thing `mobile` gave up. A standard card tells
// you its rank twice, from either end, so a hand held fanned either way round
// reads - and its pips are a count rather than a symbol, which is the only
// version of a card where a seven and a nine differ by something other than a
// digit. At small sizes that is a worse card. At the size a card is actually
// dealt on a table it is the right one.
//
// Here rather than in the sprite so it can be checked without a browser. The
// sprite is fifteen setPosition calls against these numbers; the numbers are
// the part that can be wrong in a way nobody notices until a card is fanned
// under another one.

/** The size everything below was measured at. */
export const BASE_CARD_WIDTH = CARD_WIDTH;

/** Which of the three layouts a card is printed in. */
export type FaceStyle = 'mobile' | 'standard' | 'jumbo';

export const FACE_STYLES: readonly FaceStyle[] = ['mobile', 'standard', 'jumbo'];

/** What a game gets if it says nothing - see the note at the top. */
export const DEFAULT_FACE_STYLE: FaceStyle = 'mobile';

export interface CardFaceMetrics {
  face: FaceStyle;
  width: number;
  height: number;
  /** Corner radius of the card body. */
  radius: number;
  /** Room around the body for its shadow, on every side. */
  pad: number;
  index: {
    /** Where the rank's left edge and vertical middle sit, from the centre. */
    x: number;
    y: number;
    fontSize: number;
    /** Gap between the rank's right edge and its suit. */
    gap: number;
    suitSize: number;
    /**
     * Where the suit's middle sits when it is stacked under the rank.
     *
     * Worked out here rather than in the sprite, because `peek` depends on
     * it: how much of a card has to show is how much of it the corner
     * occupies, and a corner whose suit grew without the peek following is a
     * fanned pile that clips its own suits.
     */
    suitY: number;
    /**
     * The suit under the rank rather than beside it.
     *
     * Which is what a printed card does, and what makes a corner narrow
     * enough to be read from a hand held in a fan. Beside it is the mobile
     * layout's, where the corner is wide because nothing is fanned over it.
     */
    stacked: boolean;
  };
  /**
   * Whether the index is repeated, upside down, in the opposite corner.
   *
   * One on the mobile face and two on the other two. A card with one index
   * has a right way up; a card with two can be picked up either way round,
   * which is most of why printed cards have had two since the 1860s.
   */
  corners: 1 | 2;
  /** The one big suit a number card carries, centred on this point. */
  pip: { y: number; size: number };
  /**
   * How a court is printed on this face.
   *
   * `cut` is how much of the source art the card takes - see `CourtCut`. A
   * real card is `full`: the double-ended figure, which is what lets a court
   * be picked up either way round. The mobile face takes `half` and gives it
   * the whole bottom of the card instead, because it has one index rather
   * than two and one large figure beats two small ones.
   *
   * `panel` is how wide the framed portrait is, as a fraction of the card,
   * on the faces that frame one. It has to clear the corners: a court's rank
   * is one character, so the panel starts just inside where a J, Q or K ends.
   */
  court: { cut: CourtCut; panel: number };
  /**
   * The box the pips are counted out in, on the faces that count them.
   *
   * Undefined on the mobile face, which draws one big suit instead - five
   * rows of small glyphs at that size reads as a blurry cluster rather than
   * as a card.
   */
  pips?: {
    /** Each glyph's size. */
    size: number;
    /** The ace's, which is bigger than the rest on every printed deck. */
    aceSize: number;
    /** The field, from the card's centre. */
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  /**
   * How much of a card has to show for its index to be readable - the ink
   * plus its two margins, and nothing else.
   *
   * This is the number a fanned pile's step is chosen against: less than
   * this and the pile is a column of half-indexes; much more and the pile is
   * longer than it needs to be. A font box is substantially taller than the
   * glyphs in it, so this is measured off the ink rather than taken from a
   * Text object's height.
   */
  peek: number;
}

// Measured off rendered cards at 60 units wide, and every one of them is a
// ratio of the width so a card can be drawn at any size. The comments on the
// mobile face are Nertz's reasoning, kept because the numbers are otherwise
// arbitrary.
const SHARED = {
  radius: 6 / 60,
  pad: 7 / 60,
};

interface FaceRatios {
  // Archivo at 27px puts down 19px of ink, which is the proportion the mobile
  // corner was laid out against.
  indexFontSize: number;
  indexLeft: number;
  indexGap: number;
  indexSuitSize: number;
  stacked: boolean;
  corners: 1 | 2;
  /** Only used by the stacked faces; see `stackGap`. */
  // Half-height of the index's actual ink, and the gaps above and below it.
  inkHalfHeight: number;
  inkTopMargin: number;
  inkBottomMargin: number;
  // One big suit rather than a true pip count, on the face that has no room
  // to count: five rows of small glyphs at phone size reads as a blurry
  // cluster rather than as a card.
  pipSize: number;
  pipCentreY: number;
  /** The counted field, on the faces that have one. */
  pips?: { size: number; aceSize: number; inset: number; top: number };
  court: { cut: CourtCut; panel: number };
}

// Half a rank's cap height, and the air between it and the suit under it -
// both as fractions of the font size. The cap figure is Archivo's; the gap is
// chosen, and it is small on purpose, because a printed corner is a tight
// column and anything roomier reads as two marks rather than as one index.
const CAP_HALF = 0.36;
const STACK_GAP = 0.12;

const FACES: Record<FaceStyle, FaceRatios> = {
  mobile: {
    indexFontSize: 27 / 60,
    indexLeft: 5 / 60,
    indexGap: 1 / 60,
    indexSuitSize: 20 / 60,
    stacked: false,
    corners: 1,
    inkHalfHeight: 9.7 / 60,
    inkTopMargin: 6 / 60,
    inkBottomMargin: 4 / 60,
    pipSize: 48 / 60,
    pipCentreY: 12.5 / 60,
    // One figure, full bleed across the bottom of the card. The face has a
    // single index and nothing else to fit, so the figure gets everything
    // below it at twice the size a double-ended one would be.
    court: { cut: 'half', panel: 1 },
  },
  // The card as it is printed. A real index is about 7mm on a 63mm card, and
  // the font box is half again as tall as the ink in it, so 15/60 of the
  // width lands on roughly the right amount of ink. The corner is narrow -
  // rank over suit, both about the same size - because that column is what
  // has to show when a hand is fanned.
  standard: {
    // Small, and it has to be. A real index is about 4.5mm of cap height on a
    // 63mm card, and the reason it is that small is the pips: the outer
    // column of a ten runs down the card a third of the way in, and anything
    // wider than this in the corner is printed on top of it. The widest rank
    // is "10", which is what the clearance was measured against.
    indexFontSize: 8 / 60,
    indexLeft: 3 / 60,
    indexGap: 0,
    // As tall as the rank's own box. Bigger than a printed card's, and
    // deliberately: the suit glyphs do not fill their box evenly - a spade
    // covers 0.68 of its width where a club covers 0.86 - so a suit sized to
    // match the rank on paper reads as a shrunken spade on a quarter of the
    // deck. This is the size that stops it.
    indexSuitSize: 8 / 60,
    stacked: true,
    corners: 2,
    inkHalfHeight: 2.9 / 60,
    inkTopMargin: 3.2 / 60,
    // Deep enough to clear the suit under the rank as well as the rank, which
    // is what a two-cornered card has to show before it can be read.
    inkBottomMargin: 2.5 / 60,
    pipSize: 34 / 60,
    pipCentreY: 0,
    // Three columns and four rows of them have to fit between the two
    // corners, which is what fixes both of these. Too little inset and the
    // top row of a ten sits in the index; too much and the outer columns
    // meet the middle one.
    pips: { size: 9 / 60, aceSize: 22 / 60, inset: 19.5 / 60, top: 13 / 60 },
    // The card as it is printed: both figures, in a ruled panel with the
    // corners beside it and clear of it.
    //
    // A real panel is about 0.70 of the width. This one is narrower, and the
    // reason is the index above it: a printed rank is roughly half the size
    // of this one, so a real corner is a narrow enough column to sit beside a
    // 0.70 panel and this one is not. Measured rather than reasoned - the
    // widest court rank is Q at 0.75 of the font size, which puts the corner
    // at 21.0 units in on a 60-unit card, and the frame has to start outside
    // that.
    //
    // I tried 0.70 first, on the grounds that a real card's corner and frame
    // very nearly touch. They do - but "very nearly" there is a printed
    // hairline's worth, and here it came out as a rank sitting on the rule.
    court: { cut: 'full', panel: 0.62 },
  },
  // The deck sold to people who cannot read a standard one across a table:
  // the same card with the corners at about twice the size. The pip field
  // gives way rather than the index - a jumbo deck's pips really are
  // squeezed, and that is the trade the deck exists to make.
  jumbo: {
    // Half again as big as the standard index, which is about what the real
    // decks do. Every unit of it is paid for by the pips below.
    indexFontSize: 11 / 60,
    indexLeft: 2 / 60,
    indexGap: 0,
    // And a size up again from standard's, which is what makes this a jumbo
    // corner rather than a standard one set in a larger rank.
    indexSuitSize: 11 / 60,
    stacked: true,
    corners: 2,
    inkHalfHeight: 4.3 / 60,
    inkTopMargin: 3.2 / 60,
    inkBottomMargin: 2.5 / 60,
    pipSize: 30 / 60,
    pipCentreY: 0,
    // An index this wide cannot be cleared sideways - there is no room left
    // between the corners for three columns of pips - so the field gives way
    // downwards instead and the pips get smaller. That squeeze is the trade
    // a jumbo deck exists to make, and it is why the pips on a real one look
    // cramped next to a standard card's. `top` is set by where the suit under
    // the rank ends, plus a pip's own half-height.
    pips: { size: 8.5 / 60, aceSize: 20 / 60, inset: 19.5 / 60, top: 26 / 60 },
    // A wider corner needs a narrower panel, and jumbo's is much wider: its Q
    // reaches 18.5 units in where the standard face's reaches 21.0. The
    // court gives way, which is the trade this deck exists to make and the
    // same one its pips already made.
    court: { cut: 'full', panel: 0.56 },
  },
};

export function cardFaceMetrics(
  width: number = BASE_CARD_WIDTH, face: FaceStyle = DEFAULT_FACE_STYLE,
): CardFaceMetrics {
  const height = width / CARD_ASPECT;
  const at = (ratio: number) => ratio * width;
  const ratios = FACES[face] ?? FACES[DEFAULT_FACE_STYLE];
  const inkHalf = at(ratios.inkHalfHeight);
  const inkTop = at(ratios.inkTopMargin);
  const fontSize = at(ratios.indexFontSize);
  const suitSize = at(ratios.indexSuitSize);
  // Up from the middle by everything above the ink's own middle.
  const indexY = -(height / 2 - (inkTop + inkHalf));
  // Under the rank, clear of it by a hair. Beside it on the mobile face, so
  // there the suit shares the rank's own line.
  const suitY = ratios.stacked
    ? indexY + fontSize * (CAP_HALF + STACK_GAP) + suitSize / 2
    : indexY;

  return {
    face,
    width,
    height,
    radius: at(SHARED.radius),
    pad: at(SHARED.pad),
    index: {
      x: -width / 2 + at(ratios.indexLeft),
      y: indexY,
      suitY,
      fontSize,
      gap: at(ratios.indexGap),
      suitSize,
      stacked: ratios.stacked,
    },
    corners: ratios.corners,
    pip: { y: at(ratios.pipCentreY), size: at(ratios.pipSize) },
    pips: ratios.pips && {
      size: at(ratios.pips.size),
      aceSize: at(ratios.pips.aceSize),
      left: -width / 2 + at(ratios.pips.inset),
      right: width / 2 - at(ratios.pips.inset),
      top: -height / 2 + at(ratios.pips.top),
      bottom: height / 2 - at(ratios.pips.top),
    },
    court: ratios.court,
    // What has to show before the corner can be read. On the mobile face that
    // is the one line of ink and its margins; on a stacked one it is measured
    // to the bottom of the suit, so that growing the suit moves the peek with
    // it rather than leaving a fanned pile clipping its own pips.
    peek: ratios.stacked
      ? suitY + suitSize / 2 + height / 2 + at(ratios.inkBottomMargin)
      : inkTop + 2 * inkHalf + at(ratios.inkBottomMargin),
  };
}

/**
 * Where the pips go on a number card, as fractions of the field.
 *
 * `x` runs 0 (left column) to 1 (right), `y` runs 0 (top row) to 1 (bottom).
 * A pip in the bottom half is printed upside down - which is not decoration:
 * it is what makes the card the same either way up, and it is the detail
 * whose absence makes a drawn card look wrong without anyone being able to
 * say why.
 *
 * These are the real arrangements and not a grid. Seven is six with one pip
 * between the top pair, not seven in rows; ten is four down each side with
 * two more slid in between them. Getting eight and ten wrong is the usual
 * way a home-made deck gives itself away.
 */
export interface PipPlace { x: number; y: number; flip: boolean; big?: boolean }

export function pipLayout(rank: Rank): readonly PipPlace[] {
  const place = (x: number, y: number, big?: boolean): PipPlace =>
    ({ x, y, flip: y > 0.5 + 1e-6, big });
  const sides = (ys: number[]) => ys.flatMap((y) => [place(0, y), place(1, y)]);

  switch (rank) {
    case 'A': return [place(0.5, 0.5, true)];
    case '2': return [place(0.5, 0), place(0.5, 1)];
    case '3': return [place(0.5, 0), place(0.5, 0.5), place(0.5, 1)];
    case '4': return sides([0, 1]);
    case '5': return [...sides([0, 1]), place(0.5, 0.5)];
    case '6': return sides([0, 0.5, 1]);
    // The seventh sits between the top pair, which is why a seven and a six
    // are told apart at a glance rather than counted.
    case '7': return [...sides([0, 0.5, 1]), place(0.5, 0.25)];
    case '8': return [...sides([0, 0.5, 1]), place(0.5, 0.25), place(0.5, 0.75)];
    case '9': return [...sides([0, 1 / 3, 2 / 3, 1]), place(0.5, 0.5)];
    case '10': return [...sides([0, 1 / 3, 2 / 3, 1]), place(0.5, 1 / 6), place(0.5, 5 / 6)];
    // A court has a portrait instead, and a suit nobody declared has nothing
    // to count.
    default: return [];
  }
}

/** The same, in the card's own coordinates. */
export function pipPlaces(
  metrics: CardFaceMetrics, rank: Rank,
): readonly { x: number; y: number; size: number; flip: boolean }[] {
  const field = metrics.pips;
  if (!field) return [];
  return pipLayout(rank).map((pip) => ({
    x: field.left + (field.right - field.left) * pip.x,
    y: field.top + (field.bottom - field.top) * pip.y,
    size: pip.big ? field.aceSize : field.size,
    flip: pip.flip,
  }));
}

/**
 * Where a court portrait sits: full width, flush with the bottom edge, its
 * height taken from the art's own proportions.
 *
 * Full bleed on purpose - the figure runs to the card's edges rather than
 * sitting in a frame - and the height comes from the texture rather than
 * being named here, because the crop is decided when the art is cut and this
 * has to follow it.
 */
export function courtArtRect(
  metrics: CardFaceMetrics, art: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (metrics.court.cut === 'full') {
    // A framed panel in the middle of the card, the way a printed court is:
    // narrow enough that the two corners sit beside it rather than on it, and
    // as tall as that width makes it. The source's own proportions come out
    // at very nearly a real court panel's, so nothing has to be squeezed.
    const width = metrics.width * metrics.court.panel;
    return { x: 0, y: 0, width, height: (width * art.height) / art.width };
  }
  const height = (metrics.width * art.height) / art.width;
  return { x: 0, y: metrics.height / 2 - height / 2, width: metrics.width, height };
}
