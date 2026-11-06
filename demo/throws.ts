import './serve';
import { CARD_HEIGHT, CardSprite, buildDeck, createTable, defineScene, flightDuration, seeded, shuffle, throwCard } from 'felt';
import { showCode } from './code';
import { button, expose, label, slot, standalone } from './kit';

// Throwing cards at things.
//
// Two kinds of target, which is the whole point: a bare point on the felt,
// and a pile. Thrown at a pile, the card lands where that pile's next card
// goes - on top of what is there, at the angle the pile draws at - so the
// pile takes it over the instant it arrives. And every throw is in the air:
// it rises off the felt on the way, grows a little towards the camera, and
// its shadow falls further behind it.

const WIDTH = 480;
const HEIGHT = 640;
const DECK_AT = { x: WIDTH - 50, y: HEIGHT - 70 };

export const scene = defineScene({
  name: 'throws',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    let spins = 1;
    let arc = 28;

    // #region The table: a deck, and four piles that own their cards
    const table = createTable(board);
    const deck = table.pile({ id: 'deck', ...DECK_AT });
    deck.put(shuffle(buildDeck(), seeded(Date.now() % 99991)).map((card) => ({ ...card, faceUp: true })));
    const piles = [
      table.pile({ id: 'fan', x: 120, y: 180, fan: 'down', step: 26, maxSpread: 150 }),
      table.pile({ id: 'squared', x: 300, y: 180 }),
      // What a pile that was thrown at looks like: a fan of near-misses.
      table.pile({ id: 'messy', x: 400, y: 420, messy: 0.35 }),
      table.pile({ id: 'row', x: 110, y: 420, fan: 'right', step: 24, maxSpread: 200 }),
    ];
    // #endregion
    for (const pile of piles) {
      slot(board, pile.stack.x, pile.stack.y);
      label(board, pile.stack.x, pile.stack.y - CARD_HEIGHT / 2 - 10, pile.id);
    }
    /** Cards thrown at the felt rather than at a pile: in no zone. */
    const loose = () => table.cards.filter((card) => !table.zoneOf(card));

    // #region Throwing at a pile, and at a point
    async function throwAtPile(pile: (typeof piles)[number]): Promise<void> {
      const card = deck.top;
      if (!card) return report('The deck is out - gather them up.');
      // Leaves the deck now, so a second throw aims at the place after it.
      await table.move(card, pile, { spins, arc });
      report(`Thrown onto ${pile.id}, now ${pile.size} cards.`);
    }
    async function throwAtPoint(at: { x: number; y: number }): Promise<void> {
      const card = deck.top;
      if (!card) return report('The deck is out - gather them up.');
      table.release(card);   // out of the deck, onto no pile
      card.depth = 50_000 + loose().length;
      // A resting angle of its own, so a scatter of cards looks thrown, not filed.
      await throwCard(board, card, at, { spins, arc, settleAngle: Math.round(Math.random() * 36 - 18) });
      report(`Thrown at a point: ${Math.round(at.x)}, ${Math.round(at.y)}.`);
    }
    // A tap on a pile is a throw at the pile; anywhere else, at that spot.
    table.on('tap', ({ zone, pointer }) => {
      if (zone && zone !== deck) void throwAtPile(zone as (typeof piles)[number]);
      else if (!zone) void throwAtPoint(pointer);
    });
    // #endregion

    // #region Dealing five, and gathering up
    async function dealHand(): Promise<void> {
      if (deck.empty) return report('The deck is out - gather them up.');
      await table.deal(deck, [piles[0]], { each: 5, stagger: 110, spins, arc });
      report(`Dealt five onto ${piles[0].id}, one every 110ms.`);
    }
    async function gather(): Promise<void> {
      const coming = [...loose(), ...piles.flatMap((p) => p.cards)];
      await table.move(coming, deck, { spins, arc: arc / 2, pop: false });
      report('Gathered up.');
    }
    // #endregion

    function report(what = ''): void {
      const far = Math.round(flightDuration(400));
      const near = Math.round(flightDuration(80));
      ctx.$('#note').textContent = `${what} ${deck.size} left in the deck. `
        + `A throw takes ${near}ms near and ${far}ms across the board, spins `
        + `${spins === 0 ? 'not at all' : `${spins} turn${spins > 1 ? 's' : ''}`}`
        + `${arc ? `, and rises ${arc} units off the felt` : ', and stays on the felt'}.`;
    }
    button(ctx, 'deal', () => void table.run(dealHand));
    button(ctx, 'gather', () => void table.run(gather));
    button(ctx, 'spins', (el) => { spins = (spins + 1) % 4; el.textContent = `Spins: ${spins}`; report(); });
    button(ctx, 'arc', (el) => { arc = arc ? 0 : 28; el.textContent = arc ? 'Arc: on' : 'Arc: off'; report(); });
    report();
    expose({
      board, table, piles: () => piles, deck: () => deck.cards, loose: () => loose() as CardSprite[],
      throwAtPoint, throwAtPile, dealHand, gather,
    });
  },
});

standalone(scene);
