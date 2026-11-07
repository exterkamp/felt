import './serve';
import {
  BODY_FONT, COURT_PALETTES, Card, CardSprite, CourtPalette, DECK_STOCK, DECK_THEMES,
  DECK_THEME_LABELS, DISPLAY_FONT, DeckTheme, FACE_STYLES, FaceStyle, Rank, SUITS, Sprite, Suit,
  cardFaceMetrics, colorCss, loadCardArt, renderCourts,
} from '@exterkamp/felt';
import { showCode } from './code';
import { button, expose, label as paintLabel, standalone } from './kit';
import { defineScene } from '@exterkamp/felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'faces',
  create(ctx) {
    showCode(ctx);
    // Three layouts, side by side, at a size you can drag.
    //
    // Four ranks, because four is what it takes to show the argument: an ace, a
    // seven (the arrangement nobody draws correctly from memory), a ten (the most
    // crowded), and a court.
    const WIDTH = 480;
    const HEIGHT = 660;
    const RANKS: Rank[] = ['A', '7', '10', 'K'];
    const HEAD_Y = 30;

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    let cards: CardSprite[] = [];
    let labels: Sprite[] = [];
    let width = 92;
    let suit: Suit = 'spades';
    let theme: DeckTheme = 'press';

    // #region Art for every deck
    void loadCardArt(board, { themes: [...DECK_THEMES] });
    // #endregion

    /** A deck's court palette, printed on the deck's own stock. */
    const courtStart = (t: DeckTheme): CourtPalette => ({
      ...COURT_PALETTES[t],
      paper: COURT_PALETTES[t].paper ?? colorCss(DECK_STOCK[t].paper),
      highlight: COURT_PALETTES[t].highlight ?? '#fdfdfd',
    });

    const label = (face: FaceStyle) =>
      face === 'jumbo' ? 'Jumbo index' : face[0].toUpperCase() + face.slice(1);

    /**
     * The courts are the sheets' to ask for: each face asks for its own cut,
     * at the raster its size needs.
     */
    function paint(): void {
      lay();
    }

    function say(x: number, y: number, text: string, color: string, size: number): void {
      labels.push(paintLabel(board, x, y, text, color, size, size > 10 ? DISPLAY_FONT : BODY_FONT));
    }

    // #region A card in each face style
    /** Which layout each card is drawn in, for restyling it. */
    const faceOf = new Map<CardSprite, FaceStyle>();
    function lay(): void {
      faceOf.clear();
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
          faceOf.set(sprite, face);
          cards.push(sprite);
        });
      });
      const note = document.getElementById('note');
      if (note) note.textContent = `${DECK_THEME_LABELS[theme]}, ${suit}, ${width} units across.`;
    }
    // #endregion

    document.getElementById('size')?.addEventListener('input', (event) => {
      width = Number((event.target as HTMLInputElement).value);
      lay();
    });
    button(ctx, 'suit', () => {
      suit = SUITS[(SUITS.indexOf(suit) + 1) % SUITS.length];
      lay();
    });
    // Another deck is the same cards restyled, not new ones: each goes on
    // showing the deck it had until the new one is painted.
    button(ctx, 'deck', () => {
      theme = DECK_THEMES[(DECK_THEMES.indexOf(theme) + 1) % DECK_THEMES.length];
      for (const card of cards) {
        card.restyle({ width, face: faceOf.get(card), theme, backColor: DECK_STOCK[theme].back, courtPalette: courtStart(theme) });
      }
      ctx.$('#note').textContent = `${DECK_THEME_LABELS[theme]}, ${suit}, ${width} units across.`;
    });

    paint();
    expose({
      board, cards: () => cards, CardSprite, renderCourts, courtStart, COURT_PALETTES, DECK_STOCK,
    });
  },
});

standalone(scene);
