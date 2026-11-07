import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, CardSprite, DISPLAY_FONT, Readout, announcerOf, buildDeck, createTable, defineScene,
  formatClock, formatNumber, glyphsOf, readout, seeded, shuffle, toastsOf,
} from 'felt';
import { showCode } from './code';
import { button, expose, slot, standalone } from './kit';

// Text on and over the table, and words for whoever cannot see it.
//
// A score that counts up and pops, a clock, and a label under each pile -
// all readouts, drawn on the board in glyphs - then banners and floating
// "+10"s over it, and every move said aloud through the page's live region.

const W = 480;
const H = 500;
const PILE_Y = 340;
const NAMES: Record<string, string> = {
  A: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
  10: 'ten', J: 'jack', Q: 'queen', K: 'king',
};
const spoken = (card: CardSprite) => `${NAMES[card.card.rank] ?? card.card.rank} of ${card.card.suit}`;

export const scene = defineScene({
  name: 'readouts',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });

    // #region Readouts: a score, a clock, labels on the piles
    const caption = { font: DISPLAY_FONT, size: 11, weight: '700', color: '#7fae86', letterSpacing: 1.5 };
    readout(board, { ...caption, value: 'TIME', x: 22, y: 26, align: 'left' });
    readout(board, { ...caption, value: 'SCORE', x: W - 22, y: 26, align: 'right' });
    // mm:ss, from the engine's clock: it stops while the page is hidden.
    const clock = readout(board, {
      x: 22, y: 52, align: 'left', size: 26, weight: '600', color: '#fdfdfd', value: 0,
      format: (ms) => formatClock(ms),
    });
    // Counts up to each new score and pops when it changes; tabular digits,
    // right-aligned, so it grows to the left and never shimmies.
    const score = readout(board, {
      x: W - 22, y: 52, align: 'right', size: 30, weight: '700', color: '#ffd166', value: 0,
      countUp: 350, pop: true, stroke: '#0b2119', strokeWidth: 2.5,
    });
    let started = ctx.engine.time;
    ctx.every(250, () => clock.set(ctx.engine.time - started));

    // Under each pile, a label with its count - under the cards (depth -1).
    const table = createTable(board);
    const stock = table.pile({ id: 'stock', x: 100, y: PILE_Y, faceUp: false, drag: false });
    const waste = table.pile({ id: 'waste', x: 240, y: PILE_Y, faceUp: true, drag: false, accepts: () => false });
    const home = table.pile({ id: 'home', x: 380, y: PILE_Y, faceUp: true, drag: false, accepts: () => false });
    const below = PILE_Y + CARD_HEIGHT / 2 + 16;
    const labelOf = (name: string, x: number) => readout(board, {
      x, y: below, size: 14, weight: '600', color: '#cfead0', depth: -1, value: 0,
      format: (n) => `${name} ${n}`,
    });
    const labels = { stock: labelOf('Stock', stock.stack.x), waste: labelOf('Waste', waste.stack.x),
      home: labelOf('Home', home.stack.x) };
    // Over the cards: a count badge on the stock's corner, above every resting card.
    const badge = readout(board, {
      x: stock.stack.x + CARD_WIDTH / 2 - 4, y: PILE_Y - CARD_HEIGHT / 2 + 2, size: 16, weight: '700',
      color: '#ffffff', stroke: '#8a1c1c', strokeWidth: 4, depth: 900_000, value: 0,
    });
    const recount = () => {
      labels.stock.set(stock.size);
      labels.waste.set(waste.size);
      labels.home.set(home.size);
      badge.set(stock.size);
    };
    // #endregion

    for (const zone of [stock, waste, home]) slot(board, zone.stack.x, zone.stack.y, -2);

    // #region Toasts and announcements
    const toasts = toastsOf(board);
    const announcer = announcerOf(ctx.engine);
    const add = (points: number, at: { x: number; y: number }) => {
      score.set((score.value as number) + points);
      // A float off the card; not said itself - the score is, once the burst is over.
      toasts.float(formatNumber(points, { sign: 'always' }), at.x, at.y - CARD_HEIGHT / 2);
      announcer.announce(`Score ${score.value}`, { key: 'score' });
    };
    table.on('tap', ({ zone }) => {
      if (zone === stock) {
        const card = stock.top;
        if (!card) {
          // urgent: in front of any banner waiting; assertive: said now.
          toasts.show('No moves left', { urgent: true, tone: 'bad', announce: 'assertive' });
          return;
        }
        void table.move(card, waste, { spins: 0, arc: 10, duration: 220 }).then(recount);
        announcer.announce(`You turned the ${spoken(card)} onto the waste. ${stock.size} left in the stock.`);
        add(5, waste.stack);
      } else if (zone === waste && waste.top) {
        const card = waste.top;
        void table.move(card, home, { spins: 0, arc: 14, duration: 260 }).then(recount);
        announcer.announce(`You moved the ${spoken(card)} home.`);
        add(10, home.stack);
        if (home.size % 5 === 0) toasts.show('Nice!', { tone: 'good' });
      }
      recount();
    });
    // #endregion

    // #region Bumping the score: once, five hundred times, sixty times a second
    button(ctx, 'bump', () => score.set((score.value as number) + 15));
    const hammer = (times = 500) => {
      for (let i = 0; i < times; i++) score.set((score.value as number) + 1, { animate: false, pop: false });
    };
    button(ctx, 'hammer', () => hammer());
    button(ctx, 'rapid', () => {
      const stop = ctx.onFrame(() => score.set((score.value as number) + 7, { animate: false, pop: false }));
      ctx.delay(2000, stop);
    });
    // #endregion

    button(ctx, 'nice', () => toasts.show('Nice!', { tone: 'good' }));
    button(ctx, 'turn', () => toasts.show("Player 2's turn", { place: 'center' }));
    button(ctx, 'bottom', () => toasts.show('Saved. Back here whenever you like.', { place: 'bottom' }));
    button(ctx, 'stuck', () => toasts.show('No moves left', { urgent: true, tone: 'bad', announce: 'assertive' }));
    button(ctx, 'float', () => {
      const top = home.top ?? waste.top ?? stock.top;
      add(10, top ?? { x: W / 2, y: PILE_Y });
    });
    const reduced = ctx.$<HTMLInputElement>('#reduced');
    ctx.listen(reduced, 'change', () => {
      toasts.reducedMotion = reduced.checked || undefined;
      for (const r of [score, clock, badge, ...Object.values(labels)] as Readout[]) r.reducedMotion = reduced.checked || undefined;
    });

    const deal = (seed: number) => {
      table.clear();
      stock.put(shuffle(buildDeck(), seeded(seed)).slice(0, 24));
      score.set(0, { animate: false });
      started = ctx.engine.time;
      clock.set(0);
      recount();
    };
    let seed = 7;
    button(ctx, 'reset', () => deal(++seed));
    deal(seed);

    // The visible log of what was said, for sighted testers.
    const log = ctx.$('#said');
    ctx.scope.add(announcer.onAnnounce(({ text, politeness }) => {
      const item = document.createElement('li');
      item.className = politeness;
      item.textContent = text;
      const tag = document.createElement('small');
      tag.textContent = politeness;
      item.append(tag);
      log.prepend(item);
      while (log.children.length > 30) log.lastElementChild!.remove();
    }));
    const stats = ctx.$('#atlas');
    ctx.every(500, () => {
      stats.textContent = `atlas: ${board.atlas.pages.length} page(s) · ${board.atlas.paints} paints · `
        + `${glyphsOf(board).size} glyphs in use, ${glyphsOf(board).painted} painted`;
    });

    expose({ board, table, stock, waste, home, score, clock, labels, badge, toasts, announcer, hammer, glyphs: glyphsOf(board) });
  },
});

standalone(scene);
