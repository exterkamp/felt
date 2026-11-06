import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, DEFAULT_DECK_THEME, DISPLAY_FONT, FanDirection, MESSY_TURN, Sprite, StackOrder,
  buildDeck, cardFaceMetrics, createTable, seeded, shuffle,
} from 'felt';
import { showCode } from './code';
import { expose, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'stacks',
  create(ctx) {
    showCode(ctx);
    // A board made of nothing but stacks.
    //
    // One of every direction a pile can run, each twice - newest card in front and
    // oldest in front - and a card you can drag from any pile to any other. There
    // are no rules: what this shows is the placement primitive - where a stack is,
    // where its nth card sits, and which stack a dragged card is being offered to.
    const WIDTH = 480;
    const HEIGHT = 760;
    const MARGIN = 12;
    const COLUMNS = 6;
    const PITCH = (WIDTH - 2 * MARGIN) / COLUMNS;
    const centre = (column: number) => MARGIN + PITCH / 2 + column * PITCH;

    const TOP_ROW = 70;
    const RIGHT_ROW = 175;
    const LEFT_ROW = 280;
    const COLUMN_TOP = 355;
    const UP_FOOT = 700;
    const DOWN_CAP = 110;
    const SIDE_CAP = 80;
    const theme = DEFAULT_DECK_THEME;
    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    let squeezed = true;
    let messy = 0;
    const marks: Sprite[] = [];

    // #region A table of stacks: one of every direction a pile can run, each twice
    const table = createTable(board, { style: { theme } });
    const pair = (fan: FanDirection, step: number, cap: number,
      places: Record<StackOrder, { x: number; y: number }>) =>
      (['last-on-top', 'first-on-top'] as StackOrder[]).map((order) => table.pile({
        id: `${fan}-${order}`, ...places[order], fan, step, maxSpread: squeezed ? cap : 0, messy, order,
      }));
    const piles = [
      ...pair('none', 0, 0, {
        'last-on-top': { x: centre(0), y: TOP_ROW }, 'first-on-top': { x: centre(1), y: TOP_ROW },
      }),
      table.pile({ id: 'deck', x: centre(5), y: TOP_ROW, messy }),
      ...pair('right', 22, SIDE_CAP, {
        'last-on-top': { x: MARGIN + CARD_WIDTH / 2, y: RIGHT_ROW },
        'first-on-top': { x: WIDTH / 2 + CARD_WIDTH / 2, y: RIGHT_ROW },
      }),
      ...pair('left', 22, SIDE_CAP, {
        'last-on-top': { x: WIDTH / 2 - CARD_WIDTH / 2, y: LEFT_ROW },
        'first-on-top': { x: WIDTH - MARGIN - CARD_WIDTH / 2, y: LEFT_ROW },
      }),
      ...pair('down', 26, DOWN_CAP, {
        'last-on-top': { x: centre(0), y: COLUMN_TOP + CARD_HEIGHT / 2 },
        'first-on-top': { x: centre(1), y: COLUMN_TOP + CARD_HEIGHT / 2 },
      }),
      ...pair('up', 26, DOWN_CAP, {
        'last-on-top': { x: centre(4), y: UP_FOOT }, 'first-on-top': { x: centre(5), y: UP_FOOT },
      }),
    ];
    const pile = (id: string) => piles.find((p) => p.id === id);
    // Squeezing and messing reshape the stacks; the cards follow at once.
    const reshape = () => {
      for (const p of piles) {
        const cap = p.stack.fan === 'none' ? 0 : p.stack.fan === 'down' || p.stack.fan === 'up' ? DOWN_CAP : SIDE_CAP;
        p.reshape({ maxSpread: squeezed ? cap : 0, messy }, 0);
      }
    };
    // #endregion

    /** The outline of every stack, and which way it runs. */
    function printFelt(): void {
      for (const mark of marks.splice(0)) mark.destroy();
      for (const { stack } of piles) {
        marks.push(board.graphic(CARD_WIDTH, CARD_HEIGHT, (pen, w, h) => {
          pen.strokeStyle = 'rgba(207, 234, 208, 0.25)';
          pen.lineWidth = 1.5;
          pen.beginPath();
          pen.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 5);
          pen.stroke();
        }, { key: 'stacks-slot', x: stack.x, y: stack.y, depth: 0 }));
      }
      const say = (x: number, y: number, text: string, color: string, size = 10) => {
        marks.push(board.text(text, { font: DISPLAY_FONT, size, color }, { x, y, depth: 0 }));
      };
      for (const { stack } of piles) {
        if (stack.id === 'deck') {
          say(stack.x, stack.y - CARD_HEIGHT / 2 - 9, 'deck', '#7fae86');
          continue;
        }
        const y = stack.fan === 'up' ? stack.y + CARD_HEIGHT / 2 + 9 : stack.y - CARD_HEIGHT / 2 - 9;
        say(stack.x, y, stack.order === 'last-on-top' ? 'last' : 'first', '#cfead0');
      }
      say(centre(3), TOP_ROW, 'SQUARED', '#7fae86', 11);
      say(WIDTH - 56, RIGHT_ROW, 'RIGHT', '#7fae86', 11);
      say(56, LEFT_ROW, 'LEFT', '#7fae86', 11);
      say(WIDTH / 2 - 20, COLUMN_TOP + 60, 'DOWN', '#7fae86', 11);
      say(WIDTH / 2 - 20, UP_FOOT - 60, 'UP', '#7fae86', 11);
    }

    function report(): void {
      const note = document.getElementById('note');
      if (!note) return;
      const column = pile('down-last-on-top');
      const gap = column && column.cards.length > 1
        ? Math.round((column.cards[1].y - column.cards[0].y) * 10) / 10 : 0;
      const peek = cardFaceMetrics(CARD_WIDTH).peek;
      const pair = 'Each pair is the same stack twice, drawn newest-in-front and oldest-in-front. ';
      const squeeze = squeezed
        ? `maxSpread ${DOWN_CAP}: the six-card column fans at ${gap} units a card instead of 26 `
          + `— under the ${peek.toFixed(1)} an index needs, so the ranks are clipped.`
        : `maxSpread 0: every pile fans at its full step, clear of the ${peek.toFixed(1)} `
          + 'units an index needs.';
      const mess = messy > 0
        ? ` messy ${messy.toFixed(2)}: every card turned up to `
          + `${(messy * MESSY_TURN).toFixed(1)}° where it lands, the same way every time `
          + 'the pile is drawn.'
        : ' messy 0: every pile square.';
      const dial = document.getElementById('messy-value');
      if (dial) dial.textContent = messy.toFixed(2);
      note.textContent = pair + squeeze + mess;
    }

    // #region Dealing, and dragging from any pile to any other
    function deal(): void {
      table.clear();
      const deck = shuffle(buildDeck(), seeded(Date.now() % 100000)).map((card) => ({ ...card, faceUp: true }));
      for (const order of ['last-on-top', 'first-on-top']) {
        pile(`none-${order}`)!.put(deck.splice(0, 3));
        pile(`right-${order}`)!.put(deck.splice(0, 5));
        pile(`left-${order}`)!.put(deck.splice(0, 5));
        pile(`down-${order}`)!.put(deck.splice(0, 6));
        pile(`up-${order}`)!.put(deck.splice(0, 6));
      }
      pile('deck')!.put(deck);
    }
    // Only the card drawn in front comes away (each pile's default), the
    // outline shows where it will land, and a drop anywhere else sends it back.
    table.draggable();
    // #endregion

    document.getElementById('deal')?.addEventListener('click', () => deal());
    const dial = document.getElementById('messy') as HTMLInputElement | null;
    dial?.addEventListener('input', () => {
      messy = Number(dial.value);
      reshape();
      report();
    });
    document.getElementById('squeeze')?.addEventListener('click', () => {
      squeezed = !squeezed;
      reshape();
      report();
    });

    printFelt();
    deal();
    report();

    // The handle a console session - or the smoke test - reaches the board by.
    expose({ board, table, piles: () => piles });
  },
});

standalone(scene);
