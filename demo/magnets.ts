import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, SUITS, SUIT_COLORS, Suit, buildDeck, createTable, defineScene, flipCard, seeded, shuffle,
} from 'felt';
import { showCode } from './code';
import { button, expose, label, standalone } from './kit';

// Flicking onto stacks. Four piles, one per suit, each accepting only its
// own suit - and that one rule is everything: a drop is allowed by it, the
// outline shows only over a pile it allows, and a flicked card is pulled in
// only by the piles it allows, so a heart slides straight past the spades.

const W = 480;
const H = 720;
const DECK = { x: W / 2, y: H - 90 };
const ROW_Y = 200;
const REACH = 84;
const SYMBOL: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

export const scene = defineScene({
  name: 'magnets',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    const gap = W / SUITS.length;

    // #region Four stacks that accept only their own suit
    const table = createTable(board);
    const deck = table.pile({ id: 'deck', ...DECK, faceUp: false });
    const stacks = SUITS.map((suit, i) => table.pile({
      id: suit, x: gap * (i + 0.5), y: ROW_Y, faceUp: true,
      drag: false,                                   // stacked is stacked
      accepts: ([card]) => card.suit === suit,       // the game's whole rule
    }));
    // #endregion

    // The places: an outline with its suit in it, and a glow for when the
    // card in the hand belongs there.
    const glows = stacks.map((stack) => {
      const suit = stack.id as Suit;
      const { x, y } = stack.stack;
      board.graphic(CARD_WIDTH + 10, CARD_HEIGHT + 10, (pen, w, h) => {
        pen.strokeStyle = 'rgba(207, 234, 208, 0.35)';
        pen.lineWidth = 2;
        pen.setLineDash([5, 4]);
        pen.beginPath();
        pen.roundRect(5, 5, w - 10, h - 10, 5);
        pen.stroke();
        pen.fillStyle = SUIT_COLORS[suit] === 'red' ? 'rgba(255, 140, 130, 0.35)' : 'rgba(207, 234, 208, 0.3)';
        pen.font = '30px system-ui, sans-serif';
        pen.textAlign = 'center';
        pen.textBaseline = 'middle';
        pen.fillText(SYMBOL[suit], w / 2, h / 2 + 1);
      }, { key: `magnet-${suit}`, x, y, depth: -10 });
      label(board, x, y + CARD_HEIGHT / 2 + 18, suit.toUpperCase());
      const glow = board.graphic(REACH * 2, REACH * 2, (pen, w, h) => {
        const light = pen.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        light.addColorStop(0, 'rgba(255, 209, 102, 0.32)');
        light.addColorStop(0.7, 'rgba(255, 209, 102, 0.12)');
        light.addColorStop(1, 'rgba(255, 209, 102, 0)');
        pen.fillStyle = light;
        pen.fillRect(0, 0, w, h);
      }, { key: 'magnet-glow', x, y, depth: -11 });
      glow.alpha = 0;
      return glow;
    });
    label(board, DECK.x, DECK.y + CARD_HEIGHT / 2 + 14, 'DECK');

    let flicks = 0;
    const stacked = () => stacks.reduce((n, s) => n + s.size, 0);
    const say = (text: string) => { ctx.$('#score').textContent = text; };

    // #region Dragging and flicking, by the stacks' rule
    // A card let go off every stack carries on at the speed it was let go -
    // flicked, or set down - and the stacks that accept it draw it in.
    table.draggable({ flick: { reach: REACH } });
    table.on('take', ({ cards: [card], from }) => {
      if (from === deck) void flipCard(board, card, { faceUp: true, lift: 0, duration: 240 });
      stacks.forEach((stack, i) => { glows[i].alpha = stack.accepts([card.card], from) ? 1 : 0; });
    });
    table.on('drop', ({ velocity }) => {
      for (const glow of glows) glow.alpha = 0;
      if (Math.hypot(velocity.x, velocity.y) >= 120) flicks++;
    });
    table.on('move', ({ cards: [card], to }) => {
      if (to === deck) return;
      if (!to) say(`Loose on the felt - the ${card.card.suit} are over there. ${stacked()} of 52 stacked.`);
      else say(stacked() === 52 ? `All 52 stacked, in ${flicks} flicks.`
        : `Onto the ${to.id}. ${stacked()} of 52 stacked, ${flicks} flicks.`);
    });
    // #endregion

    // The same board, with and without its lens.
    button(ctx, 'view', (el) => {
      board.setFov(board.is3d ? 0 : 45);
      el.textContent = `View: ${board.is3d ? '3D' : '2D'}`;
    });
    button(ctx, 'gather', () => {
      const out = table.cards.filter((card) => table.zoneOf(card) !== deck);
      void table.move(out, deck, { spins: 0, arc: 10, pop: false });
      flicks = 0;
      say('Flick each card at its suit.');
    });

    deck.put(shuffle(buildDeck(), seeded(Date.now() % 100000)));
    expose({
      board, table, deck: () => deck.cards, loose: () => table.cards.filter((c) => !table.zoneOf(c)),
      stacks: () => stacks.map((s) => ({ suit: s.id, x: s.stack.x, y: s.stack.y, count: s.size })),
    });
  },
});

standalone(scene);
