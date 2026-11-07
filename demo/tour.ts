import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, CardSprite, FanDirection, Rank, Stack, Suit, animatorOf, buildDeck, cardRect,
  createTable, dealCards, defineHand, defineScene, isRed, defineStack, flickCard, flipCard, layHand, loadCardArt, nextPosition,
  orderStack, seeded, shuffle, stackPositions, stackUnder, throwCard, topCardIndex,
} from '@exterkamp/felt';
import { showRegions } from './code';
import { expose, standalone } from './kit';

// From a blank board: the engine one idea at a time, a board per idea, on
// one long page. Section 9 then does the same with the Table, in a
// fraction of the code. Each `#region` below is shown in the page under the board
// it builds (see tour.html's `pre[data-region]`), so the text and the code
// can't drift apart: what you read is what runs.

const FELT = '#13463a';

// #region 10. The scene
export const scene = defineScene({
  name: 'tour',
  create(ctx) {
    // Everything this page makes goes through ctx - boards, listeners - so
    // the scene ending (back to the demos) undoes all of it, newest first.
    showRegions(ctx);
    // #endregion
    const deck = buildDeck();
    const find = (rank: Rank, suit: Suit) => deck.find((c) => c.rank === rank && c.suit === suit)!;
    const say = (id: string, text: string) => { ctx.$(`#${id}`).textContent = text; };

    // --- 1 -----------------------------------------------------------------
    // #region 1. A board
    const blank = ctx.board({ parent: 'b-board', width: 480, height: 200, backgroundColor: FELT });
    // Optional: cards fetch their own art as they are made. This only starts
    // it sooner - and it is the engine's, so every board after this one is warm.
    void loadCardArt(blank);
    // #endregion
    const describe = () => say('s-board', `${blank.width} × ${blank.height} board units, shown at `
      + `${blank.canvas.style.width} · ${blank.pixelRatio}× pixels · ${blank.is3d ? 'perspective' : 'flat'}`
      + ` · ${blank.renderer.drawCalls} draw calls (nothing on it yet)`);
    describe();
    ctx.every(1000, describe);

    // --- 2 -----------------------------------------------------------------
    // #region 2. A card
    const table = ctx.board({ parent: 'b-card', width: 480, height: 200, backgroundColor: FELT });
    // The data: plain objects, the same ones a game's rules would hold.
    const three = [find('A', 'spades'), find('Q', 'hearts'), find('7', 'diamonds')];
    three.forEach((card, i) => {
      // The sprite: that card on this board, face up or down.
      const sprite = new CardSprite(table, { ...card, faceUp: i !== 1 }, { width: 76 });
      sprite.setPosition(120 + i * 120, 100);
      sprite.setInteractive();   // so a tap can find it
    });
    table.on('tap', (pointer) => {
      // The node under the pointer, front to back, as drawn.
      const sprite = table.pick(pointer.x, pointer.y) as CardSprite | undefined;
      if (!sprite) return;
      // No faceUp given: the other side from wherever it is heading.
      void flipCard(table, sprite).then(() => say('s-card', `card data: ${JSON.stringify(sprite.card)}`));
    });
    // #endregion

    // --- 3 -----------------------------------------------------------------
    // #region 3. Its pose
    const poseBoard = ctx.board({ parent: 'b-pose', width: 480, height: 240, backgroundColor: FELT });
    const posed = new CardSprite(poseBoard, { ...find('K', 'hearts'), faceUp: true }, { width: 96 });
    posed.setPosition(240, 120);
    for (const input of ctx.root.querySelectorAll<HTMLInputElement>('#pose input')) {
      ctx.listen(input, 'input', () => {
        const value = Number(input.value);
        // Each is a setter that touches the board: the next frame draws it.
        if (input.name === 'angle') posed.angle = value;        // degrees, in the plane
        else if (input.name === 'z') posed.z = value;           // board units towards the camera
        else if (input.name === 'tilt') posed.tilt = value;     // radians, about its width
        else if (input.name === 'turn') posed.turn = value;     // radians, about its length
        else posed.bow = value;                                 // a bend, as a fraction of its height
        input.nextElementSibling!.textContent = value.toFixed(input.step === '1' ? 0 : 2);
      });
    }
    ctx.listen(ctx.$('#pose-flat'), 'click', (event) => {
      poseBoard.setFov(poseBoard.is3d ? 0 : 45);   // 0: no perspective at all
      (event.target as HTMLElement).textContent = `View: ${poseBoard.is3d ? '3D' : '2D'}`;
    });
    // #endregion

    // --- 4 -----------------------------------------------------------------
    // #region 4. A stack
    const stackBoard = ctx.board({ parent: 'b-stack', width: 480, height: 300, backgroundColor: FELT });
    const FANS: FanDirection[] = ['down', 'right', 'left', 'up', 'none'];
    let fan: FanDirection = 'down';
    let messy = 0;
    /** Where the pile starts for each fan, so it has the board to grow into. */
    const START = { down: [240, 60], up: [240, 240], right: [60, 150], left: [420, 150], none: [240, 150] };
    const pileCards: CardSprite[] = [];
    const supply = shuffle(buildDeck(), seeded(4));
    function layPile(): void {
      const [x, y] = START[fan];
      const across = fan === 'right' || fan === 'left';
      const stack = defineStack({ id: 'pile', x, y, fan, step: 26, maxSpread: across ? 360 : 180, messy });
      // Where each card sits - place and angle - and which draws in front.
      stackPositions(stack, pileCards.length).forEach((at, i) => {
        pileCards[i].setPosition(at.x, at.y);
        pileCards[i].angle = at.angle;
      });
      orderStack(pileCards, stack);
    }
    function setCount(n: number): void {
      while (pileCards.length > n) pileCards.pop()!.destroy();
      while (pileCards.length < n) {
        pileCards.push(new CardSprite(stackBoard, { ...supply[pileCards.length], faceUp: true }));
      }
      layPile();
    }
    // #endregion
    setCount(6);
    ctx.listen(ctx.$('#stack-fan'), 'click', (event) => {
      fan = FANS[(FANS.indexOf(fan) + 1) % FANS.length];
      (event.target as HTMLElement).textContent = `Fan: ${fan}`;
      layPile();
    });
    ctx.listen(ctx.$('#stack-messy'), 'click', (event) => {
      messy = messy ? 0 : 0.6;
      (event.target as HTMLElement).textContent = `Messy: ${messy ? 'on' : 'off'}`;
      layPile();
    });
    ctx.listen(ctx.$('#stack-more'), 'click', () => setCount(Math.min(14, pileCards.length + 1)));
    ctx.listen(ctx.$('#stack-less'), 'click', () => setCount(Math.max(0, pileCards.length - 1)));

    // --- 5 -----------------------------------------------------------------
    const throwBoard = ctx.board({ parent: 'b-throw', width: 480, height: 280, backgroundColor: FELT });
    const STOCK_AT = { x: 420, y: 200 };
    const stockCards = (board: typeof throwBoard, at: { x: number; y: number }, seed: number) =>
      shuffle(buildDeck(), seeded(seed)).map((card, i) => {
        const sprite = new CardSprite(board, { ...card, faceUp: false });
        sprite.setPosition(at.x, at.y);
        sprite.depth = i;
        return sprite;
      });
    let stock = stockCards(throwBoard, STOCK_AT, 5);
    // #region 5. Onto a pile
    interface Pile { stack: Stack; cards: CardSprite[]; base: number }
    const square: Pile = { stack: defineStack({ id: 'square', x: 70, y: 110, messy: 0.35 }), cards: [], base: 100 };
    const row: Pile = {
      stack: defineStack({ id: 'row', x: 170, y: 110, fan: 'right', step: 26, maxSpread: 200 }), cards: [], base: 200,
    };
    async function throwOne(): Promise<void> {
      const card = stock.pop();
      if (!card) return;
      // Into the pile's array first, so a second throw aims at the place after it.
      square.cards.push(card);
      card.depth = 1000;
      await throwCard(throwBoard, card, { stack: square.stack, count: square.cards.length - 1 }, { spins: 1, arc: 24 });
      // It landed where the layout puts it, so ordering it moves nothing.
      orderStack(square.cards, square.stack, square.base);
      void flipCard(throwBoard, card, { faceUp: true, lift: 10 });
    }
    async function dealFive(): Promise<void> {
      const five = stock.splice(-5).reverse();
      const count = row.cards.length;
      row.cards.push(...five);
      five.forEach((card, i) => { card.depth = 1000 + i; });
      // Five throws, 110 ms apart, at places count, count + 1, ... of the row.
      await dealCards(throwBoard, five, { stack: row.stack, count }, { stagger: 110, spins: 1, arc: 20 });
      orderStack(row.cards, row.stack, row.base);
      for (const card of five) void flipCard(throwBoard, card, { faceUp: true, lift: 10 });
    }
    // #endregion
    const report = () => say('s-throw', `${stock.length} in the deck · ${square.cards.length} on the messy pile`
      + ` · ${row.cards.length} in the row`);
    report();
    ctx.listen(ctx.$('#throw-one'), 'click', () => void throwOne().then(report));
    ctx.listen(ctx.$('#throw-deal'), 'click', () => void dealFive().then(report));
    ctx.listen(ctx.$('#throw-gather'), 'click', () => {
      const back = [...square.cards, ...row.cards];
      square.cards = [];
      row.cards = [];
      back.forEach((card, i) => {
        card.setFaceUp(false);
        card.depth = stock.length + i;
        void throwCard(throwBoard, card, STOCK_AT, { delay: i * 20, spins: 0, arc: 10, pop: false });
      });
      stock = [...stock, ...back];
      report();
    });

    // --- 6 -----------------------------------------------------------------
    // #region 6. Dragging
    const dragBoard = ctx.board({ parent: 'b-drag', width: 480, height: 260, backgroundColor: FELT });
    const columns = [100, 240, 380].map((x, i) => ({
      stack: defineStack({ id: `column-${i}`, x, y: 70, fan: 'down', step: 24, maxSpread: 120 }),
      cards: [] as CardSprite[],
    }));
    type Column = (typeof columns)[number];
    const layColumn = (column: Column) => {
      stackPositions(column.stack, column.cards.length).forEach((at, i) => column.cards[i].setPosition(at.x, at.y));
      orderStack(column.cards, column.stack, columns.indexOf(column) * 100);
    };
    shuffle(buildDeck(), seeded(6)).slice(0, 12).forEach((card, i) => {
      const sprite = new CardSprite(dragBoard, { ...card, faceUp: true });
      sprite.draggable = true;   // the board reports drags on it
      columns[i % 3].cards.push(sprite);
    });
    columns.forEach(layColumn);

    let dragging: { card: CardSprite; from: Column; grip: { x: number; y: number } } | undefined;
    dragBoard.on('dragstart', (pointer, node) => {
      const card = node as CardSprite;
      const from = columns.find((c) => c.cards.includes(card))!;
      // Only the card in front comes away; anything under it is refused.
      if (from.cards[topCardIndex(from.stack, from.cards.length)!] !== card) { pointer.refuse?.(); return; }
      dragging = { card, from, grip: { x: pointer.x - card.x, y: pointer.y - card.y } };
      card.depth = 10_000;
    });
    dragBoard.on('drag', (pointer) => {
      // The game moves the card. (The lift and the swing are the board's pick-up, on top.)
      if (dragging) dragging.card.setPosition(pointer.x - dragging.grip.x, pointer.y - dragging.grip.y);
    });
    dragBoard.on('dragend', () => {
      const drag = dragging;
      dragging = undefined;
      if (!drag) return;
      // The pile the card overlaps most, if any; otherwise back where it came from.
      const others = columns.filter((c) => c !== drag.from);
      const over = stackUnder(cardRect(drag.card), others.map((c) => ({ stack: c.stack, count: c.cards.length })));
      const to = others.find((c) => c.stack === over) ?? drag.from;
      drag.from.cards.splice(drag.from.cards.indexOf(drag.card), 1);
      to.cards.push(drag.card);
      layColumn(drag.from);
      // Settled into its place with a short throw, then the pile takes it over.
      void throwCard(dragBoard, drag.card, { stack: to.stack, count: to.cards.length - 1 },
        { spins: 0, arc: 6, duration: 180, pop: false }).then(() => layColumn(to));
      say('s-drag', to === drag.from ? 'Not over another pile: back where it came from.'
        : `Onto ${to.stack.id}: ${columns.map((c) => c.cards.length).join(' · ')}`);
    });
    // #endregion

    // --- 7 -----------------------------------------------------------------
    const handBoard = ctx.board({ parent: 'b-hand', width: 480, height: 280, backgroundColor: FELT });
    const HAND_DECK = { x: 60, y: 110 };
    const handStock = stockCards(handBoard, HAND_DECK, 7);
    // #region 7. A hand
    const hand = defineHand({ id: 'hand', x: 270, y: 215, radius: 260, step: 9, maxSpread: 70 });
    const held: CardSprite[] = [];
    const inFlight = new Set<CardSprite>();
    async function throwIn(): Promise<void> {
      const card = handStock.pop();
      if (!card) return;
      held.push(card);
      inFlight.add(card);
      card.depth = 5000;
      // Everything already in the hand opens up to make room...
      layHand(handBoard, held, hand, { base: 1000, except: [...inFlight] });
      // ...and the new card aims at its place in the bigger hand.
      await throwCard(handBoard, card, { hand, count: held.length - 1 }, { spins: 1, arc: 20 });
      inFlight.delete(card);
      layHand(handBoard, held, hand, { base: 1000, except: [...inFlight] });
      void flipCard(handBoard, card, { faceUp: true, lift: 12 });
    }
    function takeBack(): void {
      const card = held.pop();
      if (!card || inFlight.has(card)) { if (card) held.push(card); return; }
      card.setFaceUp(false);
      card.depth = handStock.length;
      handStock.push(card);
      void throwCard(handBoard, card, HAND_DECK, { spins: 0, arc: 10, pop: false });
      layHand(handBoard, held, hand, { base: 1000, except: [...inFlight] });
    }
    // #endregion
    ctx.listen(ctx.$('#hand-throw'), 'click', () => void throwIn());
    ctx.listen(ctx.$('#hand-take'), 'click', takeBack);

    // --- 8 -----------------------------------------------------------------
    const flickBoard = ctx.board({ parent: 'b-flick', width: 480, height: 360, backgroundColor: FELT });
    const FLICK_DECK = { x: 240, y: 290 };
    const flickStock = stockCards(flickBoard, FLICK_DECK, 8);
    for (const card of flickStock) card.draggable = true;
    // #region 8. Flicking
    const target = defineStack({ id: 'target', x: 240, y: 90, messy: 0.3 });
    const landed: CardSprite[] = [];
    const loose = new Set<CardSprite>();
    let flicked: { card: CardSprite; grip: { x: number; y: number } } | undefined;
    flickBoard.on('dragstart', (pointer, node) => {
      const card = node as CardSprite;
      const top = card === flickStock[flickStock.length - 1];
      if (!top && !loose.has(card)) { pointer.refuse?.(); return; }
      animatorOf(flickBoard).stop(card, 'move');   // caught mid-slide: it stops where it is
      if (top) { flickStock.pop(); loose.add(card); void flipCard(flickBoard, card, { faceUp: true, lift: 0 }); }
      flicked = { card, grip: { x: pointer.x - card.x, y: pointer.y - card.y } };
      card.depth = 10_000;
    });
    flickBoard.on('drag', (pointer) => {
      if (flicked) flicked.card.setPosition(pointer.x - flicked.grip.x, pointer.y - flicked.grip.y);
    });
    flickBoard.on('dragend', (pointer) => {
      const go = flicked;
      flicked = undefined;
      if (!go) return;
      // The one place it may land: where the pile's next card goes, at that card's angle.
      const next = nextPosition(target, landed.length);
      void flickCard(flickBoard, go.card, pointer.velocity, {
        grip: go.grip,
        half: { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 },
        bounds: { left: 0, top: 0, right: 480, bottom: 360 },
        magnets: [{ x: next.x, y: next.y, angle: next.angle, reach: 90 }],
        onRest: (path) => {
          if (path.caught === undefined) { say('s-flick', 'Missed: it stays where it stopped. Flick it again.'); return; }
          loose.delete(go.card);
          landed.push(go.card);
          go.card.draggable = false;
          orderStack(landed, target, 100);
          if (!go.card.card.faceUp) void flipCard(flickBoard, go.card, { faceUp: true, lift: 0 });
          say('s-flick', `Caught: ${landed.length} on the pile.`);
        },
      });
    });
    // #endregion

    // --- 9 -----------------------------------------------------------------
    // #region 9. A table
    const tableBoard = ctx.board({ parent: 'b-table', width: 480, height: 300, backgroundColor: FELT });
    const felt = createTable(tableBoard);
    const source = felt.pile({ id: 'deck', x: 400, y: 220, faceUp: false });
    // Two zones, each with its rule. Everything a drag does follows from them.
    const reds = felt.pile({
      id: 'reds', x: 80, y: 70, fan: 'down', step: 22, maxSpread: 150, faceUp: true,
      accepts: ([card]) => isRed(card.suit),
    });
    const blacks = felt.pile({
      id: 'blacks', x: 200, y: 70, fan: 'down', step: 22, maxSpread: 150, faceUp: true,
      accepts: ([card]) => !isRed(card.suit),
    });
    felt.draggable();
    felt.on('move', ({ cards, from, to }) => say('s-table',
      `${cards[0].card.rank} of ${cards[0].card.suit}: ${from?.id ?? 'loose'} → ${to?.id ?? 'loose'}`));
    felt.on('refuse', ({ cards }) => say('s-table', `The ${cards[0].card.suit} don't go there: back it goes.`));
    // The game's own moves: each card to the pile whose rule takes it.
    const dealSix = () => felt.run(async () => {
      const landed: Promise<void>[] = [];
      for (let i = 0; i < 6 && source.top; i++) {
        const card = source.top;
        const to = [reds, blacks].find((pile) => pile.accepts([card.card]))!;
        landed.push(felt.move(card, to, { delay: i * 90, spins: 1, arc: 20 }));
      }
      await Promise.all(landed);
    });
    ctx.listen(ctx.$('#table-deal'), 'click', () => void dealSix());
    ctx.listen(ctx.$('#table-reset'), 'click', () => {
      felt.clear();
      source.put(shuffle(buildDeck(), seeded(Date.now() % 1000)));
    });
    source.put(shuffle(buildDeck(), seeded(9)));
    // #endregion

    expose({
      board: dragBoard,
      boards: [blank, table, poseBoard, stackBoard, throwBoard, dragBoard, handBoard, flickBoard, tableBoard],
      felt, reds, blacks, source,
      columns: () => columns.map((c) => c.cards.length), pile: () => pileCards, landed: () => landed.length,
      held: () => held.length, posed,
    });
    // #region 10. The scene
  },
});

standalone(scene);
// #endregion
