import './serve';
import {
  Card, SUITS, Zone, autosave, buildDeck, colorOf, createHistory, createSave, createTable, defineScene, flipCard,
  rankValue, seeded, shuffle,
} from '@exterkamp/felt';
import { showCode } from './code';
import { button, expose, label, slot, standalone } from './kit';

// Klondike, on a Table. Everything below the layout is the game: what each
// zone accepts, what may be picked up from it, and what happens on a tap.
// Dragging, the drop outline, sending back a card that may not go there,
// carrying a run of cards, turning arrivals face up - that is the table's.

const W = 480;
const H = 720;
const COLUMN = W / 7;
const x = (col: number) => COLUMN * (col + 0.5);
const TOP = 72;
const TABLEAU = 190;

const value = (card: Card) => rankValue(card.rank);
const red = (card: Card) => colorOf(card.suit) === 'red';

export const scene = defineScene({
  name: 'solitaire',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    const say = (text: string) => { ctx.$('#score').textContent = text; };
    // The game's own state, besides where the cards are: kept with every
    // undo step, and in the save.
    let game = { seed: Date.now() % 100000, moves: 0, passes: 0 };

    // #region The zones, and the rules of Klondike
    const table = createTable(board);
    // The stock: nothing is dragged off it; a tap turns a card onto the waste.
    const stock = table.pile({ id: 'stock', x: x(0), y: TOP, faceUp: false, drag: false });
    const waste = table.pile({ id: 'waste', x: x(1), y: TOP, faceUp: true, accepts: () => false });
    // Foundations: one per suit, labelled with it. Only that suit, from its
    // ace up, one card at a time.
    const foundations = SUITS.map((suit, i) => table.pile({
      id: `foundation-${suit}`, x: x(3 + i), y: TOP, faceUp: true,
      accepts: ([card, ...more], pile) => !more.length && card.suit === suit
        && value(card) === (pile.topCard ? value(pile.topCard) : 0) + 1,
    }));
    // Columns: a king on an empty one, else one rank down in the other colour.
    // Any face-up run may be picked up, as long as it is itself in sequence.
    const columns = Array.from({ length: 7 }, (_, i) => table.pile({
      id: `column-${i}`, x: x(i), y: TABLEAU, fan: 'down', step: 24, maxSpread: H - TABLEAU - 70,
      drag: 'run',
      canTake: (cards) => cards.every((card, k) => card.faceUp
        && (k === 0 || (red(card) !== red(cards[k - 1]) && value(card) === value(cards[k - 1]) - 1))),
      accepts: (cards, pile) => (pile.topCard
        ? pile.topCard.faceUp && red(cards[0]) !== red(pile.topCard) && value(cards[0]) === value(pile.topCard) - 1
        : value(cards[0]) === 13),
    }));
    // #endregion

    for (const zone of [stock, waste, ...foundations, ...columns]) slot(board, zone.stack.x, zone.stack.y);
    foundations.forEach((f, i) => label(board, f.stack.x, TOP - 54, ['♠', '♥', '♦', '♣'][i], '#7fae86', 14));

    // #region Playing: drags, taps, and turning up what a move uncovers
    table.draggable();
    const home = () => foundations.reduce((n, f) => n + f.size, 0);
    const score = () => {
      if (!game.moves) say('Drag cards to build down in alternating colours, and up by suit on the foundations.');
      else say(home() === 52 ? `Solved in ${game.moves} moves.`
        : `${game.moves} moves · ${home()} of 52 home${game.passes ? ` · ${game.passes} times through` : ''}.`);
    };
    // A column whose last face-up card has gone turns up the one under it.
    // Moves by 'sync' are an undo putting the table back: not play.
    table.on('move', ({ from, to, by }) => {
      if (by === 'deal' || by === 'sync') return;
      if (from?.id.startsWith('column') && from.top && !from.top.card.faceUp) {
        void flipCard(board, from.top, { faceUp: true, lift: 10 });
      }
      if (from === waste && to === stock) game.passes++;
      if (to !== stock) game.moves++;
      score();
    });
    table.on('tap', ({ card, zone }) => {
      // The stock: turn one onto the waste - or, once it is empty, the waste back over.
      if (zone === stock) {
        if (stock.top) void table.move(stock.top, waste, { spins: 0, arc: 8, duration: 200 });
        else void table.move([...waste.cards].reverse(), stock, { spins: 0, arc: 0, duration: 200 });
        return;
      }
      // A card on top of anything: up to its foundation, if it may go.
      if (!card || !zone || card !== zone.top || !card.card.faceUp) return;
      const to = foundations.find((f) => f.accepts([card.card], zone));
      if (to) void table.move(card, to, { spins: 0, arc: 14 });
    });
    // #endregion

    // #region Undo and redo: one step per drop or tap, the score and passes with it
    // Each drop, tap or recycle is one step - the card it turns up included,
    // since that flip starts in the same move handler. The game's state rides
    // along, so an undo puts the move count and the passes back too.
    const history = createHistory(table, {
      game: { save: () => game, load: (saved) => { game = saved; score(); } },
    });
    ctx.scope.add(() => history.destroy());
    const undo = button(ctx, 'undo', () => void history.undo()) as HTMLButtonElement;
    const redo = button(ctx, 'redo', () => void history.redo()) as HTMLButtonElement;
    const buttons = () => { undo.disabled = !history.canUndo; redo.disabled = !history.canRedo; };
    ctx.scope.add(history.on('change', buttons));
    ctx.listen(window, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      const letter = key.key.toLowerCase();
      if (!(key.ctrlKey || key.metaKey) || (letter !== 'z' && letter !== 'y')) return;
      key.preventDefault();
      if (key.shiftKey || letter === 'y') void history.redo();
      else void history.undo();
    });
    // #endregion

    // #region Dealing: seven columns, the last card of each turned up
    async function deal(seed: number): Promise<void> {
      table.clear();
      stock.put(shuffle(buildDeck(), seeded(seed)));
      const landed: Promise<void>[] = [];
      let n = 0;
      for (let row = 0; row < 7; row++) {
        for (let col = row; col < 7; col++) {
          landed.push(table.move(stock.top!, columns[col],
            { delay: n++ * 40, duration: 260, spins: 0, arc: 12, pop: false, by: 'deal' }));
        }
      }
      await Promise.all(landed);
      await Promise.all(columns.map((c: Zone) => flipCard(board, c.top!, { faceUp: true, lift: 10 })));
    }
    // #endregion

    // #region Saving, and resuming where it was left
    // Saved after every step and whenever the page is hidden, frozen or left -
    // and when the scene ends, since the scene's scope runs the disposer. On
    // the way in, a save is put back at once: no deal, nothing drawn first.
    const save = createSave<typeof game>({ id: 'felt-solitaire', version: 1 });
    function newGame(seed: number): Promise<void> {
      save.clear();
      return table.run(async () => {
        // The deal is not a step: begun as a group (nothing is saved half
        // way through it), then made the start of the game's history.
        history.begin('deal');
        try {
          await deal(seed);
        } finally {
          game = { seed, moves: 0, passes: 0 };
          history.reset();
          score();
          buttons();
        }
      }).then(() => undefined);
    }
    const resumed = save.resume(history);
    if (!resumed.ok) void newGame(game.seed);
    buttons();
    ctx.scope.add(autosave(history, save, { lifecycle: ctx.engine }));
    button(ctx, 'new', () => void newGame(game.seed + 1));
    // #endregion

    expose({ board, table, stock, waste, foundations, columns, history, save, resumed, deal: newGame });
  },
});

standalone(scene);
