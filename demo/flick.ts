import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, CardSprite, animatorOf, buildDeck, defineScene, flickCard, flipCard,
  loadCardArt, seeded, shuffle, throwCard,
} from 'felt';
import { expose, label, standalone } from './kit';

// Flicking. The board picks a dragged card up and swings it (see PickUp);
// the pointer says how fast it was moving when it let go; `flickCard` does
// the rest - slides it, hops it, spins it, bounces it off the walls - and
// says when it has stopped.

const W = 480;
const H = 720;
const RING = { x: W / 2, y: 190, r: 74 };
const DECK = { x: W / 2, y: H - 90 };
const SURFACES = { felt: 1500, ice: 380 } as const;

export const scene = defineScene({
  name: 'flick',
  create(ctx) {
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    void loadCardArt(board);
    const animator = animatorOf(board);

    // The ring: three circles, one picture.
    board.graphic(RING.r * 2 + 8, RING.r * 2 + 8, (pen, w, h) => {
      for (const [r, a] of [[1, 0.28], [0.62, 0.36], [0.26, 0.5]] as const) {
        pen.beginPath();
        pen.arc(w / 2, h / 2, RING.r * r, 0, Math.PI * 2);
        pen.strokeStyle = `rgba(255, 209, 102, ${a})`;
        pen.lineWidth = 2;
        pen.stroke();
      }
      pen.beginPath();
      pen.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
      pen.fillStyle = 'rgba(255, 209, 102, 0.6)';
      pen.fill();
    }, { key: 'flick-ring', x: RING.x, y: RING.y, depth: -10 });
    label(board, DECK.x, DECK.y + CARD_HEIGHT / 2 + 14, 'DECK');

    let surface: keyof typeof SURFACES = 'felt';
    let walls = true;
    let top = 100;
    let flicks = 0;
    let best = 0;
    let total = 0;
    const scoreLine = ctx.$('#score');

    let deck: CardSprite[] = [];
    const table = new Set<CardSprite>();

    function newDeck(): void {
      for (const card of [...deck, ...table]) card.destroy();
      table.clear();
      deck = shuffle(buildDeck(), seeded(Date.now() % 100000)).map((card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false });
        sprite.setPosition(DECK.x, DECK.y);
        sprite.depth = i;
        sprite.draggable = true;
        return sprite;
      });
    }

    /** Points for where a card came to rest: 100 dead centre, nothing outside. */
    function points(card: CardSprite): number {
      const d = Math.hypot(card.x - RING.x, card.y - RING.y);
      return d > RING.r ? 0 : Math.round(100 * (1 - d / RING.r) ** 1.5);
    }

    const offTable = (card: CardSprite) =>
      card.x < -CARD_WIDTH || card.x > W + CARD_WIDTH || card.y < -CARD_HEIGHT || card.y > H + CARD_HEIGHT;

    let grip = { x: 0, y: 0 };
    /** What the last flick was, for anyone checking the physics. */
    let lastFlick: unknown;
    let held: CardSprite | undefined;

    board.on('dragstart', (pointer, node) => {
      const card = node as CardSprite;
      const fromDeck = deck.includes(card);
      // Only the top of the deck, or a card already out on the table.
      if (fromDeck && card !== deck[deck.length - 1]) { pointer.refuse?.(); return; }
      // Caught: whatever was sliding it stops where it is.
      animator.stop(card, 'move');
      grip = { x: pointer.x - card.x, y: pointer.y - card.y };
      held = card;
      card.depth = ++top + 1000;
      if (fromDeck) {
        deck.pop();
        table.add(card);
        void flipCard(board, card, { faceUp: true, lift: 0, duration: 240 });
      }
    });

    board.on('drag', (pointer) => {
      if (!held) return;
      held.setPosition(pointer.x - grip.x, pointer.y - grip.y);
    });

    board.on('dragend', (pointer) => {
      const card = held;
      held = undefined;
      if (!card) return;
      card.depth = ++top;
      const v = pointer.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed < 120) return;   // set down, not flicked
      flicks++;
      lastFlick = { velocity: { ...v }, grip: { ...grip }, from: { x: card.x, y: card.y, angle: card.angle } };
      void flickCard(board, card, v, {
        grip,
        friction: SURFACES[surface],
        half: { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 },
        bounds: walls ? { left: 0, top: 0, right: W, bottom: H } : undefined,
        onRest: () => {
          if (offTable(card)) {
            table.delete(card);
            card.destroy();
            say(`Off the table. ${flicks} flicked.`);
            return;
          }
          const got = points(card);
          total += got;
          best = Math.max(best, got);
          say(`${got ? `${got} points` : 'Missed'} - flicked at ${Math.round(speed)} units a second.`
            + ` Best ${best}, total ${total} from ${flicks}.`);
        },
      });
    });

    function say(text: string): void {
      scoreLine.textContent = text;
    }

    ctx.listen(ctx.$('#surface'), 'click', (event) => {
      surface = surface === 'felt' ? 'ice' : 'felt';
      (event.target as HTMLElement).textContent = `Surface: ${surface}`;
    });
    ctx.listen(ctx.$('#walls'), 'click', (event) => {
      walls = !walls;
      (event.target as HTMLElement).textContent = `Walls: ${walls ? 'on' : 'off'}`;
    });
    // The same board, with and without its lens: flicks follow it, flat or
    // in depth.
    ctx.listen(ctx.$('#view'), 'click', (event) => {
      board.setFov(board.is3d ? 0 : 45);
      (event.target as HTMLElement).textContent = `View: ${board.is3d ? '3D' : '2D'}`;
    });
    ctx.listen(ctx.$('#gather'), 'click', () => {
      // Back to the deck, face down, in a row of quick throws.
      [...table].forEach((card, i) => {
        table.delete(card);
        deck.push(card);
        card.setFaceUp(false);
        card.depth = deck.length;
        void throwCard(board, card, DECK, { delay: i * 25, spins: 0, arc: 10, pop: false });
      });
      flicks = 0;
      total = 0;
      best = 0;
      say('Flick a card at the ring.');
    });

    newDeck();
    expose({ board, deck: () => deck, table: () => [...table], ring: RING, lastFlick: () => lastFlick });
  },
});

standalone(scene);
