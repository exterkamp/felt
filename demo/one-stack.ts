import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, CardSprite, FanDirection, buildDeck, defineStack, flipCard, loadCardArt,
  orderStack, seeded, shuffle, stackPositions, throwCard, topCardIndex,
} from 'felt';
import { expose, slot, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'one-stack',
  create(ctx) {
    // One stack. The whole of the page is below, and it is meant to stay short
    // enough to read in one go: a board, a pile, and four buttons.
    //
    // It also says, under the board, whether each thing it depends on came up -
    // WebGL2, the card art, the cards themselves - so that a page that shows
    // nothing says why rather than just being empty.

    const status = document.getElementById('status')!;
    const say = (text: string, bad = false) => {
      status.textContent = text;
      status.classList.toggle('bad', bad);
    };
    ctx.listen(window, 'error', (event) => say(`error: ${(event as ErrorEvent).message}`, true));
    ctx.listen(window, 'unhandledrejection',
      (event) => say(`error: ${String((event as PromiseRejectionEvent).reason)}`, true));

    const WIDTH = 320;
    const HEIGHT = 420;
    const DECK_AT = { x: WIDTH - 44, y: HEIGHT - 60 };

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    const FANS: FanDirection[] = ['down', 'right', 'none'];
    const MARGIN = 24;
    /** Where the pile sits for each fan, so it always has the board to grow into. */
    const pileFor = (fan: FanDirection) => {
      if (fan === 'right') {
        const x = MARGIN + CARD_WIDTH / 2;
        return defineStack({ id: 'pile', x, y: 150, fan, step: 28, maxSpread: WIDTH - 2 * x });
      }
      const y = MARGIN + CARD_HEIGHT / 2;
      return defineStack({ id: 'pile', x: WIDTH / 2, y, fan, step: 28, maxSpread: HEIGHT - 2 * y });
    };
    let fan: FanDirection = 'down';
    let stack = pileFor(fan);
    const outline = slot(board, stack.x, stack.y);

    // The deck the cards come from, face down in the corner.
    const deck = shuffle(buildDeck(), seeded(7));
    const pile: CardSprite[] = [];
    let artLoaded = false;

    function report(): void {
      const r = board.renderer;
      say(`WebGL2 ${r.lost ? 'LOST' : 'ok'} · art ${artLoaded ? 'loaded' : 'loading…'} · `
        + `${pile.length} in the pile, ${deck.length} in the deck · ${r.drawCalls} draw call`);
    }

    /** Puts every card where the stack says, in the order it says. */
    function lay(): void {
      stackPositions(stack, pile.length).forEach((at, i) => {
        pile[i].setPosition(at.x, at.y);
        pile[i].angle = at.angle;
      });
      orderStack(pile, stack);
      report();
    }

    async function add(): Promise<void> {
      const card = deck.pop();
      if (!card) return;
      const sprite = new CardSprite(board, { ...card, faceUp: true });
      sprite.setPosition(DECK_AT.x, DECK_AT.y);
      sprite.depth = 1000;
      pile.push(sprite);
      await throwCard(board, sprite, { stack, count: pile.length - 1 }, { arc: 20 });
      lay();
    }

    function take(): void {
      const at = topCardIndex(stack, pile.length);
      if (at === undefined) return;
      const [sprite] = pile.splice(at, 1);
      deck.push(sprite.card);
      sprite.destroy();
      lay();
    }

    async function flipTop(): Promise<void> {
      const at = topCardIndex(stack, pile.length);
      if (at !== undefined) await flipCard(board, pile[at]);
      report();
    }

    function nextFan(): void {
      fan = FANS[(FANS.indexOf(fan) + 1) % FANS.length];
      stack = pileFor(fan);
      outline.setPosition(stack.x, stack.y);
      document.getElementById('fan')!.textContent = `Fan: ${fan}`;
      lay();
    }

    document.getElementById('add')!.addEventListener('click', () => void add());
    document.getElementById('take')!.addEventListener('click', take);
    document.getElementById('flip')!.addEventListener('click', () => void flipTop());
    document.getElementById('fan')!.addEventListener('click', nextFan);

    // Start with five, dealt one after another so you can watch them arrive.
    void loadCardArt(board).then(() => { artLoaded = true; report(); });
    (async () => {
      for (let i = 0; i < 5; i++) await add();
    })();
    report();
    board.on('render', () => { if (status.classList.contains('bad')) return; report(); });

    expose({ board, pile: () => pile, add, take, flipTop, nextFan });
  },
});

standalone(scene);
