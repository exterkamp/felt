import { shuffle } from './shuffle.js';
// What a card is, before anybody decides what game is being played with it.
//
// The vocabulary two games already agreed on without meaning to: web-nert and
// web-solitaire each grew their own copy of this file, and the copies were
// identical apart from the comments. That is the test for whether something
// belongs in here - not "could this be shared" but "was it already written
// twice the same way".
//
// A card here is a base to extend rather than a shape to conform to. The two
// games' cards turned out to agree exactly on four fields and differ only by
// what one of them adds - see Card below - and the same goes for suits: the
// four are here, and a game that has invented others declares them where it
// uses them. See defineSuits.

/** The four natural suits, in the order foundations are usually laid out. */
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

/** Whether a suit is one of the four a standard deck is built from. */
export function isStandardSuit(suit: string): suit is Suit {
  return (SUITS as readonly string[]).includes(suit);
}

export const RANKS = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
] as const;
export type Rank = (typeof RANKS)[number];

/**
 * What color a suit counts as.
 *
 * `'red'` and `'black'` are the two a standard deck has; the type stays open
 * because a game that adds a suit may want a color to go with it, and a
 * fifth suit that is neither red nor black is a perfectly ordinary thing for
 * a game to want.
 *
 * This is the color a *rule* asks about, which is not always the color the
 * card is printed in. Nertz's star is drawn in gold and counts as black when
 * its tableau asks for alternating colors - two different questions, and
 * only this one is about the rules.
 */
export type SuitColor = 'red' | 'black' | (string & {});

export const SUIT_COLORS: Readonly<Record<Suit, SuitColor>> = {
  spades: 'black',
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
};

/** The four, split by color. A game with suits of its own wants defineSuits. */
export const RED_SUITS: ReadonlySet<string> = new Set(['hearts', 'diamonds']);
export const BLACK_SUITS: ReadonlySet<string> = new Set(['spades', 'clubs']);

/**
 * The color of one of the four, or nothing for a suit this package has never
 * heard of.
 *
 * Nothing rather than a guess, and that is the whole point of this function
 * existing alongside isRed: once a game can add suits, "not red" stops
 * meaning "black". A gold star is neither, and a package that answered
 * `false` to isRed and let the caller infer black would be putting a
 * game's rule - nertz's rule, as it happens - into everybody's cards.
 */
export function colorOf(suit: string): SuitColor | undefined {
  return isStandardSuit(suit) ? SUIT_COLORS[suit] : undefined;
}

/** Whether a suit is red. False for a suit this package does not know. */
export function isRed(suit: string): boolean {
  return colorOf(suit) === 'red';
}

/**
 * Whether a suit is black. Also false for a suit this package does not know -
 * which is why both of these exist rather than one and a negation.
 */
export function isBlack(suit: string): boolean {
  return colorOf(suit) === 'black';
}

/**
 * Whether two suits are the same color.
 *
 * Most tableaus alternate color rather than suit, so this - not the suit -
 * is what a placement rule actually asks about.
 *
 * False if either suit is one this package does not know, because the honest
 * answer about an unknown color is not "yes". A game with suits of its own
 * asks its own vocabulary, where every suit's color is declared.
 */
export function sameColor(a: string, b: string): boolean {
  const color = colorOf(a);
  return color !== undefined && color === colorOf(b);
}

/**
 * A suit vocabulary: the four standard ones plus whatever a game has added.
 *
 * Suits a game invents are the game's, not this package's. An earlier version
 * of this file hard-coded `star` into a SPECIAL_SUITS array because one of the
 * two consumers has one, which made every other consumer carry a suit it has
 * never heard of, and made that consumer's suit something it had to ask
 * permission to add.
 *
 * So the extra suits are declared where they are used, with the color their
 * rules should treat them as, and what comes back is a small object that
 * knows about them:
 *
 * ```ts
 * // in the game, not here
 * export const SUITS_IN_PLAY = defineSuits({ star: { color: 'black' } });
 * export type CardSuit = SuitOf<typeof SUITS_IN_PLAY>;   // Suit | 'star'
 *
 * SUITS_IN_PLAY.colorOf('star');     // 'black' - what the tableau asks
 * SUITS_IN_PLAY.isStandard('star');   // false - this is what "special" meant
 * ```
 *
 * A color is required rather than optional because the question this
 * package cannot answer for you is exactly that one. Nertz's star is printed
 * in gold and plays as black; a game wanting a suit that is genuinely
 * neither says `{ color: 'gold' }` and gets false from both isRed and
 * isBlack, which is the answer that stops a red-and-black rule quietly
 * swallowing it.
 *
 * A value rather than a registry with a register() on it, and that is
 * deliberate: a module-level registry has to be written to before anything
 * reads it, which is an ordering problem in the app and a shared-state problem
 * in its tests. This is just a constant a game exports.
 */
export interface SuitVocabulary<S extends string> {
  /** Every suit in play, the four standard ones first. */
  readonly all: readonly S[];
  /** Always an answer here, because every suit in play was declared. */
  colorOf(suit: S): SuitColor;
  isRed(suit: S): boolean;
  isBlack(suit: S): boolean;
  sameColor(a: S, b: S): boolean;
  /** Whether this is one of the four a deck is built from. */
  isStandard(suit: S): suit is S & Suit;
}

/** The suit type a vocabulary describes, for naming it in the game. */
export type SuitOf<V> = V extends SuitVocabulary<infer S> ? S : never;

export function defineSuits<E extends string = never>(
  extra: Record<E, { color: SuitColor }> = {} as Record<E, { color: SuitColor }>,
): SuitVocabulary<Suit | E> {
  const added = Object.entries(extra) as [E, { color: SuitColor }][];
  const colors = new Map<string, SuitColor>([
    ...Object.entries(SUIT_COLORS),
    ...added.map(([suit, how]) => [suit, how.color] as const),
  ]);
  const all = [...SUITS, ...added.map(([suit]) => suit)] as (Suit | E)[];

  // Declared, so there is always an answer - which is the difference between
  // asking a vocabulary and asking the free functions above.
  const colorHere = (suit: Suit | E) => colors.get(suit) as SuitColor;
  return {
    all,
    colorOf: colorHere,
    isRed: (suit) => colorHere(suit) === 'red',
    isBlack: (suit) => colorHere(suit) === 'black',
    sameColor: (a, b) => colorHere(a) === colorHere(b),
    isStandard: (suit): suit is (Suit | E) & Suit => isStandardSuit(suit),
  };
}

/** The four and nothing else, for a game that never adds any. */
export const STANDARD_SUITS: SuitVocabulary<Suit> = defineSuits();

/**
 * Ace is 1 and king is 13.
 *
 * The number every rank comparison goes through. Whether the sequence wraps
 * past the king is the game's business and not this function's: Tri Peaks and
 * Black Hole wrap, Golf does not, and each says so where it compares.
 */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 1;
}

/**
 * Enough to name a card without holding one.
 *
 * A face is not a card: it is the rank and suit, which is all anything
 * comparing two cards by their identity in the deck actually needs. Nertz
 * refers to cards across rounds this way, because ids are minted fresh on
 * every deal and say nothing about the card they were on last time.
 */
export interface CardFace<S extends string = Suit> {
  suit: S;
  rank: Rank;
}

/**
 * A card on a table: a face, something to call it, and which way up it is.
 *
 * The base every game extends rather than a shape they all have to fit. These
 * four fields are not a guess at a common denominator - they are exactly what
 * the two games already had in common, field for field. Solitaire's card *is*
 * this and nothing else; nertz's is this plus a seat, a deck-list entry and a
 * set of marks:
 *
 * ```ts
 * interface NertzCard extends Card {
 *   seat: number;          // whose deck it came from
 *   entry: number;         // which line of that deck list
 *   marks?: CardMark[];    // what the shop did to it
 * }
 * ```
 *
 * `id` is in the base because both games need one and for the same reason: a
 * renderer keys its sprites off it, so two cards sharing an id is one card
 * drawn in two places. What the id is made *of* is the game's business -
 * `suit-rank` where a deck holds one of each, a counter where it can hold
 * two - which is why buildDeck lets you mint your own.
 *
 * An interface rather than a class, because both games hold cards in pure
 * state that is copied with a spread on every move. A class would survive
 * `{ ...card }` as a plain object with the methods missing, which is the kind
 * of bug that shows up three refactors later. A class of your own may of
 * course `implements Card`.
 */
export interface Card<S extends string = Suit> extends CardFace<S> {
  id: string;
  faceUp: boolean;
}

export function sameFace(a: CardFace<string>, b: CardFace<string>): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

export function cardName(face: CardFace<string>): string {
  return `${face.rank} of ${face.suit}`;
}

/** The fifty-two faces of a standard deck, suit by suit. */
export function standardDeck(): CardFace[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

/**
 * A fresh fifty-two card deck, in order, all face down.
 *
 * With no argument the id is the suit and rank - `spades-K` - which is only
 * safe because a standard deck holds exactly one of each, and is worth it for
 * what it does to a failing test: `spades-K` says which card went wrong and
 * `card-37` does not.
 *
 * With one, the deck is whatever you make of each face, which is how a game
 * whose deck can hold two of the same card mints ids it can tell apart, and
 * how it adds its own fields on the way past:
 *
 * ```ts
 * let n = 0;
 * const deck = buildDeck((face, index) => ({
 *   ...face, id: `s${seat}-${face.suit}-${face.rank}-${n++}`,
 *   faceUp: false, seat, entry: index,
 * }));   // NertzCard[]
 * ```
 */
export function buildDeck(): Card[];
export function buildDeck<T extends Card<string>>(
  make: (face: CardFace, index: number) => T,
): T[];
export function buildDeck<T extends Card<string>>(
  make?: (face: CardFace, index: number) => T,
): T[] | Card[] {
  const faces = standardDeck();
  if (!make) {
    return faces.map((face) => ({ ...face, id: `${face.suit}-${face.rank}`, faceUp: false }));
  }
  return faces.map(make);
}

/**
 * A shuffled deck, which is what a game actually wants.
 *
 * `shuffle(buildDeck(), random)` is written once per game that will ever be
 * written - twelve times over in web-solitaire alone. The random is the
 * argument that matters: pass `Math.random` and get a deal, pass `seeded(n)`
 * and get the same deal every time, which is how a game that went wrong is
 * played again.
 *
 * A game with suits of its own composes the two itself - `shuffle(buildDeck(
 * make), random)` - rather than this growing an overload for it.
 */
export function shuffledDeck(random: () => number = Math.random): Card[] {
  return shuffle(buildDeck(), random);
}

/**
 * The card on top of a pile, or nothing if there is no pile left.
 *
 * Every pile in both games is stored bottom-first, so the last element is the
 * one you can reach. It is worth being consistent about even where it reads
 * oddly, as it does for a face-down stock.
 *
 * Generic so it hands back your card type rather than this one: `topOf(pile)`
 * on a pile of nertz cards still knows about seats.
 */
export function topOf<T>(pile: readonly T[]): T | undefined {
  return pile[pile.length - 1];
}

/**
 * A copy of a pile, one level deep, keeping whatever type it was.
 *
 * For the games that hold their state as plain data and produce a new state
 * per move rather than editing the old one - a copy here is what stops an
 * undo stack being fifty references to the same cards. One level is enough
 * for every card model here; a card holding a nested array of its own (nertz
 * marks) gets that array shared, which is why marks are replaced rather than
 * pushed to.
 */
export function cloneCards<T extends Card<string>>(pile: readonly T[]): T[] {
  return pile.map((card) => ({ ...card }));
}

// Poker size is 2.5 x 3.5 inches - a 5:7 ratio - and cards look wrong at
// anything else, so anything drawing one should keep that proportion exactly.
export const CARD_ASPECT = 5 / 7;

/**
 * The card size both games settled on, in the 480-unit-wide logical space
 * they both draw in.
 *
 * Here because they agreed, not because anybody has to use them: a board with
 * different room should pick its own and keep CARD_ASPECT.
 */
export const CARD_WIDTH = 60;
export const CARD_HEIGHT = CARD_WIDTH / CARD_ASPECT;
