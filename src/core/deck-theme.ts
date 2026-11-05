import { cardAssetBase } from './assets.js';
// The decks a player can hold. Each is a whole palette - the courts' line
// work and garment colors, and a card back with its own field, medallion and
// border.
//
// A theme is a palette and a back. The courts it names are rendered from the
// twelve SVG sources - see court.ts, where COURT_PALETTES holds them -
// and only the back is a file, under assets/cards/art/<theme>/back.webp.
//
// This file and that art are the reason the package exists: both games had
// their own copy of the directory, byte for byte the same.
//
// A theme name is effectively a wire format in a game with a lobby - renaming
// one breaks a match in progress - and it is a storage format in a game
// without one. Either way it is a name that outlives the session, which is
// why nothing here is generated and why asDeckTheme exists.
export const DECK_THEMES = [
  'classic',
  'press',
  'antique',
  'millionaire',
  'matrix',
  'neon',
  'midnight',
  'casino',
  'arctic',
  'delft',
  'blush',
  'newsprint',
] as const;

export type DeckTheme = (typeof DECK_THEMES)[number];

/** What a player gets before choosing, and where an unknown name lands. */
export const DEFAULT_DECK_THEME: DeckTheme = 'press';

/** Shown in a settings list. Kept here so nothing else has to name a deck. */
export const DECK_THEME_LABELS: Record<DeckTheme, string> = {
  classic: 'Classic',
  press: 'Press',
  antique: 'Antique',
  millionaire: 'Millionaire',
  matrix: 'Matrix',
  neon: 'Neon',
  midnight: 'Midnight',
  casino: 'Casino Night',
  arctic: 'Arctic',
  delft: 'Delft',
  blush: 'Blush',
  newsprint: 'Newsprint',
};

/**
 * The stock a deck is printed on, and the two inks on it.
 *
 * Until now every deck was near-white paper with the package's own red and
 * black, and a theme was only its court palette and its back. That was fine
 * while the seven were seven printings of one deck. It stops being fine the
 * moment a deck is meant to be a screen rather than a card: a phosphor deck
 * on white paper is a green deck, not a terminal.
 *
 * So a theme now names all three. Most still name what they always had -
 * `PAPER` and the package's default inks - and say so by naming them rather
 * than by being absent, because a deck that is deliberately white and a deck
 * that forgot to say are different things and only one of them is a bug.
 *
 * `red` and `black` are what the suits are *printed in*, not what they
 * *count as*. Matrix draws its hearts in amber and its spades in green, and
 * every rule that asks still gets red and black back - see ink.ts, which is
 * where that distinction lives.
 */
export interface DeckStock {
  /** The card's face, behind the pips and the portraits. */
  paper: number;
  /** Hearts and diamonds. */
  red: number;
  /** Spades and clubs. */
  black: number;
  /**
   * What this deck's back is printed over.
   *
   * A suggestion rather than a setting. The back color belongs to the player
   * - in Nertz it is which seat you are - so nothing here overrides one they
   * chose. It is what a deck looks like when it is handed over whole, and a
   * terminal deck handed over on a teal back is not the deck.
   */
  back: number;
}

/** Near-white, which is what a card has been since there were cards. */
const PAPER = 0xfdfdfd;
const RED = 0xcf2436;
const BLACK = 0x1a1a1a;

export const DECK_STOCK: Record<DeckTheme, DeckStock> = {
  classic: { paper: PAPER, red: RED, black: BLACK, back: 0x2a5866 },
  press: { paper: PAPER, red: RED, black: BLACK, back: 0x2a5866 },
  // Rag paper that has been in a drawer since before anyone here was born.
  // The inks go with it: a press red oxidises toward brick and lamp black
  // toward the brown of the sizing it was ground into.
  antique: { paper: 0xf2e6cd, red: 0xa8543f, black: 0x3b2d21, back: 0x6b4a2a },
  millionaire: { paper: PAPER, red: RED, black: BLACK, back: 0x4f6b38 },
  // A terminal. Near-black glass and the two phosphors a monitor was
  // actually built with - P1 green and P3 amber - rather than two colours
  // picked to look like a terminal.
  //
  // Amber takes the red suits because warm reads as red whatever the hue
  // is, which matters: the whole of solitaire is alternating colours, and a
  // deck whose two inks are hard to sort is a deck you cannot play.
  matrix: { paper: 0x060b07, red: 0xffb000, black: 0x2bff6a, back: 0x0a1410 },
  // Tube light on a wet street at night. Magenta and cyan, which are the
  // two gases that actually glow those colours, and as far apart as two
  // inks on one card can get.
  neon: { paper: 0x14082a, red: 0xff2d95, black: 0x00e5ff, back: 0x1b0a2b },
  // Six palettes over the same courts. Each is checked for the one rule that
  // matters in solitaire - the two inks sort by lightness as well as by hue -
  // and every dark one sets `highlight` in COURT_PALETTES.
  //
  // Night play: deep navy, coral against silver-ivory.
  midnight: { paper: 0x12182b, red: 0xff7f6e, black: 0xe4e6dc, back: 0x1f3a5f },
  // Felt and chips: near-black, crimson hearts against gold clubs.
  casino: { paper: 0x0d0d10, red: 0xe8314a, black: 0xe6bd4a, back: 0x7a2e35 },
  // Cold and clean: ink blue, rose pink against icy cyan.
  arctic: { paper: 0x0e1a2e, red: 0xff6f9c, black: 0x9fe8ff, back: 0x2a5866 },
  // Glazed tile: white, brick red against cobalt.
  delft: { paper: 0xfbfcff, red: 0xd2543c, black: 0x183a8c, back: 0x1f3a5f },
  // Soft and warm: cream, dusty rose against plum.
  blush: { paper: 0xfbf0e4, red: 0xc9606f, black: 0x4a2145, back: 0x5e3a5c },
  // Flat and high contrast: grey-white, one signal red against charcoal.
  newsprint: { paper: 0xe9e9e6, red: 0xd42a1e, black: 0x1c1c1c, back: 0x0a1410 },
};

/**
 * Anything off the wire or out of storage comes through here.
 *
 * Both are places a stale or hand-edited value can arrive from, and a bad
 * theme name would otherwise become a 404 on a texture and a card with no art
 * on it at all.
 */
export function asDeckTheme(value: unknown): DeckTheme {
  return DECK_THEMES.includes(value as DeckTheme)
    ? (value as DeckTheme)
    : DEFAULT_DECK_THEME;
}

/**
 * Where a theme's art lives once the assets are served.
 *
 * Under `cardAssetBase()`, which is `/cards` unless a consumer has said
 * otherwise: copy `assets/cards` there when you build. Both games serve it
 * from exactly that - see the README.
 */
export function deckThemePath(theme: DeckTheme, file: string): string {
  return `${cardAssetBase()}/art/${theme}/${file}`;
}

/**
 * What the back's ink is printed over.
 *
 * The back art is line work on transparency, so the color under it is a
 * choice rather than part of the picture. In a four-player game that is how
 * you tell whose deck is whose; in a solitaire it is simply the color of
 * your deck.
 *
 * Muted rather than primary, which is what stops four decks on one table
 * looking like a toy, and dark enough to carry a light ink. Two things worth
 * knowing before changing them: desaturating pulls the red and the green
 * toward each other - this pair is the weakest of the sets tried under
 * deuteranopia - and these are close to a dark felt's own value, so a
 * face-down card leans on its shadow for its edge.
 *
 * The first four are the seat colors a four-handed game deals out. The last
 * two exist for a game where nobody else is at the table and the palette is
 * just a choice.
 */
export const BACK_COLORS = [
  0x2a5866, // petrol
  0x7a2e35, // oxblood
  0x4f6b38, // moss
  0x5e3a5c, // plum
  0x1f3a5f, // navy
  0x6b4a2a, // tobacco
  0x0a1410, // phosphor - the off state of a green screen
  0x1b0a2b, // ultraviolet
] as const;

export const DEFAULT_BACK_COLOR = BACK_COLORS[0];

/** The first four, which are the ones that have to be told apart at a table. */
export const SEAT_COLORS: readonly number[] = BACK_COLORS.slice(0, 4);

export function seatColor(seat: number): number {
  return SEAT_COLORS[seat] ?? SEAT_COLORS[SEAT_COLORS.length - 1];
}

export function asBackColor(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 16) : Number(value);
  return (BACK_COLORS as readonly number[]).includes(parsed) ? parsed : DEFAULT_BACK_COLOR;
}

/**
 * Six digits, always, because `'#2a5866'.slice(1)` has to round-trip through
 * asBackColor and a color whose top byte is small would otherwise be written
 * short.
 */
export function backColorHex(color: number): string {
  return color.toString(16).padStart(6, '0');
}

export function backColorCss(color: number): string {
  return `#${backColorHex(color)}`;
}
