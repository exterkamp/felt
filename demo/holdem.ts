import './serve';
import {
  CARD_HEIGHT, Zone, cardRect, createTable, handBounds, handPositions, riffleShuffle, shuffledDeck, stackPositions,
} from '@exterkamp/felt';
import { showCode } from './code';
import { button, expose, label, slot, standalone } from './kit';
import { defineScene } from '@exterkamp/felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'holdem',
  create(ctx) {
    showCode(ctx);
    // Dealing a hand of hold'em, as a program.
    //
    // No rules and nothing evaluated - no hands ranked, nobody bets. What it is,
    // is the dealing: the order a real dealer goes in, expressed with the two
    // primitives this engine has. What lies on the table is a Stack; what a
    // player holds is a Hand; every card gets to either by being thrown at it,
    // and the face-up ones turn over in the air when they land.
    const WIDTH = 480;
    const HEIGHT = 640;

    const SEATS = [
      { id: 'you', label: 'You', x: 240, y: 556, facing: 0, faceUp: true },
      { id: 'west', label: 'Seat 2', x: 66, y: 420, facing: 90, faceUp: false },
      { id: 'north', label: 'Seat 3', x: 240, y: 96, facing: 180, faceUp: false },
      { id: 'east', label: 'Seat 4', x: 402, y: 420, facing: 270, faceUp: false },
    ];
    const DECK = { x: 398, y: 180 };
    const HOLE_CARDS = 2;
    const BURN = { x: 318, y: 180 };
    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    let speed = 1;
    /** Which zone each card went to, in order - what the smoke test reads. */
    const order: string[] = [];

    /** What an empty place looks like: a printed outline, turned if it is held. */
    function outline(places: readonly { x: number; y: number; angle?: number }[]): void {
      const rect = cardRect({ x: 0, y: 0 });
      for (const at of places) {
        slot(board, at.x, at.y, 0, rect.width, rect.height, 'rgba(207, 234, 208, 0.18)', at.angle ?? 0);
      }
    }

    // #region The table: a hand per seat, the board, the burn and the deck
    const table = createTable(board);
    const deck = table.pile({ id: 'deck', ...DECK, faceUp: false });
    const piles = new Map<string, Zone>();
    for (const seat of SEATS) {
      // Two hole cards, held in a slight fan and turned to face that seat;
      // only yours land face up.
      const hand = table.hand({
        id: seat.id, x: seat.x, y: seat.y, step: 14, maxSpread: 14, radius: 190, facing: seat.facing, faceUp: seat.faceUp,
      });
      piles.set(seat.id, hand);
      outline(handPositions(hand.hand, HOLE_CARDS));
      const box = handBounds(hand.hand, HOLE_CARDS);
      label(board, seat.x, seat.facing === 0 ? box.y + box.height + 14 : box.y - 14, seat.label);
    }
    // The board: five cards in a row, spaced so none covers another.
    const community = table.pile({ id: 'board', x: 104, y: 280, fan: 'right', step: 68, faceUp: true });
    const burn = table.pile({ id: 'burn', ...BURN, faceUp: false });
    piles.set('board', community).set('burn', burn);
    outline(stackPositions(community.stack, 5));
    outline(stackPositions(burn.stack, 1));
    // #endregion
    label(board, 104, 280 - CARD_HEIGHT / 2 - 11, 'Board');
    label(board, BURN.x, BURN.y - CARD_HEIGHT / 2 - 11, 'Burn');
    label(board, DECK.x, DECK.y - CARD_HEIGHT / 2 - 11, 'Deck');

    const note = (text: string) => { ctx.$('#note').textContent = text; };
    const pause = (ms: number) => ctx.wait(ms * speed);

    // #region One card, off the top of the deck to a zone
    // Thrown at its place, turned over on arrival if the zone is a face-up
    // one, and handed over - the table does all of that. Nothing here knows
    // what game is being dealt.
    function deliver(to: string): Promise<void> {
      order.push(to);
      return table.move(deck.top!, piles.get(to)!, { duration: 260 * speed, spins: 1, arc: 16 });
    }
    // #endregion

    // #region The deal, in a dealer's order
    /**
     * One card at a time, twice round the table - not two to each seat in
     * turn - then a burn before each of the flop, the turn and the river.
     */
    async function deal(): Promise<void> {
      const dealButton = ctx.$<HTMLButtonElement>('#deal');
      dealButton.disabled = true;
      table.clear();
      deck.put(shuffledDeck());
      order.length = 0;
      note('Shuffling.');
      // The riffle that arrives at the order shuffledDeck already chose.
      await riffleShuffle(board, deck.cards, deck.stack, { rounds: 2, duration: 170 * speed, stagger: 9 * speed });
      note('Hole cards: one at a time, twice round the table.');
      for (let round = 0; round < 2; round++) {
        for (const seat of SEATS) await deliver(seat.id);
      }
      await pause(350);
      note('Burn, and the flop.');
      await deliver('burn');
      for (let i = 0; i < 3; i++) await deliver('board');
      await pause(350);
      note('Burn, and the turn.');
      await deliver('burn');
      await deliver('board');
      await pause(350);
      note('Burn, and the river.');
      await deliver('burn');
      await deliver('board');
      const name = (zone: Zone) => zone.cards.map((c) => `${c.card.rank}${c.card.suit[0]}`).join(' ');
      note(`You have ${name(piles.get('you')!)}; the board is ${name(community)}. ${deck.size} cards left in the deck.`);
      dealButton.disabled = false;
    }
    // #endregion

    button(ctx, 'deal', () => void table.run(deal));
    button(ctx, 'speed', (el) => {
      speed = speed === 1 ? 0.45 : speed === 0.45 ? 2 : 1;
      el.textContent = `Speed: ${speed === 1 ? 'normal' : speed < 1 ? 'fast' : 'slow'}`;
    });
    deck.put(shuffledDeck());
    expose({
      board, table, piles, deck: () => deck.cards, deal: () => table.run(deal), handPositions,
      dealing: () => table.busy, order,
      setSpeed: (value: number) => { speed = value; },
      riffle: (options: Record<string, unknown> = {}) => riffleShuffle(board, deck.cards, deck.stack, options),
    });
  },
});

standalone(scene);
