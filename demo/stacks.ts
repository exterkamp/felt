import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, CardSprite, COURT_PALETTES, DEFAULT_DECK_THEME, DISPLAY_FONT,
  FanDirection, MESSY_TURN, Sprite, Stack, StackOrder, buildDeck, cardFaceMetrics, cardRect,
  defineStack, loadCardArt, nextPosition, orderStack, renderCourts, seeded, shuffle,
  stackPositions, stackUnder, topCardIndex, Card,
} from 'felt';
import { expose, standalone } from './kit';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'stacks',
  create(ctx) {
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
    /** Above every pile's band, so a card in hand is over everything. */
    const HELD_DEPTH = 10000;

    interface Pile { stack: Stack; cards: CardSprite[] }

    const theme = DEFAULT_DECK_THEME;
    const board = ctx.board({ parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a' });
    let piles: Pile[] = [];
    let squeezed = true;
    let messy = 0;
    let dragging: { view: CardSprite; from: Pile } | undefined;
    const marks: Sprite[] = [];

    // The courts are rendered, not loaded. Not awaited: a card made before its
    // portrait lands shows its pip and is repainted when it arrives.
    void renderCourts(board, COURT_PALETTES[theme]);
    void loadCardArt(board, { themes: [theme] });

    // The drop highlight: one outline, moved to wherever a card would land.
    const highlight = board.graphic(CARD_WIDTH + 4, CARD_HEIGHT + 4, (pen, w, h) => {
      pen.strokeStyle = 'rgba(255, 209, 102, 0.9)';
      pen.lineWidth = 2;
      pen.beginPath();
      pen.roundRect(1, 1, w - 2, h - 2, 5);
      pen.stroke();
    }, { depth: 5, key: 'stacks-highlight' });
    highlight.visible = false;

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

    function buildStacks(): void {
      const kept = new Map(piles.map((p) => [p.stack.id, p.cards]));
      const pair = (fan: FanDirection, step: number, cap: number,
        places: Record<StackOrder, { x: number; y: number }>): Stack[] =>
        (['last-on-top', 'first-on-top'] as StackOrder[]).map((order) => defineStack({
          id: `${fan}-${order}`, ...places[order], fan, step,
          maxSpread: squeezed ? cap : 0, messy, order,
        }));
      const stacks: Stack[] = [
        ...pair('none', 0, 0, {
          'last-on-top': { x: centre(0), y: TOP_ROW }, 'first-on-top': { x: centre(1), y: TOP_ROW },
        }),
        defineStack({ id: 'deck', x: centre(5), y: TOP_ROW, messy }),
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
      piles = stacks.map((stack) => ({ stack, cards: kept.get(stack.id) ?? [] }));
      printFelt();
    }

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

    function deal(): void {
      for (const p of piles) {
        for (const view of p.cards) view.destroy();
        p.cards = [];
      }
      const deck = shuffle(buildDeck(), seeded(Date.now() % 100000));
      let next = 0;
      const give = (id: string, count: number) => {
        const target = pile(id)!;
        for (let n = 0; n < count && next < deck.length; n++) target.cards.push(makeCard(deck[next++]));
      };
      for (const order of ['last-on-top', 'first-on-top']) {
        give(`none-${order}`, 3);
        give(`right-${order}`, 5);
        give(`left-${order}`, 5);
        give(`down-${order}`, 6);
        give(`up-${order}`, 6);
      }
      give('deck', deck.length - next);
      layOutAll();
    }

    function makeCard(card: Card): CardSprite {
      const view = new CardSprite(board, { ...card, faceUp: true }, { theme });
      view.depth = 1;
      view.draggable = true;
      return view;
    }

    function pile(id: string): Pile | undefined {
      return piles.find((p) => p.stack.id === id);
    }

    function layOut(p: Pile): void {
      const at = stackPositions(p.stack, p.cards.length);
      p.cards.forEach((view, i) => {
        view.setPosition(at[i].x, at[i].y);
        view.angle = at[i].angle;
      });
      // Each pile a band of its own, so overlapping piles keep their order. The
      // board sorts by depth itself: nothing else to call.
      orderStack(p.cards, p.stack, piles.indexOf(p) * 100);
    }

    function layOutAll(): void {
      for (const p of piles) layOut(p);
    }

    function targetFor(view: CardSprite): Stack | undefined {
      return stackUnder(cardRect({ x: view.x, y: view.y }),
        piles.filter((p) => !p.cards.includes(view)).map((p) => ({ stack: p.stack, count: p.cards.length })));
    }

    board.on('dragstart', (pointer, node) => {
      const view = node as CardSprite;
      const from = piles.find((p) => p.cards.includes(view));
      // Only the card drawn in front comes away - which on a first-on-top
      // stack is the oldest. Any other is refused, so it is not picked up.
      const front = from ? topCardIndex(from.stack, from.cards.length) : undefined;
      if (!from || front === undefined || from.cards[front] !== view) {
        pointer.refuse?.();
        return;
      }
      dragging = { view, from };
      view.depth = HELD_DEPTH;
    });

    board.on('drag', (pointer) => {
      if (!dragging) return;
      dragging.view.setPosition(pointer.x, pointer.y);
      dragging.view.angle = 0;
      const target = targetFor(dragging.view);
      highlight.visible = Boolean(target);
      if (target) {
        const at = nextPosition(target, pile(target.id)?.cards.length ?? 0);
        highlight.setPosition(at.x, at.y);
      }
    });

    board.on('dragend', () => {
      const drag = dragging;
      dragging = undefined;
      highlight.visible = false;
      if (!drag) return;
      const target = targetFor(drag.view);
      const to = target ? pile(target.id) : undefined;
      if (to && to !== drag.from) {
        drag.from.cards = drag.from.cards.filter((c) => c !== drag.view);
        to.cards.push(drag.view);
        layOut(drag.from);
      }
      layOut(to ?? drag.from);
    });

    document.getElementById('deal')?.addEventListener('click', () => deal());
    const dial = document.getElementById('messy') as HTMLInputElement | null;
    dial?.addEventListener('input', () => {
      messy = Number(dial.value);
      buildStacks();
      layOutAll();
      report();
    });
    document.getElementById('squeeze')?.addEventListener('click', () => {
      squeezed = !squeezed;
      buildStacks();
      layOutAll();
      report();
    });

    buildStacks();
    deal();
    report();

    // The handle a console session - or the smoke test - reaches the board by.
    expose({ board, piles: () => piles });
  },
});

standalone(scene);
