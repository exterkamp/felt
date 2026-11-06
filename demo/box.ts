import './serve';
import {
  Card, CardSprite, DECK_STOCK, DECK_THEMES, DECK_THEME_LABELS, DeckTheme, TuckBox, defineStack, loadCardArt, orderStack, riffleShuffle, shuffledDeck, stackPositions,
} from 'felt';
import { expose, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'box',
  create(ctx) {
    // A deck, in the box it came in.
    //
    // The box is the one solid object on a felt board - a mesh with a depth
    // buffer, between the cards in the same draw order - and the demo is built
    // around the thing that makes it worth being solid: it turns. The sequence
    // at the bottom - turn to face, open, lift out, shuffle - is the whole
    // feature. Everything above it is scenery.
    const WIDTH = 480;
    const HEIGHT = 560;
    const CARD_W = 96;
    const BOX_AT = { x: WIDTH / 2, y: 210 };
    const DEAL_AT = { x: WIDTH / 2, y: 392 };
    /** Slow enough to read as a turntable rather than as a thing being spun. */
    const SPIN = 0.52;
    /** How far the box leans back, so you are looking slightly down into it. */
    const TILT = -0.30;

    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    void loadCardArt(board, { themes: [...DECK_THEMES] });

    let box: TuckBox | undefined;
    let cards: CardSprite[] = [];
    let theme: DeckTheme = 'press';
    let busy = false;
    const stack = defineStack({ id: 'deck', ...DEAL_AT });

    function build(): void {
      busy = false;
      box?.destroy();
      for (const card of cards) card.destroy();
      cards = [];
      box = new TuckBox(board, BOX_AT.x, BOX_AT.y, {
        cardWidth: CARD_W, art: { theme, backColor: DECK_STOCK[theme].back },
      });
      box.tilt = TILT;
      box.spin = SPIN;
      set('lid', 0);
      note(`${DECK_THEME_LABELS[theme]}, sealed. Fifty-two inside.`);
    }

    /** A number on the box, tweened. */
    function tweenBox(key: 'open' | 'turn', from: number, to: number, duration: number, ease: string): Promise<void> {
      const state = { v: from };
      const target = box!;
      return board.tweens.to(state, {
        v: to, duration, ease, onUpdate: () => { target[key] = state.v; },
      });
    }

    /**
     * The whole sequence, as four beats, each waiting for the last: a lid still
     * moving when the deck starts to rise is a deck coming out through a lid.
     */
    async function openAndDeal(): Promise<void> {
      const b = box;
      if (!b || busy) return;
      busy = true;
      b.spin = 0;
      note('Turning it to face you.');
      await tweenBox('turn', b.turn, Math.round(b.turn / (Math.PI * 2)) * Math.PI * 2, 620, 'Sine.easeInOut');
      // Two beats, because they are two things: the lid is the first 55% of
      // `open` and the deck rises over the rest.
      note('The lid hinges at the back; the tab comes out of the front.');
      await tweenBox('open', 0, 0.55, 620, 'Sine.easeInOut');
      note('And the deck lifts out.');
      await tweenBox('open', 0.55, 1, 900, 'Cubic.easeOut');
      await pause(160);
      // The block becomes fifty-two real cards at the place the block had got
      // to - read off the mesh's own vertices through the lens the screen uses.
      const from = b.deckCentre();
      handOver(from);
      b.showDeck(false);
      set('lid', 100);
      note('Fifty-two cards, and a riffle.');
      await slideTo(from, 420);
      await riffleShuffle(board, cards, stack, { rounds: 2 });
      orderStack(cards, stack, 0);
      note('Shuffled. "Put it back" seals a new one.');
      busy = false;
    }

    /** Real cards, stacked where the block was, in front of the box. */
    function handOver(at: { x: number; y: number }): void {
      cards = shuffledDeck().map((card: Card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false }, {
          width: CARD_W, theme, backColor: DECK_STOCK[theme].back,
        });
        sprite.setPosition(at.x, at.y - i * 0.16);
        sprite.depth = 10 + i;
        return sprite;
      });
    }

    function slideTo(from: { x: number; y: number }, duration: number): Promise<void> {
      const at = stackPositions(stack, cards.length);
      const state = { k: 0 };
      return board.tweens.to(state, {
        k: 1, duration, ease: 'Cubic.easeInOut',
        onUpdate: () => {
          cards.forEach((card, i) => card.setPosition(
            from.x + (at[i].x - from.x) * state.k,
            (from.y - i * 0.16) + (at[i].y - (from.y - i * 0.16)) * state.k,
          ));
        },
      });
    }

    const pause = (ms: number) => ctx.wait(ms);
    function note(text: string): void {
      const el = document.getElementById('note');
      if (el) el.textContent = text;
    }
    const on = (id: string, run: () => void) => document.getElementById(id)?.addEventListener('click', run);
    const slide = (id: string, run: (value: number) => void) =>
      document.getElementById(id)?.addEventListener('input', (event) =>
        run(Number((event.target as HTMLInputElement).value)));
    const set = (id: string, value: number) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = String(value);
    };

    on('open', () => void openAndDeal());
    on('reset', () => build());
    on('deck', () => {
      theme = DECK_THEMES[(DECK_THEMES.indexOf(theme) + 1) % DECK_THEMES.length];
      build();
    });
    slide('lid', (v) => { if (box && !busy) box.open = v / 100; });
    slide('turn', (v) => {
      if (!box || busy) return;
      box.spin = 0;
      box.turn = (v / 180) * Math.PI;
    });

    build();
    expose({ board, box: () => box, cards: () => cards, openAndDeal, busy: () => busy });
  },
});

standalone(scene);
