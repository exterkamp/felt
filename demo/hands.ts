import './serve';
import {
  CARD_HEIGHT, Card, CardSprite, COURT_PALETTES, DEFAULT_DECK_THEME, Hand, buildDeck, defineHand, flipCard, handPositions, layHand, loadCardArt, renderCourts, shuffle, throwCard,
} from 'felt';
import { expose, label, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'hands',
  create(ctx) {
    // Two hands of the same cards, held two ways.
    //
    // Mine at the bottom, face up and fanned wide; one across the table, face down
    // and turned right round - the same primitive, facing 180. A card thrown into
    // my hand turns over in the air once it lands, which a flat engine could only
    // fake: here it is a card rolling half a turn about its own length.
    const WIDTH = 480;
    const HEIGHT = 640;
    const DECK = { x: 60, y: 300 };

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    void loadCardArt(board, { themes: [DEFAULT_DECK_THEME] });
    void renderCourts(board, COURT_PALETTES[DEFAULT_DECK_THEME]);

    let deck: CardSprite[] = [];
    let mine!: Hand;
    let theirs!: Hand;
    let held: CardSprite[] = [];
    let opposite: CardSprite[] = [];
    /** Cards a throw is still moving: the re-fan leaves every one of them alone. */
    const flying = new Set<CardSprite>();
    let radius = 260;
    let spread = 70;

    /** The two hands, rebuilt whenever the curve or the spread changes. */
    function shape(): void {
      mine = defineHand({ id: 'mine', x: 240, y: 540, step: 9, maxSpread: spread, radius });
      // The same hand, turned right round. Nothing else changes.
      theirs = defineHand({ id: 'theirs', x: 240, y: 110, step: 9, maxSpread: spread, radius, facing: 180 });
    }

    function newDeck(): void {
      for (const card of [...deck, ...held, ...opposite]) card.destroy();
      held = [];
      opposite = [];
      deck = shuffle(buildDeck()).map((card: Card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false });
        sprite.setPosition(DECK.x, DECK.y);
        sprite.depth = i;
        return sprite;
      });
      report();
    }

    /**
     * Both hands re-fanned around their middles, every card turned the short way
     * - the hand across the table holds cards either side of 180 degrees.
     */
    function layOut(): void {
      // Every card still in the air, not only the newest: throws overlap when the
      // button is pressed faster than a card flies, and a re-fan that grabbed one
      // already on its way would fight the throw for it.
      const except = [...flying];
      layHand(board, held, mine, { base: 2000, except });
      layHand(board, opposite, theirs, { base: 1000, except });
      report();
    }

    async function throwOne(): Promise<void> {
      const card = deck.pop();
      if (!card) return report('The deck is out.');
      const toMine = held.length <= opposite.length;
      const hand = toMine ? mine : theirs;
      const cards = toMine ? held : opposite;
      card.depth = 5000;
      // The hand is about to hold one more, so every card in it moves, and the
      // thrown one aims at where it will sit in the hand that includes it.
      cards.push(card);
      flying.add(card);
      layOut();
      await throwCard(board, card, { hand, count: cards.length - 1 }, { spins: 1, arc: 22 });
      flying.delete(card);
      layOut();
      if (toMine) await flipCard(board, card, { faceUp: true, lift: 14, duration: 260 });
    }

    function takeOne(): void {
      const from = held.length >= opposite.length ? held : opposite;
      const card = from.pop();
      if (!card) return;
      card.setFaceUp(false);
      board.tweens.add({ targets: card, x: DECK.x, y: DECK.y, angle: 0, duration: 220, ease: 'Cubic.easeOut' });
      card.depth = deck.length;
      deck.push(card);
      layOut();
    }

    function report(what = ''): void {
      const note = document.getElementById('note');
      if (!note) return;
      const places = handPositions(mine, held.length);
      const turn = places.length > 1 ? Math.round((places[1].angle - places[0].angle) * 10) / 10 : 0;
      const width = places.length > 1 ? Math.round(places[places.length - 1].angle - places[0].angle) : 0;
      note.textContent = `${what} ${held.length} in your hand, ${opposite.length} across the table. `
        + `Grip ${radius} units below, spread ${spread}° — open ${width}° at ${turn}° a card.`;
    }

    document.getElementById('throw')?.addEventListener('click', () => void throwOne());
    document.getElementById('take')?.addEventListener('click', () => takeOne());
    document.getElementById('reset')?.addEventListener('click', () => newDeck());
    document.getElementById('curve')?.addEventListener('click', () => {
      radius = radius === 260 ? 140 : radius === 140 ? 900 : 260;
      shape();
      layOut();
    });
    document.getElementById('spread')?.addEventListener('click', () => {
      spread = spread === 70 ? 110 : spread === 110 ? 40 : 70;
      shape();
      layOut();
    });

    shape();
    newDeck();
    label(board, DECK.x, DECK.y - CARD_HEIGHT / 2 - 12, 'Deck');
    label(board, 240, 470, 'Your hand');
    label(board, 240, 150, 'Across the table');
    expose({ board, held: () => held, opposite: () => opposite, deck: () => deck, throwOne, takeOne });
  },
});

standalone(scene);
