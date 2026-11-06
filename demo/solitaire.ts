import './serve';
import {
  Card, SUITS, Zone, buildDeck, colorOf, createTable, defineScene, flipCard, rankValue, seeded, shuffle,
} from 'felt';
import { showCode } from './code';
import { button, expose, label, slot, standalone } from './kit';

// Klondike, on a Table. Everything below the layout is the game: what each
// zone accepts, what may be picked up from it, and what happens on a tap.
// Dragging, the drop outline, sending back a card that may not go there,
// carrying a run of cards, turning arrivals face up - that is the table's.

const W = 480;
const H = 720;
const COLUMN = W / 7;
const x = (col: number) => COLUMN * (col + 0.5);
const TOP = 72;
const TABLEAU = 190;

const value = (card: Card) => rankValue(card.rank);
const red = (card: Card) => colorOf(card.suit) === 'red';

export const scene = defineScene({
  name: 'solitaire',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    const say = (text: string) => { ctx.$('#score').textContent = text; };
    let moves = 0;

    // #region The zones, and the rules of Klondike
    const table = createTable(board);
    // The stock: nothing is dragged off it; a tap turns a card onto the waste.
    const stock = table.pile({ id: 'stock', x: x(0), y: TOP, faceUp: false, drag: false });
    const waste = table.pile({ id: 'waste', x: x(1), y: TOP, faceUp: true, accepts: () => false });
    // Foundations: one per suit, labelled with it. Only that suit, from its
    // ace up, one card at a time.
    const foundations = SUITS.map((suit, i) => table.pile({
      id: `foundation-${suit}`, x: x(3 + i), y: TOP, faceUp: true,
      accepts: ([card, ...more], pile) => !more.length && card.suit === suit
        && value(card) === (pile.topCard ? value(pile.topCard) : 0) + 1,
    }));
    // Columns: a king on an empty one, else one rank down in the other colour.
    // Any face-up run may be picked up, as long as it is itself in sequence.
    const columns = Array.from({ length: 7 }, (_, i) => table.pile({
      id: `column-${i}`, x: x(i), y: TABLEAU, fan: 'down', step: 24, maxSpread: H - TABLEAU - 70,
      drag: 'run',
      canTake: (cards) => cards.every((card, k) => card.faceUp
        && (k === 0 || (red(card) !== red(cards[k - 1]) && value(card) === value(cards[k - 1]) - 1))),
      accepts: (cards, pile) => (pile.topCard
        ? pile.topCard.faceUp && red(cards[0]) !== red(pile.topCard) && value(cards[0]) === value(pile.topCard) - 1
        : value(cards[0]) === 13),
    }));
    // #endregion

    for (const zone of [stock, waste, ...foundations, ...columns]) slot(board, zone.stack.x, zone.stack.y);
    foundations.forEach((f, i) => label(board, f.stack.x, TOP - 54, ['♠', '♥', '♦', '♣'][i], '#7fae86', 14));

    // #region Playing: drags, taps, and turning up what a move uncovers
    table.draggable();
    // A column whose last face-up card has gone turns up the one under it.
    table.on('move', ({ from, to, by }) => {
      if (by === 'deal') return;
      if (from?.id.startsWith('column') && from.top && !from.top.card.faceUp) {
        void flipCard(board, from.top, { faceUp: true, lift: 10 });
      }
      if (to !== stock) moves++;
      const home = foundations.reduce((n, f) => n + f.size, 0);
      say(home === 52 ? `Solved in ${moves} moves.` : `${moves} moves · ${home} of 52 home.`);
    });
    table.on('tap', ({ card, zone }) => {
      // The stock: turn one onto the waste - or, once it is empty, the waste back over.
      if (zone === stock) {
        if (stock.top) void table.move(stock.top, waste, { spins: 0, arc: 8, duration: 200 });
        else void table.move([...waste.cards].reverse(), stock, { spins: 0, arc: 0, duration: 200 });
        return;
      }
      // A card on top of anything: up to its foundation, if it may go.
      if (!card || !zone || card !== zone.top || !card.card.faceUp) return;
      const home = foundations.find((f) => f.accepts([card.card], zone));
      if (home) void table.move(card, home, { spins: 0, arc: 14 });
    });
    // #endregion

    // #region Dealing: seven columns, the last card of each turned up
    async function deal(seed: number): Promise<void> {
      table.clear();
      stock.put(shuffle(buildDeck(), seeded(seed)));
      const landed: Promise<void>[] = [];
      let n = 0;
      for (let row = 0; row < 7; row++) {
        for (let col = row; col < 7; col++) {
          landed.push(table.move(stock.top!, columns[col],
            { delay: n++ * 40, duration: 260, spins: 0, arc: 12, pop: false, by: 'deal' }));
        }
      }
      await Promise.all(landed);
      await Promise.all(columns.map((c: Zone) => flipCard(board, c.top!, { faceUp: true, lift: 10 })));
      moves = 0;
      say('Drag cards to build down in alternating colours, and up by suit on the foundations.');
    }
    // #endregion

    let seed = Date.now() % 100000;
    button(ctx, 'new', () => void table.run(() => deal(++seed)));
    void table.run(() => deal(seed));
    expose({ board, table, stock, waste, foundations, columns, deal: (s: number) => table.run(() => deal(s)) });
  },
});

standalone(scene);
