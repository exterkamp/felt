import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, CardSprite, Magnet, SUITS, SUIT_COLORS, Suit, animatorOf, buildDeck, defineScene,
  flickCard, flipCard, loadCardArt, seeded, shuffle, throwCard,
} from 'felt';
import { showCode } from './code';
import { expose, label, standalone } from './kit';

// Flicking onto stacks. The same flick as the Flicking demo, given magnets:
// the places this card may validly land. Here that is the stack of its own
// suit, so only that one pulls - a heart slides straight past the spades.
// Which stacks a card may go to is the game's rule; how it is drawn in is
// the flick's (see `magnets` in FlickOptions).

const W = 480;
const H = 720;
const DECK = { x: W / 2, y: H - 90 };
const ROW_Y = 200;
const REACH = 84;
const SYMBOL: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

interface Stack {
  suit: Suit;
  x: number;
  y: number;
  cards: CardSprite[];
  lit: { alpha: number };
}

export const scene = defineScene({
  name: 'magnets',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    void loadCardArt(board);
    const animator = animatorOf(board);

    const gap = W / SUITS.length;
    const stacks: Stack[] = SUITS.map((suit, i) => {
      const x = gap * (i + 0.5);
      const red = SUIT_COLORS[suit] === 'red';
      // The place: an outline with its suit in it, and a glow for when the
      // card in the hand belongs there.
      board.graphic(CARD_WIDTH + 10, CARD_HEIGHT + 10, (pen, w, h) => {
        pen.strokeStyle = 'rgba(207, 234, 208, 0.35)';
        pen.lineWidth = 2;
        pen.setLineDash([5, 4]);
        pen.beginPath();
        pen.roundRect(5, 5, w - 10, h - 10, 5);
        pen.stroke();
        pen.fillStyle = red ? 'rgba(255, 140, 130, 0.35)' : 'rgba(207, 234, 208, 0.3)';
        pen.font = '30px system-ui, sans-serif';
        pen.textAlign = 'center';
        pen.textBaseline = 'middle';
        pen.fillText(SYMBOL[suit], w / 2, h / 2 + 1);
      }, { key: `magnet-${suit}`, x, y: ROW_Y, depth: -10 });
      const lit = board.graphic(REACH * 2, REACH * 2, (pen, w, h) => {
        const glow = pen.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        glow.addColorStop(0, 'rgba(255, 209, 102, 0.32)');
        glow.addColorStop(0.7, 'rgba(255, 209, 102, 0.12)');
        glow.addColorStop(1, 'rgba(255, 209, 102, 0)');
        pen.fillStyle = glow;
        pen.fillRect(0, 0, w, h);
      }, { key: 'magnet-glow', x, y: ROW_Y, depth: -11 });
      lit.alpha = 0;
      label(board, x, ROW_Y + CARD_HEIGHT / 2 + 18, suit.toUpperCase());
      return { suit, x, y: ROW_Y, cards: [], lit };
    });
    label(board, DECK.x, DECK.y + CARD_HEIGHT / 2 + 14, 'DECK');

    let top = 100;
    let flicks = 0;
    let deck: CardSprite[] = [];
    const loose = new Set<CardSprite>();
    const scoreLine = ctx.$('#score');

    function newDeck(): void {
      deck = shuffle(buildDeck(), seeded(Date.now() % 100000)).map((card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false });
        sprite.setPosition(DECK.x, DECK.y);
        sprite.depth = i;
        sprite.draggable = true;
        return sprite;
      });
    }

    const suitOf = (card: CardSprite) => card.card.suit as Suit;
    // #region Where a card may land: one magnet per valid stack
    /** Where this card may go: the game's rule. One stack per suit. */
    const validFor = (card: CardSprite) => stacks.filter((stack) => stack.suit === suitOf(card));
    /** A stack's pull, at the top of its pile: each card sits a hair higher. */
    const magnetOf = (stack: Stack): Magnet => ({
      x: stack.x, y: stack.y - stack.cards.length * 0.35, angle: 0, reach: REACH,
    });
    // #endregion

    const stacked = () => stacks.reduce((n, stack) => n + stack.cards.length, 0);
    function say(text: string): void {
      scoreLine.textContent = text;
    }

    let grip = { x: 0, y: 0 };
    let held: CardSprite | undefined;
    let lastFlick: unknown;

    // #region Picking a card up
    board.on('dragstart', (pointer, node) => {
      const card = node as CardSprite;
      const fromDeck = deck.includes(card);
      if (fromDeck && card !== deck[deck.length - 1]) { pointer.refuse?.(); return; }
      if (!fromDeck && !loose.has(card)) { pointer.refuse?.(); return; }   // already stacked
      animator.stop(card, 'move');
      grip = { x: pointer.x - card.x, y: pointer.y - card.y };
      held = card;
      card.depth = ++top + 1000;
      if (fromDeck) {
        deck.pop();
        loose.add(card);
        void flipCard(board, card, { faceUp: true, lift: 0, duration: 240 });
      }
      for (const stack of validFor(card)) stack.lit.alpha = 1;
    });
    // #endregion

    board.on('drag', (pointer) => {
      held?.setPosition(pointer.x - grip.x, pointer.y - grip.y);
    });

    // #region Flicking it, with magnets
    board.on('dragend', (pointer) => {
      const card = held;
      held = undefined;
      if (!card) return;
      for (const stack of stacks) stack.lit.alpha = 0;
      card.depth = ++top;
      const v = pointer.velocity;
      const speed = Math.hypot(v.x, v.y);
      // Slow is set down, not flung - but set down near its stack, it is
      // still drawn in.
      const velocity = speed < 120 ? { x: 0, y: 0 } : v;
      if (speed >= 120) flicks++;
      const targets = validFor(card);
      lastFlick = { velocity: { ...velocity }, suit: suitOf(card), from: { x: card.x, y: card.y } };
      void flickCard(board, card, velocity, {
        grip,
        half: { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 },
        bounds: { left: 0, top: 0, right: W, bottom: H },
        magnets: targets.map(magnetOf),
        onRest: (path) => {
          const stack = path.caught === undefined ? undefined : targets[path.caught];
          if (!stack) {
            if (speed >= 120) say(`Loose on the felt - the ${suitOf(card)} are over there. ${stacked()} of 52 stacked.`);
            return;
          }
          loose.delete(card);
          stack.cards.push(card);
          card.draggable = false;
          // A wall may have flipped it over on the way: a stack is face up.
          if (!card.card.faceUp) void flipCard(board, card, { faceUp: true, lift: 0, duration: 200 });
          say(stacked() === 52
            ? `All 52 stacked, in ${flicks} flicks.`
            : `Onto the ${stack.suit}. ${stacked()} of 52 stacked, ${flicks} flicks.`);
        },
      });
    // #endregion
    });

    // The same board, with and without its lens.
    ctx.listen(ctx.$('#view'), 'click', (event) => {
      board.setFov(board.is3d ? 0 : 45);
      (event.target as HTMLElement).textContent = `View: ${board.is3d ? '3D' : '2D'}`;
    });
    ctx.listen(ctx.$('#gather'), 'click', () => {
      const out = [...loose, ...stacks.flatMap((stack) => stack.cards)];
      loose.clear();
      for (const stack of stacks) stack.cards = [];
      out.forEach((card, i) => {
        animator.stop(card, 'move');
        deck.push(card);
        card.setFaceUp(false);
        card.draggable = true;
        card.depth = deck.length;
        void throwCard(board, card, DECK, { delay: i * 20, spins: 0, arc: 10, pop: false });
      });
      flicks = 0;
      say('Flick each card at its suit.');
    });

    newDeck();
    expose({
      board, deck: () => deck, loose: () => [...loose], lastFlick: () => lastFlick,
      stacks: () => stacks.map((s) => ({ suit: s.suit, x: s.x, y: s.y, count: s.cards.length })),
    });
  },
});

standalone(scene);
