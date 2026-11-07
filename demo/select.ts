import './serve';
import {
  Card, SUITS, Selection, Zone, buildDeck, colorOf, createTable, defineScene, flipCard, highlights, rankValue, seeded,
  selectable, shuffle,
} from 'felt';
import { showCode } from './code';
import { button, expose, label, slot, standalone } from './kit';

// Tap to select, tap to move. A short patience game - aces to sevens, six
// columns, four foundations - played without dragging at all, if you like:
// tap a card (or the run under it), and the places it may go light up; tap
// one and it goes. The same zone rules a drag asks decide every tap.

const W = 480;
const H = 720;
const COLUMN = W / 6;
const x = (col: number) => COLUMN * (col + 0.5);
const TOP = 80;
const TABLEAU = 230;

const value = (card: Card) => rankValue(card.rank);
const red = (card: Card) => colorOf(card.suit) === 'red';
const SMALL = buildDeck().filter((c) => value(c) <= 7);

export const scene = defineScene({
  name: 'select',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    const say = (text: string) => { ctx.$('#score').textContent = text; };
    let moves = 0;

    // #region The zones and their rules: all a tap or a drag asks
    const table = createTable(board, { cards: SMALL });
    const deck = table.pile({ id: 'deck', x: W / 2, y: H + 90, faceUp: false, drag: false, accepts: () => false });
    const foundations = SUITS.map((suit, i) => table.pile({
      id: `foundation-${suit}`, x: x(1 + i), y: TOP, faceUp: true, drag: false,
      accepts: ([card, ...more], pile) => !more.length && card.suit === suit
        && value(card) === (pile.topCard ? value(pile.topCard) : 0) + 1,
    }));
    const columns = Array.from({ length: 6 }, (_, i) => table.pile({
      id: `column-${i}`, x: x(i), y: TABLEAU, fan: 'down', step: 26, maxSpread: H - TABLEAU - 80,
      drag: 'run',
      canTake: (cards) => cards.every((card, k) => card.faceUp
        && (k === 0 || (red(card) !== red(cards[k - 1]) && value(card) === value(cards[k - 1]) - 1))),
      // One down in the other colour; anything at all on an empty column.
      accepts: (cards, pile) => !pile.topCard
        || (pile.topCard.faceUp && red(cards[0]) !== red(pile.topCard) && value(cards[0]) === value(pile.topCard) - 1),
    }));
    // #endregion

    for (const zone of [...foundations, ...columns]) slot(board, zone.stack.x, zone.stack.y);
    foundations.forEach((f, i) => label(board, f.stack.x, TOP - 56, ['♠', '♥', '♦', '♣'][i], '#7fae86', 14));

    // #region Selecting, tapping to move, and lighting up where it may go
    // Dragging still works; a refused drop flashes like a refused tap.
    table.draggable();
    let dragTargets = true;
    let selection = undefined as unknown as Selection;
    const select = () => {
      selection?.dispose();
      selection = selectable(table, { dragTargets, lift: 10 });
      selection.on('change', ({ items }) => {
        if (!items.length) return;
        const n = selection.targets().length;
        say(`${items.map((c) => c.card.rank + suitMark(c.card)).join(' ')} - ${n ? `${n} place${n > 1 ? 's' : ''} it may go: tap one` : 'nowhere to go'}.`);
      });
      selection.on('refuse', ({ to }) => say(`It doesn't go on ${to.id.replace('-', ' ')}.`));
    };
    select();
    // #endregion

    // #region A hint: one legal move, from the zones' own rules
    const hint = () => {
      const move = selection.hint({
        for: 3500,
        // A whole column onto an empty one changes nothing.
        filter: ({ cards, from, to }) => !(to.empty && from?.cards[0] === cards[0]),
        score: ({ cards, from, to }) => {
          const below = from?.cards[from.cards.indexOf(cards[0]) - 1];
          return (foundations.includes(to as never) ? 10 : 0)
            + (below && !below.card.faceUp ? 5 : 0)
            + (from && from.cards[0] === cards[0] ? 2 : 0)
            // Off one card it already sits on legally, onto another like it: a shuffle.
            - (below?.card.faceUp && from!.accepts(cards.map((c) => c.card)) ? 6 : 0);
        },
      });
      say(move ? `Try the ${move.cards[0].card.rank}${suitMark(move.cards[0].card)} onto ${move.to.id.replace('-', ' ')}.`
        : 'No moves left.');
    };
    button(ctx, 'hint', hint);
    // #endregion

    const suitMark = (c: Card) => ({ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' } as Record<string, string>)[c.suit];

    table.on('move', ({ from, to, by }) => {
      if (by === 'deal') return;
      if (from?.id.startsWith('column') && from.top && !from.top.card.faceUp) {
        void flipCard(board, from.top, { faceUp: true, lift: 10 });
      }
      moves++;
      const home = foundations.reduce((n, f) => n + f.size, 0);
      say(home === SMALL.length ? `All home in ${moves} moves.` : `${moves} moves · ${home} of ${SMALL.length} home.`);
    });

    async function deal(seed: number): Promise<void> {
      selection.clear();
      table.clear();
      deck.put(shuffle([...SMALL], seeded(seed)));
      const landed: Promise<void>[] = [];
      const sizes = [4, 5, 5, 5, 5, 4];
      let n = 0;
      for (let row = 0; row < 5; row++) {
        columns.forEach((col: Zone, i) => {
          if (row >= sizes[i]) return;
          landed.push(table.move(deck.top!, col, { delay: n++ * 35, duration: 280, spins: 0, arc: 12, pop: false, by: 'deal' }));
        });
      }
      await Promise.all(landed);
      // The bottom card of each column stays face down; the rest turn up.
      await Promise.all(columns.flatMap((c) => c.cards.slice(1).map((card) => flipCard(board, card, { faceUp: true, lift: 8 }))));
      moves = 0;
      say('Tap a card to pick it up, then tap where it should go.');
    }

    let seed = 7;
    button(ctx, 'new', () => void table.run(() => deal(++seed)));
    button(ctx, 'view', (el) => {
      board.setFov(board.is3d ? 0 : 45);
      el.textContent = `View: ${board.is3d ? '3D' : '2D'}`;
    });
    button(ctx, 'drag', (el) => {
      dragTargets = !dragTargets;
      select();
      el.textContent = `Drag targets: ${dragTargets ? 'on' : 'off'}`;
    });
    void table.run(() => deal(seed));
    expose({
      board, table, deck, foundations, columns, highlights: highlights(board),
      selection: () => selection, hint, deal: (s: number) => table.run(() => deal(s)),
    });
  },
});

standalone(scene);
