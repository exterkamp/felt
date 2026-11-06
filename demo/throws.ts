import './serve';
import {
  CardSprite, COURT_PALETTES, DEFAULT_DECK_THEME, Card, Stack, buildDeck, cardRect, dealCards, defineStack, flightDuration, loadCardArt, orderStack, renderCourts, seeded, shuffle,
  stackPositions, stackUnder, throwCard, CARD_HEIGHT,
} from 'felt';
import { showCode } from './code';
import { expose, label, slot, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'throws',
  create(ctx) {
    showCode(ctx);
    // Throwing cards at things.
    //
    // Two kinds of target, which is the whole point: a bare point on the felt,
    // and a stack. Throwing at a stack lands the card where that stack's next
    // card goes - on top of what is there, at the angle the pile draws at - so
    // the pile takes the card over the instant it arrives. And every throw is in
    // the air: it rises off the felt on the way, grows a little towards the
    // camera, and its shadow falls further behind it.
    const WIDTH = 480;
    const HEIGHT = 640;
    const DECK_AT = { x: WIDTH - 50, y: HEIGHT - 70 };

    interface Pile { stack: Stack; cards: CardSprite[] }

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    void loadCardArt(board, { themes: [DEFAULT_DECK_THEME] });
    void renderCourts(board, COURT_PALETTES[DEFAULT_DECK_THEME]);

    let deck: CardSprite[] = [];
    let loose: CardSprite[] = [];
    let spins = 1;
    let thrown = 0;
    let arc = 28;

    const piles: Pile[] = [
      defineStack({ id: 'fan', x: 120, y: 180, fan: 'down', step: 26, maxSpread: 150 }),
      defineStack({ id: 'squared', x: 300, y: 180 }),
      // What a pile that was thrown at looks like: a fan of near-misses.
      defineStack({ id: 'messy', x: 400, y: 420, messy: 0.35 }),
      defineStack({ id: 'row', x: 110, y: 420, fan: 'right', step: 24, maxSpread: 200 }),
    ].map((stack) => ({ stack, cards: [] }));

    for (const { stack } of piles) {
      slot(board, stack.x, stack.y);
      label(board, stack.x, stack.y - CARD_HEIGHT / 2 - 10, stack.id);
    }

    function fillDeck(): void {
      for (const card of deck) card.destroy();
      deck = shuffle(buildDeck(), seeded(Date.now() % 99991)).map((card: Card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: true });
        sprite.setPosition(DECK_AT.x, DECK_AT.y);
        sprite.depth = 1 + i;
        return sprite;
      });
    }

    function pileUnder(at: { x: number; y: number }): Pile | undefined {
      const stack = stackUnder(cardRect(at), piles.map((p) => ({ stack: p.stack, count: p.cards.length })));
      return stack ? piles.find((p) => p.stack.id === stack.id) : undefined;
    }

    function take(): CardSprite | undefined {
      const card = deck.pop();
      if (!card) report('The deck is out - gather them up.');
      return card;
    }

    // #region Throwing at a point
    async function throwAtPoint(at: { x: number; y: number }): Promise<void> {
      const card = take();
      if (!card) return;
      loose.push(card);
      card.depth = 500 + thrown++;
      // A resting angle of its own, so a scatter of cards looks thrown, not filed.
      await throwCard(board, card, at, {
        spins, arc, settleAngle: Math.round(Math.random() * 36 - 18),
      });
      report(`Thrown at a point: ${Math.round(at.x)}, ${Math.round(at.y)}.`);
    }
    // #endregion

    // #region Throwing at a stack
    async function throwAtPile(pile: Pile): Promise<void> {
      const card = take();
      if (!card) return;
      card.depth = 500 + thrown++;
      await throwCard(board, card, { stack: pile.stack, count: pile.cards.length }, { spins, arc });
      pile.cards.push(card);
      layOut(pile);
      report(`Thrown onto ${pile.stack.id}, now ${pile.cards.length} cards.`);
    }
    // #endregion

    // #region Dealing five
    async function dealHand(): Promise<void> {
      const pile = piles[0];
      const hand = deck.splice(-5).reverse();
      if (!hand.length) return report('The deck is out - gather them up.');
      hand.forEach((card, i) => { card.depth = 500 + thrown + i; });
      thrown += hand.length;
      await dealCards(board, hand, { stack: pile.stack, count: pile.cards.length }, { spins, arc, stagger: 110 });
      pile.cards.push(...hand);
      layOut(pile);
      report(`Dealt five onto ${pile.stack.id}, one every 110ms.`);
    }
    // #endregion

    /** Everything back to the deck, thrown the other way. */
    async function gather(): Promise<void> {
      const coming = [...loose, ...piles.flatMap((p) => p.cards)];
      loose = [];
      for (const p of piles) p.cards = [];
      if (!coming.length) return;
      await Promise.all(coming.map((card, i) =>
        throwCard(board, card, DECK_AT, { spins, arc: arc / 2, delay: i * 25, pop: false })));
      deck.push(...coming);
      deck.forEach((card, i) => { card.depth = 1 + i; });
      report('Gathered up.');
    }

    function layOut(pile: Pile): void {
      const at = stackPositions(pile.stack, pile.cards.length);
      // The angle as well as the place: a messy pile that squared itself up every
      // time it was re-laid would undo the throw that made it messy.
      pile.cards.forEach((card, i) => {
        card.setPosition(at[i].x, at[i].y);
        card.angle = at[i].angle;
      });
      orderStack(pile.cards, pile.stack, piles.indexOf(pile) * 100);
    }

    function report(what = ''): void {
      const note = document.getElementById('note');
      if (!note) return;
      const far = Math.round(flightDuration(400));
      const near = Math.round(flightDuration(80));
      note.textContent = `${what} ${deck.length} left in the deck. `
        + `A throw takes ${near}ms near and ${far}ms across the board, spins `
        + `${spins === 0 ? 'not at all' : `${spins} turn${spins > 1 ? 's' : ''}`}`
        + `${arc ? `, and rises ${arc} units off the felt` : ', and stays on the felt'}.`;
    }

    // #region A tap: a pile, or the felt?
    // A tap on the felt is a throw at that spot; a tap on a pile is a throw at
    // the pile. Which one it was is stackUnder's answer.
    board.on('pointerdown', (pointer) => {
      const pile = pileUnder(pointer);
      if (pile) void throwAtPile(pile);
      else void throwAtPoint(pointer);
    });
    // #endregion
    document.getElementById('deal')?.addEventListener('click', () => void dealHand());
    document.getElementById('gather')?.addEventListener('click', () => void gather());
    document.getElementById('spins')?.addEventListener('click', () => {
      spins = (spins + 1) % 4;
      const button = document.getElementById('spins');
      if (button) button.textContent = `Spins: ${spins}`;
      report();
    });
    document.getElementById('arc')?.addEventListener('click', () => {
      arc = arc ? 0 : 28;
      const button = document.getElementById('arc');
      if (button) button.textContent = arc ? 'Arc: on' : 'Arc: off';
      report();
    });

    fillDeck();
    report();
    expose({ board, piles: () => piles, deck: () => deck, loose: () => loose, throwAtPoint, throwAtPile, dealHand, gather });
  },
});

standalone(scene);
