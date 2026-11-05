import './serve';
import {
  BODY_FONT, COURT_PALETTES, Card, CardSprite, CourtPalette, DECK_STOCK, DECK_THEMES,
  DECK_THEME_LABELS, DISPLAY_FONT, DeckTheme, FACE_STYLES, FaceStyle, Rank, SUITS, Sprite, Suit,
  cardFaceMetrics, colorCss, createBoard, loadCardArt, renderCourts,
} from 'felt';
import { expose } from './kit';

// Three layouts, side by side, at a size you can drag.
//
// Four ranks, because four is what it takes to show the argument: an ace, a
// seven (the arrangement nobody draws correctly from memory), a ten (the most
// crowded), and a court.
const WIDTH = 480;
const HEIGHT = 660;
const RANKS: Rank[] = ['A', '7', '10', 'K'];
const HEAD_Y = 30;

const board = createBoard({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
let cards: CardSprite[] = [];
let labels: Sprite[] = [];
let width = 92;
let suit: Suit = 'spades';
let theme: DeckTheme = 'press';

void loadCardArt(board, { themes: [...DECK_THEMES] });

/** A deck's court palette, printed on the deck's own stock. */
const courtStart = (t: DeckTheme): CourtPalette => ({
  ...COURT_PALETTES[t],
  paper: COURT_PALETTES[t].paper ?? colorCss(DECK_STOCK[t].paper),
  highlight: COURT_PALETTES[t].highlight ?? '#fdfdfd',
});

const label = (face: FaceStyle) =>
  face === 'jumbo' ? 'Jumbo index' : face[0].toUpperCase() + face.slice(1);

/**
 * Both cuts, because this page draws all three faces at once and the cut is
 * part of a court's key: the mobile column wants one figure and the other two
 * want the double-ended card.
 */
function paint(): void {
  void renderCourts(board, courtStart(theme), { cut: ['half', 'full'] });
  lay();
}

function say(x: number, y: number, text: string, color: string, size: number): void {
  labels.push(board.text(text, { font: size > 10 ? DISPLAY_FONT : BODY_FONT, size, color }, { x, y }));
}

function lay(): void {
  for (const card of cards) card.destroy();
  for (const l of labels) l.destroy();
  cards = [];
  labels = [];
  const height = width / (5 / 7);
  const column = WIDTH / FACE_STYLES.length;
  const rowGap = Math.max(6, width * 0.09);
  const top = HEAD_Y + 26 + height / 2;
  FACE_STYLES.forEach((face, col) => {
    const x = column * (col + 0.5);
    say(x, HEAD_Y, label(face), '#fdfdfd', 11);
    const peek = cardFaceMetrics(width, face).peek;
    say(x, HEAD_Y + 13, `peek ${peek.toFixed(1)}`, '#7fae86', 9);
    RANKS.forEach((rank, row) => {
      const card: Card = { id: `${face}-${rank}`, rank, suit, faceUp: true };
      const sprite = new CardSprite(board, card, {
        width, face, theme, backColor: DECK_STOCK[theme].back, courtPalette: courtStart(theme),
      });
      sprite.setPosition(x, top + row * (height + rowGap));
      cards.push(sprite);
    });
  });
  const note = document.getElementById('note');
  if (note) note.textContent = `${DECK_THEME_LABELS[theme]}, ${suit}, ${width} units across.`;
}

document.getElementById('size')?.addEventListener('input', (event) => {
  width = Number((event.target as HTMLInputElement).value);
  lay();
});
document.getElementById('suit')?.addEventListener('click', () => {
  suit = SUITS[(SUITS.indexOf(suit) + 1) % SUITS.length];
  lay();
});
document.getElementById('deck')?.addEventListener('click', () => {
  theme = DECK_THEMES[(DECK_THEMES.indexOf(theme) + 1) % DECK_THEMES.length];
  paint();
});

paint();
expose({
  board, cards: () => cards, CardSprite, renderCourts, courtStart, COURT_PALETTES, DECK_STOCK,
});
