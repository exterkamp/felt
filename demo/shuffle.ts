import './serve';
import {
  CARD_WIDTH, Card, CardSprite, RIFFLE_HAND_DEPTH, Stack, defineStack, orderStack, riffleShuffle, shuffledDeck,
} from 'felt';
import { showCode } from './code';
import { button, expose, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'shuffle',
  create(ctx) {
    showCode(ctx);
    // A riffle, on its own and slow enough to watch.
    //
    // The cards are the cards: nothing is swapped for a mesh while they bend, so
    // what is measured below is the sprites themselves.
    const WIDTH = 480;
    const HEIGHT = 420;
    const DECK: Stack = defineStack({ id: 'deck', x: 240, y: 210 });

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });

    let cards: CardSprite[] = [];
    let busy = false;
    const bench = {
      seen: { bent: 0, spread: 0, bow: 0, over: 0 },
      peak: undefined as HTMLCanvasElement | undefined,
      late: undefined as HTMLCanvasElement | undefined,
      /** The stills as PNGs, encoded only when somebody asks. */
      stills: () => ({ peak: bench.peak?.toDataURL() ?? '', late: bench.late?.toDataURL() ?? '' }),
    };

    // #region A squared deck
    function lay(): void {
      for (const card of cards) card.destroy();
      cards = shuffledDeck().map((card: Card) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false }, { width: CARD_WIDTH });
        sprite.setPosition(DECK.x, DECK.y);
        return sprite;
      });
      orderStack(cards, DECK);
      say(`${cards.length} cards, squared.`);
    }
    // #endregion

    async function go(rounds: number, slow = 1): Promise<void> {
      if (busy) return;
      busy = true;
      const before = cards.map((c) => c.card.id).join();
      const started = performance.now();
      let bent = 0;
      let spread = 0;
      let bow = 0;
      let over = 0;
      let shot = 0;
      // A still is a copy of the canvas, and an encode is not cheap: taking a PNG
      // every frame is what made the first version of this take thirteen
      // seconds. Copies, a few a second, and the encode once at the end.
      const peak = document.createElement('canvas');
      const still = () => {
        const now = performance.now();
        if (now - shot < 150) return undefined;
        shot = now;
        return board.snapshotCanvas(peak);
      };
      bench.peak = undefined;
      bench.late = undefined;
      // Watched every frame from inside the board's own loop, so nothing between
      // two frames is missed and a still is the frame that was actually drawn.
      const watch = () => {
        bent = Math.max(bent, cards.filter((c) => c.bow !== 0).length);
        const xs = cards.map((c) => c.x);
        const apart = Math.max(...xs) - Math.min(...xs);
        const deep = Math.max(...cards.map((c) => Math.abs(c.bow)));
        spread = Math.max(spread, apart);
        bow = Math.max(bow, deep);
        // A card that has landed must never draw over one still in a hand.
        const landed = cards.filter((c) => Math.abs(c.x - DECK.x) < 8 && c.depth < RIFFLE_HAND_DEPTH);
        const inHand = cards.filter((c) => Math.abs(c.x - DECK.x) > 30);
        if (landed.length && inHand.length) {
          if (Math.max(...landed.map((c) => c.depth)) > Math.min(...inHand.map((c) => c.depth))) over += 1;
          if (!bench.late && landed.length > cards.length * 0.55) bench.late = board.snapshotCanvas();
        }
        if (apart >= spread && deep >= bow * 0.9 && deep > 0) bench.peak = still() ?? bench.peak;
      };
      // #region Riffling, watched from the board's own loop
      board.on('update', watch);
      await riffleShuffle(board, cards, DECK, { rounds, duration: 240 * slow, stagger: 11 * slow });
      board.off('update', watch);
      // #endregion
      bench.seen = { bent, spread: Math.round(spread), bow: Number(bow.toFixed(2)), over };
      const kept = cards.map((c) => c.card.id).join() === before;
      say(`${rounds} riffle${rounds > 1 ? 's' : ''} in ${Math.round(performance.now() - started)}ms — `
        + `${bench.seen.bent} cards bent, parted ${bench.seen.spread} units, bow ${bench.seen.bow}`
        + `${bench.seen.over ? `, PILE OVER THE PACKETS ${bench.seen.over}x` : ''}. `
        + `The deck is ${kept ? 'in the order it was already in' : 'REORDERED, which is a bug'}.`);
      busy = false;
    }

    function say(text: string): void {
      const note = document.getElementById('note');
      if (note) note.textContent = text;
    }

    button(ctx, 'riffle', () => void go(1));
    button(ctx, 'slow', () => void go(1, 3));
    button(ctx, 'twice', () => void go(2));
    button(ctx, 'reset', () => lay());

    lay();
    expose({ board, cards: () => cards, go, bench, busy: () => busy });
  },
});

standalone(scene);
