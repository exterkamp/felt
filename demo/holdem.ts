import './serve';
import {
  CARD_HEIGHT, Card, CardSprite, COURT_PALETTES, DEFAULT_DECK_THEME, Hand, Stack, cardRect,
  defineHand, defineStack, flipCard, handBounds, handPositions, layHand, loadCardArt,
  orderStack, renderCourts, riffleShuffle, shuffledDeck, stackPositions, throwCard,
} from 'felt';
import { expose, label, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'holdem',
  create(ctx) {
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
    const DECK_STACK = defineStack({ id: 'deck', x: DECK.x, y: DECK.y });
    const HOLE_CARDS = 2;
    const BURN = { x: 318, y: 180 };

    type Pile =
      | { kind: 'stack'; stack: Stack; cards: CardSprite[]; faceUp: boolean }
      | { kind: 'hand'; hand: Hand; cards: CardSprite[]; faceUp: boolean };

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    void loadCardArt(board, { themes: [DEFAULT_DECK_THEME] });
    void renderCourts(board, COURT_PALETTES[DEFAULT_DECK_THEME]);

    let deck: CardSprite[] = [];
    const piles = new Map<string, Pile>();
    let speed = 1;
    let dealing = false;
    /** Which pile each card went to, in order - what the smoke test reads. */
    const order: string[] = [];

    /** What an empty place looks like: a printed outline, turned if it is held. */
    function outline(places: readonly { x: number; y: number; angle?: number }[]): void {
      const rect = cardRect({ x: 0, y: 0 });
      for (const at of places) {
        board.graphic(rect.width, rect.height, (pen, w, h) => {
          pen.strokeStyle = 'rgba(207, 234, 208, 0.18)';
          pen.lineWidth = 1.5;
          pen.beginPath();
          pen.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 5);
          pen.stroke();
        }, { key: 'holdem-slot', x: at.x, y: at.y, angle: at.angle ?? 0, depth: 0 });
      }
    }

    function addPile(stack: Stack, faceUp: boolean, places: number): void {
      piles.set(stack.id, { kind: 'stack', stack, cards: [], faceUp });
      outline(stackPositions(stack, places));
    }

    function buildTable(): void {
      // A seat's two hole cards, held in a slight fan and turned to face that seat.
      for (const seat of SEATS) {
        const hand = defineHand({
          id: seat.id, x: seat.x, y: seat.y, step: 14, maxSpread: 14, radius: 190, facing: seat.facing,
        });
        piles.set(seat.id, { kind: 'hand', hand, cards: [], faceUp: seat.faceUp });
        outline(handPositions(hand, HOLE_CARDS));
        const box = handBounds(hand, HOLE_CARDS);
        const y = seat.facing === 0 ? box.y + box.height + 14 : box.y - 14;
        label(board, seat.x, y, seat.label);
      }
      // The board: five cards in a row, spaced so none covers another.
      addPile(defineStack({ id: 'board', x: 104, y: 280, fan: 'right', step: 68 }), true, 5);
      label(board, 104, 280 - CARD_HEIGHT / 2 - 11, 'Board');
      addPile(defineStack({ id: 'burn', ...BURN }), false, 1);
      label(board, BURN.x, BURN.y - CARD_HEIGHT / 2 - 11, 'Burn');
      label(board, DECK.x, DECK.y - CARD_HEIGHT / 2 - 11, 'Deck');
    }

    function newDeck(): void {
      for (const pile of piles.values()) {
        for (const card of pile.cards) card.destroy();
        pile.cards = [];
      }
      for (const card of deck) card.destroy();
      deck = shuffledDeck().map((card: Card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false });
        sprite.setPosition(DECK.x, DECK.y);
        sprite.depth = i;
        return sprite;
      });
    }

    /**
     * Off the top of the deck and onto a pile: thrown at where that pile's next
     * card goes, turned over on arrival if the pile is a face-up one, and handed
     * to the pile. Nothing here knows what game is being dealt.
     */
    async function deliver(to: string): Promise<void> {
      const pile = piles.get(to)!;
      const card = deck.pop();
      if (!card) return;
      order.push(to);
      const base = [...piles.keys()].indexOf(to) * 100;
      card.depth = 1000 + deck.length;
      const turnOver = () => pile.faceUp
        ? flipCard(board, card, { faceUp: true, duration: 200 * speed, lift: 12 })
        : Promise.resolve();

      if (pile.kind === 'hand') {
        // The hand opens to make room, leaving the card in flight to the throw.
        pile.cards.push(card);
        layHand(board, pile.cards, pile.hand, { base, duration: 140 * speed, except: [card] });
        await throwCard(board, card, { hand: pile.hand, count: pile.cards.length - 1 },
          { duration: 260 * speed, spins: 1, arc: 16 });
        layHand(board, pile.cards, pile.hand, { base, duration: 0 });
        await turnOver();
        return;
      }
      await throwCard(board, card, { stack: pile.stack, count: pile.cards.length },
        { duration: 260 * speed, spins: 1, arc: 16 });
      pile.cards.push(card);
      const at = stackPositions(pile.stack, pile.cards.length);
      pile.cards.forEach((sprite, i) => sprite.setPosition(at[i].x, at[i].y));
      orderStack(pile.cards, pile.stack, base);
      await turnOver();
    }

    function note(text: string): void {
      const el = document.getElementById('note');
      if (el) el.textContent = text;
    }

    const pause = (ms: number) => ctx.wait(ms * speed);

    /**
     * One hand, dealt the way a dealer deals it: one card at a time, twice round
     * the table - not two to each seat in turn - then a burn before each of the
     * flop, the turn and the river.
     */
    async function deal(): Promise<void> {
      if (dealing) return;
      dealing = true;
      const button = document.getElementById('deal') as HTMLButtonElement | null;
      if (button) button.disabled = true;
      newDeck();
      order.length = 0;
      note('Shuffling.');
      // The riffle that arrives at the order shuffledDeck already chose.
      await riffleShuffle(board, deck, DECK_STACK, { rounds: 2, duration: 170 * speed, stagger: 9 * speed });
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
      const shown = piles.get('board')!.cards.map((c) => `${c.card.rank}${c.card.suit[0]}`);
      const hole = piles.get('you')!.cards.map((c) => `${c.card.rank}${c.card.suit[0]}`);
      note(`You have ${hole.join(' ')}; the board is ${shown.join(' ')}. ${deck.length} cards left in the deck.`);
      if (button) button.disabled = false;
      dealing = false;
    }

    document.getElementById('deal')?.addEventListener('click', () => void deal());
    document.getElementById('speed')?.addEventListener('click', () => {
      speed = speed === 1 ? 0.45 : speed === 0.45 ? 2 : 1;
      const button = document.getElementById('speed');
      if (button) button.textContent = `Speed: ${speed === 1 ? 'normal' : speed < 1 ? 'fast' : 'slow'}`;
    });

    buildTable();
    newDeck();
    expose({
      board, piles, deck: () => deck, deal, handPositions, dealing: () => dealing, order,
      setSpeed: (value: number) => { speed = value; },
      riffle: (options: Record<string, unknown> = {}) => riffleShuffle(board, deck, DECK_STACK, options),
    });
  },
});

standalone(scene);
