import './serve';
import {
  Card, CardSprite, DECK_THEMES, DeckTheme, DISPLAY_FONT, Rank, Sprite, Suit,
  buildDeck, cardFaceMetrics, loadCardArt,
} from 'felt';
import { showCode } from './code';
import { button, expose, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'sizes',
  create(ctx) {
    showCode(ctx);
    // The same card at seven sizes.
    //
    // A card is painted at whatever width it is asked for rather than painted
    // once and scaled, which is the whole reason cardFaceMetrics takes a width:
    // the index is rasterised for the size it is shown at.
    const WIDTH = 480;
    const HEIGHT = 560;
    const WIDTHS = [24, 37, 51, 60, 84, 120, 168];
    const SAMPLES: { rank: Rank; suit: Suit }[] = [
      { rank: '7', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
      { rank: '10', suit: 'diamonds' },
    ];

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    let theme: DeckTheme = 'press';
    let faceUp = true;
    let sample = 0;
    let cards: CardSprite[] = [];
    let labels: Sprite[] = [];

    void loadCardArt(board, { themes: DECK_THEMES });

    function lay(): void {
      for (const card of cards) card.destroy();
      for (const label of labels) label.destroy();
      cards = [];
      labels = [];
      const { rank, suit } = SAMPLES[sample];
      const face = buildDeck().find((c) => c.rank === rank && c.suit === suit)!;

      // Packed into as many rows as it takes; the widths decide the rows.
      const gap = 12;
      const margin = 14;
      const rows: number[][] = [[]];
      let used = 0;
      for (const width of WIDTHS) {
        const extra = used ? gap + width : width;
        if (used + extra > WIDTH - 2 * margin && rows[rows.length - 1].length) {
          rows.push([]);
          used = width;
        } else {
          used += extra;
        }
        rows[rows.length - 1].push(width);
      }
      const heights = rows.map((row) => cardFaceMetrics(Math.max(...row)).height);
      const spare = HEIGHT - heights.reduce((sum, h) => sum + h + 26, 0);
      let top = Math.max(20, spare / 2);
      for (const [index, row] of rows.entries()) {
        const total = row.reduce((sum, w) => sum + w, 0) + gap * (row.length - 1);
        const baseline = top + heights[index];
        let x = (WIDTH - total) / 2;
        // #region Each card painted at its own width
        for (const width of row) {
          const metrics = cardFaceMetrics(width);
          const card: Card = { ...face, faceUp };
          const sprite = new CardSprite(board, card, { width, theme });
          sprite.setPosition(x + width / 2, baseline - metrics.height / 2);
          cards.push(sprite);
          labels.push(board.text(String(width), { font: DISPLAY_FONT, size: 10, color: '#7fae86' },
            { x: x + width / 2, y: baseline + 8, originY: 0 }));
          x += width + gap;
        }
        // #endregion
        top = baseline + 26;
      }
      report();
    }

    // #region The face's metrics at a width
    function report(): void {
      const note = document.getElementById('note');
      if (!note) return;
      const { rank, suit } = SAMPLES[sample];
      const small = cardFaceMetrics(WIDTHS[0]);
      const large = cardFaceMetrics(WIDTHS[WIDTHS.length - 1]);
      note.textContent =
        `${rank} of ${suit}, ${theme} deck, ${faceUp ? 'face up' : 'face down'}. `
        + `The index is ${small.index.fontSize.toFixed(1)} units at ${WIDTHS[0]} wide and `
        + `${large.index.fontSize.toFixed(1)} at ${WIDTHS[WIDTHS.length - 1]}, `
        + `and a fanned pile of each would need to show ${small.peek.toFixed(1)} and `
        + `${large.peek.toFixed(1)} units to keep it readable.`;
    }
    // #endregion

    button(ctx, 'flip', () => {
      faceUp = !faceUp;
      for (const card of cards) card.setFaceUp(faceUp);
      report();
    });
    button(ctx, 'theme', () => {
      theme = DECK_THEMES[(DECK_THEMES.indexOf(theme) + 1) % DECK_THEMES.length];
      // A theme is a palette, so switching is a render rather than a
      // download - and the sheets ask for their courts, at their own size.
      lay();
    });
    button(ctx, 'ranks', () => {
      sample = (sample + 1) % SAMPLES.length;
      lay();
    });

    lay();
    expose({ board, cards: () => cards });
  },
});

standalone(scene);
