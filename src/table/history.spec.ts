import { describe, expect, it } from 'vitest';
import { History } from './history.js';
import { GameSave, SAVE_FORMAT, autosave, decodeSave, encodeSave, memoryStore } from './save.js';
import type { TableState } from './state.js';
import type { Table } from './table.js';

// The history only listens to the table's events and reads and writes its
// state through hooks, so a stand-in table does: zones of ids, a waste that
// turns cards up, and the events a real one sends.

type Handler = (event: unknown) => void;
const tick = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

function fake(cards = 'abcdef') {
  const handlers = new Map<string, Set<Handler>>();
  let state: TableState = { zones: { stock: [...cards], waste: [], home: [] }, faceUp: [], loose: [] };
  const restores: { state: TableState; instant: boolean }[] = [];
  const emit = (event: string, payload: unknown) => { for (const h of [...(handlers.get(event) ?? [])]) h(payload); };
  const table = {
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => { handlers.get(event)!.delete(handler); };
    },
  } as unknown as Table;
  const move = (from: string, to: string, by = 'api') => {
    const next = JSON.parse(JSON.stringify(state)) as TableState;
    const card = next.zones[from].pop()!;
    next.zones[to].push(card);
    next.faceUp = to === 'stock' ? next.faceUp.filter((id) => id !== card) : [...new Set([...next.faceUp, card])].sort();
    state = next;
    emit('move', { cards: [{ card: { id: card } }], from: { id: from }, to: { id: to }, by });
  };
  const game = { score: 0, passes: 0 };
  const history = (cap?: number) => new History(table, {
    cap,
    game: { save: () => ({ ...game }), load: (g) => { Object.assign(game, g); } },
    capture: () => state,
    apply: (s, o) => {
      // What the real restore does: its own moves, which must not be recorded.
      emit('move', { cards: [], from: undefined, to: undefined, by: 'sync' });
      state = s;
      restores.push({ state: s, instant: !!o.instant });
      return Promise.resolve();
    },
    fits: (s) => Object.keys(s.zones).every((z) => z in state.zones),
  });
  return { table, move, emit, game, history, restores, get state() { return state; } };
}

describe('history', () => {
  it('records each burst of moves as one step, once the code making them is done', async () => {
    const t = fake();
    const h = t.history();
    t.move('stock', 'waste'); t.move('stock', 'waste'); t.game.score = 2;
    expect(h.steps.length).toBe(1);
    await tick();
    expect(h.steps.length).toBe(2);
    expect(h.current.moves.map((m) => m.cards[0])).toEqual(['f', 'e']);
    expect(h.current.game).toEqual({ score: 2, passes: 0 });
    t.move('waste', 'home');
    await tick();
    expect(h.index).toBe(2);
    expect(h.log()).toEqual([
      { cards: ['f'], from: 'stock', to: 'waste', by: 'api' },
      { cards: ['e'], from: 'stock', to: 'waste', by: 'api' },
      { cards: ['e'], from: 'waste', to: 'home', by: 'api' },
    ]);
  });

  it('a group is one step however long it awaits', async () => {
    const t = fake();
    const h = t.history();
    await h.group(async () => {
      t.move('stock', 'waste'); await tick(); await tick();
      t.move('stock', 'waste'); await tick();
      expect(h.canUndo).toBe(false);
    }, 'deal');
    expect(h.steps.length).toBe(2);
    expect(h.current.label).toBe('deal');
    expect(h.current.moves.length).toBe(2);
  });

  it('undo puts back the table and the game; redo makes it again', async () => {
    const t = fake();
    const h = t.history();
    const start = t.state;
    t.move('stock', 'waste'); t.game.score = 5; await tick();
    const after = t.state;
    expect(await h.undo()).toBe(true);
    expect(t.state).toEqual(start);
    expect(t.game.score).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(await h.undo()).toBe(false);
    expect(await h.redo()).toBe(true);
    expect(t.state).toEqual(after);
    expect(t.game.score).toBe(5);
    // Its own restores were not recorded as steps.
    expect(h.steps.length).toBe(2);
  });

  it('undo straight after a move, before it was recorded, undoes it', async () => {
    const t = fake();
    const h = t.history();
    const start = t.state;
    t.move('stock', 'waste');
    expect(h.canUndo).toBe(true);
    expect(await h.undo()).toBe(true);
    expect(t.state).toEqual(start);
  });

  it('a new move after undo throws away what was ahead', async () => {
    const t = fake();
    const h = t.history();
    t.move('stock', 'waste'); await tick();
    t.move('stock', 'waste'); await tick();
    await h.undo();
    t.move('waste', 'home'); await tick();
    expect(h.steps.length).toBe(3);
    expect(h.canRedo).toBe(false);
    expect(h.log().map((m) => m.to)).toEqual(['waste', 'home']);
  });

  it('keeps at most `cap` steps, dropping the oldest', async () => {
    const t = fake();
    const h = t.history(3);
    for (let i = 0; i < 5; i++) { t.move('stock', 'waste'); await tick(); }
    expect(h.steps.length).toBe(4);
    expect(h.index).toBe(3);
    let undone = 0;
    while (await h.undo()) undone++;
    expect(undone).toBe(3);
    expect(t.state.zones.waste.length).toBe(2);
  });

  it('will not undo with cards in the hand, or mid-group', async () => {
    const t = fake();
    const h = t.history();
    t.move('stock', 'waste'); await tick();
    t.emit('take', {});
    expect(h.canUndo).toBe(false);
    expect(await h.undo()).toBe(false);
    t.emit('drop', {});
    h.begin();
    expect(await h.undo()).toBe(false);
    h.end();
    expect(await h.undo()).toBe(true);
  });

  it('a step that changes nothing is not a step', async () => {
    const t = fake();
    const h = t.history();
    expect(h.commit()).toBe(false);
    t.game.passes = 1;
    expect(h.commit('pass')).toBe(true);
    expect(h.steps.length).toBe(2);
  });

  it('tells of every change', async () => {
    const t = fake();
    const h = t.history();
    const causes: string[] = [];
    h.on('change', (c) => causes.push(c.cause));
    t.move('stock', 'waste'); await tick();
    await h.undo(); await h.redo(); h.reset();
    expect(causes).toEqual(['step', 'undo', 'redo', 'reset']);
    expect(h.steps.length).toBe(1);
  });

  it('round-trips through JSON, and refuses what does not fit', async () => {
    const t = fake();
    const h = t.history();
    t.move('stock', 'waste'); t.game.score = 1; await tick();
    t.move('stock', 'home'); t.game.score = 2; await tick();
    await h.undo();
    const saved = JSON.parse(JSON.stringify(h.toJSON()));

    const u = fake();
    const again = u.history();
    expect(again.load(saved)).toBe(true);
    expect(u.state).toEqual(t.state);
    expect(u.restores.at(-1)!.instant).toBe(true);
    expect(u.game.score).toBe(1);
    expect(again.index).toBe(1);
    expect(again.canRedo).toBe(true);

    expect(again.load({ steps: [], index: 0 })).toBe(false);
    expect(again.load({ ...saved, index: 7 })).toBe(false);
    const elsewhere = JSON.parse(JSON.stringify(saved));
    elsewhere.steps[0].table.zones.nowhere = [];
    expect(again.load(elsewhere)).toBe(false);
    expect(again.index).toBe(1);
  });
});

describe('saves', () => {
  it('writes and reads back a game, enveloped and versioned', async () => {
    const t = fake();
    const h = t.history();
    t.move('stock', 'waste'); await tick();
    const store = memoryStore();
    const save = new GameSave({ id: 'klondike', version: 2, store, now: () => 1234 });
    expect(save.write(h)).toBe(true);
    const raw = JSON.parse(store.data.get('felt:save:klondike')!);
    expect(raw).toMatchObject({ format: SAVE_FORMAT, game: 'klondike', version: 2, savedAt: 1234 });
    const read = save.read();
    expect(read.ok && read.save.history.index).toBe(1);

    const u = fake();
    const resumed = u.history();
    expect(save.resume(resumed).ok).toBe(true);
    expect(u.state).toEqual(t.state);
  });

  it('says what is wrong with a save, and clears the bad ones on resume', () => {
    const good = encodeSave({ steps: [{ table: { zones: {}, faceUp: [], loose: [] }, moves: [] }], index: 0 }, 'g', 1);
    const read = (text: string | null, options = {}) => {
      const r = decodeSave(text, { id: 'g', ...options });
      return r.ok ? 'ok' : r.problem;
    };
    expect(read(good)).toBe('ok');
    expect(read(null)).toBe('none');
    expect(read('{"format":1,')).toBe('corrupt');
    expect(read('[1,2]')).toBe('corrupt');
    expect(read(good.replace('"steps":[{', '"steps":[{"x":1,').replace('"zones":{}', '"zones":7'))).toBe('corrupt');
    expect(read(good, { id: 'other' })).toBe('other-game');
    expect(read(good, { version: 2 })).toBe('old-version');
    expect(read(good, { version: 2, migrate: (s: { version: number }) => ({ ...s, version: 2 }) })).toBe('ok');
    expect(read(good.replace('"format":1', '"format":99'))).toBe('newer-format');

    const store = memoryStore();
    store.setItem('felt:save:g', 'not json at all');
    const t = fake();
    const save = new GameSave({ id: 'g', store });
    const resumed = save.resume(t.history());
    expect(resumed.ok ? 'ok' : resumed.problem).toBe('corrupt');
    expect(store.data.has('felt:save:g')).toBe(false);

    // Well-formed, but for a table with other zones.
    const elsewhere = encodeSave({ steps: [{ table: { zones: { gone: [] }, faceUp: [], loose: [] }, moves: [] }], index: 0 }, 'g');
    store.setItem('felt:save:g', elsewhere);
    const unfit = save.resume(t.history());
    expect(unfit.ok ? 'ok' : unfit.problem).toBe('unfit');
    expect(store.data.has('felt:save:g')).toBe(false);
  });

  it('a store that throws is a game that goes on unsaved', () => {
    const t = fake();
    const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); }, removeItem() {} };
    const save = new GameSave({ id: 'g', store: broken });
    expect(save.write(t.history())).toBe(false);
    const read = save.read();
    expect(read.ok ? 'ok' : read.problem).toBe('unavailable');
    expect(new GameSave({ id: 'g', store: null }).write(t.history())).toBe(false);
  });

  it('autosaves after steps, when the page goes, and when disposed - never mid-group', async () => {
    const t = fake();
    const h = t.history();
    const store = memoryStore();
    const save = new GameSave({ id: 'g', store });
    let suspend = () => {};
    const off = autosave(h, save, { lifecycle: { on: (_e, fn) => { suspend = fn; return () => { suspend = () => {}; }; } } });
    t.move('stock', 'waste'); await tick();
    expect(JSON.parse(store.data.get('felt:save:g')!).history.index).toBe(1);
    store.data.clear();
    h.begin();
    t.move('stock', 'waste');
    suspend();
    expect(store.data.size).toBe(0);
    h.end();
    expect(JSON.parse(store.data.get('felt:save:g')!).history.index).toBe(2);
    store.data.clear();
    suspend();
    expect(store.data.size).toBe(1);
    store.data.clear();
    off();
    expect(store.data.size).toBe(1);
    store.data.clear();
    t.move('stock', 'waste'); await tick();
    expect(store.data.size).toBe(0);
  });
});
