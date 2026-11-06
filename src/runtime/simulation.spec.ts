import { describe, expect, it } from 'vitest';
import { buildDeck, seeded, shuffle } from '../core/index.js';
import { ManualClock } from './clock.js';
import { createEngine } from './engine.js';
import { Rng, Rules, Simulation, Stamped } from './simulation.js';

// A small game: shuffle, deal to seats, play cards to a pile, with a turn
// clock that passes the turn when it runs out.
interface Table {
  deck: string[];
  hands: Record<string, string[]>;
  pile: string[];
  turn: string;
  clock: number;
}
type Command =
  | { type: 'shuffle' }
  | { type: 'deal'; seats: string[]; count: number }
  | { type: 'play'; seat: string; card: string };

const SEATS = ['n', 'e', 's', 'w'];
const rules: Rules<Table, Command> = {
  apply(state, command, ctx) {
    if (command.type === 'shuffle') state.deck = shuffle(state.deck, ctx.rng.next);
    if (command.type === 'deal') {
      for (let i = 0; i < command.count; i++) {
        for (const seat of command.seats) (state.hands[seat] ??= []).push(state.deck.pop()!);
      }
    }
    if (command.type === 'play') {
      if (command.seat !== state.turn) return;   // not theirs to play: ignored the same everywhere
      const hand = state.hands[command.seat];
      const at = hand.indexOf(command.card);
      if (at < 0) return;
      state.pile.push(...hand.splice(at, 1));
      state.turn = SEATS[(SEATS.indexOf(state.turn) + 1) % SEATS.length];
      state.clock = 300;
    }
  },
  tick(state) {
    if (--state.clock > 0) return;
    state.turn = SEATS[(SEATS.indexOf(state.turn) + 1) % SEATS.length];
    state.clock = 300;
  },
};
const fresh = (): Table => ({
  deck: buildDeck().map((c) => `${c.rank}${c.suit[0]}`), hands: {}, pile: [], turn: 'n', clock: 300,
});

describe('a simulation', () => {
  it('the random source is the same as `seeded`, and its state can be saved', () => {
    const a = new Rng(42);
    const b = seeded(42);
    for (let i = 0; i < 5; i++) expect(a.next()).toBe(b());
    const saved = a.state;
    const next = a.next();
    a.state = saved;
    expect(a.next()).toBe(next);
  });

  it('a server and a client fed the same commands agree at every tick', () => {
    const server = new Simulation(rules, fresh(), { seed: 7 });
    const client = new Simulation(rules, fresh(), { seed: 7 });
    const wire: Stamped<Command>[] = [];
    wire.push(server.submit({ type: 'shuffle' }));
    wire.push(server.submit({ type: 'deal', seats: SEATS, count: 5 }));
    for (const s of wire) client.receive(s);
    for (let t = 0; t < 10; t++) {
      server.advance();
      client.advance();
      expect(client.hash()).toBe(server.hash());
    }
    const card = server.state.hands.n[0];
    client.receive(server.submit({ type: 'play', seat: 'n', card }, { from: 'n' }));
    server.advance(400);
    client.advance(400);
    expect(client.state).toEqual(server.state);
    expect(client.hash()).toBe(server.hash());
    expect(server.state.pile).toEqual([card]);
    // The turn clock ran out once after the play: e, then s.
    expect(server.state.turn).toBe('s');
  });

  it('a different seed is a different game', () => {
    const a = new Simulation(rules, fresh(), { seed: 1 });
    const b = new Simulation(rules, fresh(), { seed: 2 });
    a.submit({ type: 'shuffle' });
    b.submit({ type: 'shuffle' });
    a.advance();
    b.advance();
    expect(a.hash()).not.toBe(b.hash());
  });

  it('the log replays the game, and a snapshot carries on from where it was', () => {
    const game = new Simulation(rules, fresh(), { seed: 9 });
    game.submit({ type: 'shuffle' });
    game.submit({ type: 'deal', seats: SEATS, count: 3 });
    game.advance(5);
    const snap = game.snapshot();
    game.submit({ type: 'play', seat: 'n', card: game.state.hands.n[1] });
    game.advance(20);

    const replayed = Simulation.replay(rules, fresh(), game.log, { seed: 9, toTick: game.tick });
    expect(replayed.hash()).toBe(game.hash());

    const resumed = Simulation.restore(rules, snap, {});
    for (const s of game.log.filter((x) => x.tick > snap.tick)) resumed.receive(s);
    resumed.runTo(game.tick);
    expect(resumed.hash()).toBe(game.hash());
  });

  it('a command for a tick already run is applied at the next, and counted', () => {
    const sim = new Simulation(rules, fresh(), { seed: 3 });
    sim.advance(10);
    sim.receive({ tick: 4, seq: 0, command: { type: 'shuffle' } });
    expect(sim.late).toBe(1);
    expect(sim.advance()).toHaveLength(1);
  });

  it('runs headless on an engine with a manual clock, one tick per fixed step', () => {
    const clock = new ManualClock(10);
    const engine = createEngine({ clock, lifecycle: null, fixedStep: 50 });
    const sim = new Simulation(rules, fresh(), { seed: 5, step: 50 });
    const stop = sim.run(engine);
    clock.advance(1000);
    stop();
    expect(sim.tick).toBe(20);
    expect(sim.state.clock).toBe(280);
  });
});
