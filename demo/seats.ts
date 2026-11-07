import './serve';
import { Card, Rules, Simulation, Stamped, buildDeck, createTable, defineScene, shuffle } from '@exterkamp/felt';
import { showCode } from './code';
import { expose, standalone } from './kit';

// Multiplayer, with the network faked: three Simulations of one game.
//
// The server's is the game. Each seat's is a copy that only ever applies
// what the server sent, at the tick the server said. A seat's tap is a
// *request*; the server stamps it for `INPUT_DELAY` ticks ahead - longer
// than the trip to the seats - so it reaches both copies before its tick
// comes round, and all three apply it on the same tick. That is lockstep,
// and it is what makes `hash()` agree everywhere: no copy ever has to guess.
//
// The boards only animate what a tick changed. Neither of them changes the
// game.

interface Table {
  deck: string[];
  hands: { north: string[]; south: string[] };
  pile: string[];
  turn: Seat;
  /** Ticks left on the turn. */
  clock: number;
}
type Seat = 'north' | 'south';
type Command = { type: 'deal' } | { type: 'play'; seat: Seat; card: string };

const TICK_MS = 1000 / 30;
const TURN_TICKS = 30 * 8;
const INPUT_DELAY = 15;   // ticks: 500 ms, comfortably more than a round trip
const HAND = 6;

const other = (seat: Seat): Seat => (seat === 'north' ? 'south' : 'north');
// #region The game, as rules
const rules: Rules<Table, Command> = {
  apply(state, command, ctx) {
    if (command.type === 'deal') {
      state.deck = shuffle([...state.deck, ...state.hands.north, ...state.hands.south, ...state.pile], ctx.rng.next);
      state.hands = { north: [], south: [] };
      state.pile = [];
      for (let i = 0; i < HAND; i++) {
        state.hands.north.push(state.deck.pop()!);
        state.hands.south.push(state.deck.pop()!);
      }
      state.turn = 'south';
      state.clock = TURN_TICKS;
      return;
    }
    // Checked by every copy the same way, so a play that was not yours to
    // make is refused everywhere at once.
    if (command.seat !== state.turn) return;
    const hand = state.hands[command.seat];
    const at = hand.indexOf(command.card);
    if (at < 0) return;
    state.pile.push(...hand.splice(at, 1));
    state.turn = other(state.turn);
    state.clock = TURN_TICKS;
  },
  tick(state) {
    if (--state.clock > 0) return;
    state.turn = other(state.turn);
    state.clock = TURN_TICKS;
  },
};
// #endregion

export const scene = defineScene({
  name: 'seats',
  create(ctx) {
    showCode(ctx);
    const cards = new Map<string, Card>(buildDeck().map((c) => [c.id, c]));
    const start = (): Table => ({
      deck: [...cards.keys()], hands: { north: [], south: [] }, pile: [], turn: 'south', clock: TURN_TICKS,
    });
    const SEED = 2026;
    // #region Three copies, in lockstep on the engine's fixed steps
    const server = new Simulation(rules, start(), { seed: SEED, step: TICK_MS });
    const seats: Record<Seat, Simulation<Table, Command>> = {
      north: new Simulation(rules, start(), { seed: SEED, step: TICK_MS }),
      south: new Simulation(rules, start(), { seed: SEED, step: TICK_MS }),
    };
    let latency = 150;
    let sent = 0;
    let refused = 0;

    // The wire: everything takes `latency` ms of engine time to arrive.
    const toSeats = (stamped: Stamped<Command>) => {
      sent++;
      for (const seat of Object.values(seats)) ctx.delay(latency, () => seat.receive(stamped));
    };
    const toServer = (command: Command) => {
      ctx.delay(latency, () => toSeats(server.submit(command, { tick: server.tick + INPUT_DELAY })));
    };

    // All three on the engine's fixed steps: the same rate everywhere,
    // whatever either display is doing.
    ctx.scope.add(server.run(ctx.engine));
    ctx.scope.add(seats.north.run(ctx.engine));
    ctx.scope.add(seats.south.run(ctx.engine));
    // #endregion

    // --- the two tables -----------------------------------------------------
    const W = 360;
    const H = 300;
    const DECK = { x: 52, y: H / 2 };
    // #region Each seat's view: a table, shown from that seat's copy of the game
    const views = (['north', 'south'] as Seat[]).map((seat) => {
      const board = ctx.board({ parent: seat, width: W, height: H, backgroundColor: '#13463a' });
      const table = createTable(board, { style: { width: 56 }, cards: [...cards.values()] });
      table.pile({ id: 'deck', ...DECK, faceUp: false });
      table.hand({ id: 'mine', x: W / 2, y: H - 58, step: 7, maxSpread: 40, radius: 300, faceUp: true });
      table.hand({ id: 'theirs', x: W / 2, y: 52, step: 5, maxSpread: 30, radius: 300, facing: 180, faceUp: false });
      table.pile({ id: 'pile', x: W / 2 + 40, y: H / 2, messy: 0.6, faceUp: true });
      return { seat, board, table };
    });
    type View = (typeof views)[number];

    /** Puts every card where this seat's copy of the game says it is. */
    function show(view: View): void {
      const state = seats[view.seat].state;
      // The state, as zones of card ids. The table moves whatever is not
      // already where this says - and only that.
      void view.table.sync({
        mine: state.hands[view.seat],
        theirs: state.hands[other(view.seat)],
        pile: state.pile,
        deck: state.deck,
      }, { from: DECK, spins: 0, arc: 16, pop: false, stagger: 60 });
    }
    // #endregion
    const headings = new Map<Seat, HTMLElement>(views.map((v) =>
      [v.seat, ctx.$(`#${v.seat}`).previousElementSibling as HTMLElement]));
    let shownSecond = -1;

    for (const view of views) {
      const sim = seats[view.seat];
      ctx.scope.add(sim.onTick((applied) => {
        const state = sim.state;
        const second = Math.ceil(state.clock / 30);
        if (second !== shownSecond || applied.length) {
          const name = view.seat === 'north' ? 'North' : 'South';
          headings.get(view.seat)!.textContent = `${name} sees · ${state.turn === view.seat ? 'your turn' : 'their turn'}, ${second}s`;
        }
        if (view.seat === 'south') shownSecond = second;
        if (applied.length) show(view);
      }));
      // #region A tap is a request to the server
      // A tap on your own card, on your turn, asks the server. The view
      // never moves the card itself: the game will, when the play comes back.
      view.table.on('tap', ({ card, zone }) => {
        if (!card || zone?.id !== 'mine') return;
        if (seats[view.seat].state.turn !== view.seat) { refused++; return; }
        toServer({ type: 'play', seat: view.seat, card: card.card.id });
      });
      // #endregion
    }

    // --- in sync? -------------------------------------------------------------
    const sync = ctx.$('#sync');
    const hashes = { agreed: 0, differed: 0 };
    // #region Checking every copy agrees
    // After the last of the three has stepped (they run in the order they
    // were put on the engine), so all three are at the same tick.
    ctx.scope.add(seats.south.onTick(() => {
      if (seats.north.tick !== server.tick || seats.south.tick !== server.tick) return;
      const h = server.hash();
      if (seats.north.hash() === h && seats.south.hash() === h) hashes.agreed++;
      else hashes.differed++;
    }));
    // #endregion
    ctx.every(250, () => {
      sync.textContent = `tick ${server.tick} · server ${server.hash()} · north ${seats.north.hash()}`
        + ` · south ${seats.south.hash()}\n${hashes.differed ? `${hashes.differed} ticks DIFFERED` : 'in sync every tick'}`
        + ` · ${sent} commands sent · ${seats.north.late + seats.south.late} late · ${refused} refused (not your turn)`;
      sync.classList.toggle('bad', hashes.differed > 0);
    });

    ctx.listen(ctx.$('#deal'), 'click', () => toServer({ type: 'deal' }));
    ctx.listen(ctx.$('#lag'), 'click', (event) => {
      latency = latency === 150 ? 400 : latency === 400 ? 30 : 150;
      (event.target as HTMLElement).textContent = `Latency: ${latency} ms`;
    });
    toServer({ type: 'deal' });

    expose({ board: views[1].board, boards: views.map((v) => v.board), server, seats, hashes,
      play: (seat: Seat) => toServer({ type: 'play', seat, card: seats[seat].state.hands[seat][0] }) });
  },
});

standalone(scene);
