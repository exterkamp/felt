// What the unit tests cannot see: a real browser, a real WebGL2 context, and
// whether the thing on screen is the thing the geometry asked for.
//
// Ported from phaser-card-engine's, which existed because of one bug - every
// depth correct and every card painted in the wrong order, which no test of
// the numbers could catch. That bug cannot happen here (the board sorts by
// depth itself), but its class can: right numbers, wrong screen. So the same
// claims are checked again, plus the ones felt makes that Phaser did not -
// one draw call for a whole table, and a board that draws nothing when
// nothing moves.
//
//   npm run demo            # in one terminal (or: devrun up ...)
//   npm run smoke -- --host=http://localhost:4390
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const host = (process.argv.find((a) => a.startsWith('--host='))?.slice(7)
  ?? process.env.FELT_HOST ?? 'http://localhost:4390').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9000 + Math.floor(Math.random() * 900);
const profile = mkdtempSync(join(tmpdir(), 'felt-smoke-'));
// SwiftShader, so there is a WebGL2 context without a GPU. Slow, which is
// fine: nothing below is timed against the wall clock.
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--window-size=412,915', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', detached: true });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};
const done = (code) => {
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
};
process.on('uncaughtException', (error) => { console.error(error.message); done(1); });

let page;
for (let i = 0; i < 40 && !page; i++) {
  try {
    page = (await (await fetch(`http://localhost:${port}/json/list`)).json()).find((t) => t.type === 'page');
  } catch { await sleep(400); }
}
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener('open', r));
let id = 1;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (e) => {
  const message = JSON.parse(e.data);
  if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push((message.params.exceptionDetails.exception?.description ?? '').split('\n')[0]);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) => new Promise((r) => {
  pending.set(id, r);
  socket.send(JSON.stringify({ id: id++, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) {
    throw new Error(`in page: ${reply.result.exceptionDetails.exception?.description ?? 'error'}`);
  }
  return reply.result?.result?.value;
};
const until = async (expression, ms = 30000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return true; } catch {}
    await sleep(250);
  }
  return false;
};
const open = async (path, ready = '!!window.__felt') => {
  await send('Page.navigate', { url: `${host}/${path}` });
  if (!await until(ready)) {
    console.log(`  FAIL ${path} never came up`);
    done(1);
  }
  await sleep(1200);
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
console.log(`smoking ${host}`);

// --- the index, and the way back --------------------------------------------
await send('Page.navigate', { url: `${host}/` });
await sleep(700);
const tiles = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('a.demo')].map(a => a.href))`));
check(tiles.length === 21, `the home screen lists twenty-one demos (${tiles.length})`);
let reachable = 0;
let wayBack = 0;
let boards = 0;
for (const href of tiles) {
  await send('Page.navigate', { url: href });
  await sleep(300);
  await until(`!!document.querySelector('h1') && !!window.__felt?.board?.renderer?.gl`, 8000);
  if (await evaluate(`!!document.querySelector('h1')`)) reachable++;
  if (await evaluate(`(() => { const a = document.querySelector('a.home');
    return !!a && a.href === location.href.replace(/[^/]*$/, ''); })()`)) wayBack++;
  if (await evaluate(`!!window.__felt?.board?.renderer?.gl`)) boards++;
  else console.log(`  (no board on ${href})`);
}
check(reachable === tiles.length, `every tile opens a page (${reachable}/${tiles.length})`);
check(wayBack === tiles.length, `every page has a way back (${wayBack}/${tiles.length})`);
check(boards === tiles.length, `every page has a WebGL2 board on it (${boards}/${tiles.length})`);

// --- stacks -----------------------------------------------------------------
console.log('\nstacks');
await open('stacks.html', '!!window.__felt?.piles?.().length');
await until(`__felt.board.atlas.pages.length > 0`);
const density = await evaluate(`(() => {
  const c = document.querySelector('#board canvas'); const b = c.getBoundingClientRect();
  return c.width / (b.width * window.devicePixelRatio);
})()`);
check(density >= 1, `canvas at screen density or better (${density.toFixed(2)} backing px per device px)`);

const draw = JSON.parse(await evaluate(`(() => { const b = __felt.board; b.render();
  return JSON.stringify({ calls: b.renderer.drawCalls, instances: b.renderer.instanceCount,
    cards: __felt.piles().reduce((n, p) => n + p.cards.length, 0) }); })()`));
check(draw.cards === 52 && draw.calls === 1,
  `fifty-two cards, every label and every slot in one draw call (${draw.instances} instances, ${draw.calls} call)`);

// Which card a finger lands on is the one drawn in front - the oldest, on a
// first-on-top pile. Asked of the board's own picking, through the lens.
const front = JSON.parse(await evaluate(`(() => JSON.stringify(__felt.piles()
  .filter(p => p.cards.length > 1 && p.stack.fan !== 'none')
  .map(p => {
    const top = p.stack.order === 'first-on-top' ? 0 : p.cards.length - 1;
    const card = p.cards[top];
    // A point on the card that is not under any other card of its pile.
    const hit = __felt.board.pick(card.x, card.y);
    return { order: p.stack.order, ok: hit === card };
  })))()`));
check(front.length >= 8 && front.every((f) => f.ok),
  `a finger on a pile lands on the card drawn in front, either order (${front.filter((f) => f.ok).length}/${front.length})`);

// A real drag, with real pointer events, from one pile to another.
const moved = await evaluate(`(async () => {
  const b = __felt.board;
  const from = __felt.piles().find(p => p.stack.id === 'none-last-on-top');
  const to = __felt.piles().find(p => p.stack.id === 'deck');
  const card = from.cards[from.cards.length - 1];
  const before = to.cards.length;
  const rect = b.canvas.getBoundingClientRect();
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 7, bubbles: true }));
  fire('pointerdown', card.x, card.y);
  for (let i = 1; i <= 10; i++) fire('pointermove', card.x + (to.stack.x - card.x) * i / 10, card.y + (to.stack.y - card.y) * i / 10);
  fire('pointerup', to.stack.x, to.stack.y);
  await new Promise(r => setTimeout(r, 100));
  return to.cards.length === before + 1 && to.cards.includes(card);
})()`);
check(moved === true, 'a card dragged onto another stack joins it');

// Picked up: off the felt, swinging with the drag, and back down after.
const pick = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const rect = b.canvas.getBoundingClientRect();
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 9, bubbles: true }));
  const deck = __felt.piles().find(p => p.cards.length > 3); const card = deck.cards[deck.cards.length - 1];
  const x0 = card.x, y0 = card.y; let high = 0, swung = 0;
  fire('pointerdown', x0, y0);
  await new Promise(r => setTimeout(r, 350));
  const lifted = card.shown.z;
  for (let i = 1; i <= 12; i++) {
    fire('pointermove', x0 - i * 12, y0 + i * 4);
    await new Promise(r => setTimeout(r, 30));
    high = Math.max(high, card.shown.z); swung = Math.max(swung, Math.abs(card.shown.turn), Math.abs(card.shown.angle - card.angle) / 30);
  }
  await new Promise(r => setTimeout(r, 900));
  const settled = Math.abs(card.shown.turn) + Math.abs(card.shown.tilt);
  fire('pointerup', x0 - 144, y0 + 48);
  await new Promise(r => setTimeout(r, 1500));
  // A card under the top of a pile: refused by the game, so never lifted.
  const pile = __felt.piles().find(p => p.cards.length > 3 && p.stack.fan !== 'none');
  const under = pile.cards[0] === pile.cards[pile.cards.length - 1] ? pile.cards[1] : pile.cards.find((c, i, a) => i !== a.length - 1 && c.hitTest(c.x, c.y));
  let underZ = 0;
  if (under) { fire('pointerdown', under.x, under.y); await new Promise(r => setTimeout(r, 300)); underZ = under.shown.z;
    fire('pointerup', under.x, under.y); }
  return JSON.stringify({ lifted, high, swung, settled, after: card.shown.z, holding: b.pickUp.holding(card), underZ, hasUnder: !!under });
})()`));
check(pick.lifted > 15 && pick.high > 20, `a card picked up comes off the felt (${pick.high.toFixed(1)} units)`);
check(pick.swung > 0.05 && pick.settled < 0.02, `swivels with the drag and settles when the hand stops (${pick.swung.toFixed(2)} rad at most)`);
check(pick.after === 0 && !pick.holding, 'and put down, is back on the table with nothing left on it');
check(!pick.hasUnder || pick.underZ === 0, 'a card the game refuses to drag is not picked up');

const courts = await evaluate(`(async () => { await new Promise(r => setTimeout(r, 1500));
  const art = __felt.board.services.get('card-art');
  return [...['J','Q','K']].flatMap(r => ['spades','hearts','diamonds','clubs'].map(s => [r, s]))
    .filter(([r, s]) => art.report().some(a => a.status === 'loaded' && a.key.endsWith('-half-' + r + '-' + s))).length; })()`);
check(courts === 12, `all twelve court portraits rendered and handed to the faces (${courts})`);

// Messy is settled, not rolled, and bounded by MESSY_TURN.
const mess = JSON.parse(await evaluate(`(async () => {
  const dial = document.getElementById('messy');
  const set = (v) => { dial.value = String(v); dial.dispatchEvent(new Event('input')); };
  const angles = () => __felt.piles().flatMap(p => p.cards.map(c => c.angle));
  set(0); const square = angles();
  set(1); const messy = angles();
  set(0); set(1); const again = angles();
  set(0.5); const half = angles();
  set(0);
  return JSON.stringify({
    square: square.every(a => a === 0),
    turned: messy.filter(a => a !== 0).length, cards: messy.length,
    widest: Math.max(...messy.map(Math.abs)),
    settled: JSON.stringify(messy) === JSON.stringify(again),
    halfWidest: Math.max(...half.map(Math.abs)),
  });
})()`));
check(mess.square, 'messy 0 is a square pile');
check(mess.turned > mess.cards * 0.9 && mess.widest <= 12,
  `messy 1 turns nearly every card, none past twelve degrees (${mess.turned}/${mess.cards}, widest ${mess.widest.toFixed(1)})`);
check(mess.settled, 'and drawing it again gives the same angles');
check(Math.abs(mess.halfWidest - mess.widest / 2) < 0.01, 'half the dial is half the angle');

// The engine owns the pictures: one deck on the table is one sheet of faces
// and one back, warmed to all fifty-two, and dealing again paints nothing.
const sheets = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const s = b.services.get('card-sheets');
  for (let i = 0; i < 40 && s.stats.warming; i++) await new Promise(r => setTimeout(r, 100));
  const before = b.atlas.paints;
  document.getElementById('deal').click();
  await new Promise(r => setTimeout(r, 400));
  const sheet = __felt.piles().flatMap(p => p.cards)[0].sheet;
  return JSON.stringify({ ...s.stats, cells: sheet.size, repaints: b.atlas.paints - before,
    shared: new Set(__felt.piles().flatMap(p => p.cards).map(c => c.sheet)).size });
})()`));
check(sheets.faces === 1 && sheets.backs === 1 && sheets.shared === 1,
  `one deck is one sheet of faces and one back, shared by every card (${sheets.faces} / ${sheets.backs})`);
check(sheets.cells === 52 && sheets.warming === 0, `the sheet warms itself to the whole deck (${sheets.cells} cells)`);
check(sheets.repaints === 0, `dealing again paints nothing (${sheets.repaints} paints)`);

// The GPU can take the context away at any moment; every picture has to come
// back from the atlas, including ones painted while it was gone.
const restoredStacks = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const gl = b.renderer.gl; const ext = gl.getExtension('WEBGL_lose_context');
  const count = () => { const c = b.snapshotCanvas(); const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240) n++; return n; };
  const before = count();
  ext.loseContext(); await new Promise(r => setTimeout(r, 300));
  document.getElementById('deal').click();
  ext.restoreContext(); await new Promise(r => setTimeout(r, 1500));
  return JSON.stringify({ before, after: count(), losses: b.contextLosses, lost: gl.isContextLost() });
})()`));
check(restoredStacks.losses === 1 && !restoredStacks.lost && restoredStacks.after > restoredStacks.before * 0.8,
  `a lost WebGL context comes back with every card on it (${restoredStacks.after} card pixels, ${restoredStacks.before} before)`);
check(await evaluate(`!!document.querySelector('.felt-fps')?.textContent`), 'the frame-rate readout is on the page');

// Asleep when nothing moves.
const idle = await evaluate(`(async () => { const b = __felt.board;
  await new Promise(r => setTimeout(r, 400)); const f = b.frames;
  await new Promise(r => setTimeout(r, 1200)); return b.frames - f; })()`);
check(idle === 0, `a still board draws no frames at all (${idle} in 1.2s)`);

// --- the page lifecycle: a sleeping board coming back ----------------------
console.log('\nthe page lifecycle');
// Page.setWebLifecycleState hangs headless Chrome's page after a thaw (even
// a page with no board on it), so the browser's own events are dispatched
// here instead, with document.hidden overridden for visibility.
const hiddenRun = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const tick = () => new Promise(r => setTimeout(r, 250));
  const setHidden = (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange')); };
  const f0 = b.frames;
  setHidden(true); await tick();
  b.touch(); __felt.layOut?.(); await tick();
  const whileHidden = b.frames - f0;
  setHidden(false); await tick();
  const shown = b.frames - f0 - whileHidden;
  delete document.hidden;
  const f1 = b.frames; const r1 = b.resumes;
  document.dispatchEvent(new Event('freeze')); await tick();
  document.dispatchEvent(new Event('resume')); await tick();
  return JSON.stringify({ whileHidden, shown, thawed: b.frames - f1, resumes: b.resumes - r1 });
})()`));
check(hiddenRun.whileHidden === 0, `a hidden page draws nothing, even when touched (${hiddenRun.whileHidden} frames)`);
check(hiddenRun.shown >= 1, `shown again, a sleeping board draws itself unasked (${hiddenRun.shown} frame)`);
check(hiddenRun.resumes === 1 && hiddenRun.thawed >= 1, `and so does a frozen page thawed (${hiddenRun.thawed} frame)`);
const cached = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const f = b.frames; const r = b.resumes;
  dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await new Promise(r => setTimeout(r, 300));
  return JSON.stringify({ frames: b.frames - f, resumes: b.resumes - r });
})()`));
check(cached.resumes === 1 && cached.frames >= 1,
  `a page back from the back/forward cache draws itself again (${cached.frames} frame)`);
const rebuilt = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const old = b.canvas;
  const count = () => { const c = b.snapshotCanvas(); const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240) n++; return n; };
  const before = count();
  // Lost, and never given back: the case that used to leave a dead board.
  old.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
  await new Promise(r => setTimeout(r, 2200));
  return JSON.stringify({ before, after: count(), rebuilds: b.rebuilds, swapped: b.canvas !== old,
    attached: b.canvas.isConnected && !old.isConnected, lost: b.renderer.lost, inst: b.renderer.instanceCount });
})()`));
check(rebuilt.rebuilds === 1 && rebuilt.swapped && rebuilt.attached && !rebuilt.lost,
  'a context lost and never restored is replaced with a new canvas');
check(rebuilt.after > rebuilt.before * 0.8 && rebuilt.inst > 50,
  `with every card painted again on it (${rebuilt.after} card pixels, ${rebuilt.before} before, ${rebuilt.inst} instances)`);
const dragAfter = await evaluate(`(() => { const b = __felt.board; const r = b.canvas.getBoundingClientRect();
  return r.width > 0 && !!b.pick; })()`);
check(dragAfter, 'and the new canvas is laid out where the old one was');

// --- loading: no card before its sheets are finished ------------------------
console.log('\nloading');
await open('loading.html', '!!window.__felt?.frames');
const cameUp = await until(`__felt.loadingReport().ready && __felt.frames().some(f => f.instances)`, 30000);
check(cameUp, 'the deck comes up');
const load = JSON.parse(await evaluate(`JSON.stringify((() => {
  const r = __felt.loadingReport(); const frames = __felt.frames();
  const early = frames.filter(f => !f.ready);
  const first = frames.find(f => f.instances > 0);
  return { stages: r.stages, readyAt: r.readyAt, early: early.length,
    earlyDrawn: early.filter(f => f.instances > 0).length, first,
    revealed: __felt.cards().filter(c => c.revealed).length };
})())`));
check(load.early > 0 && load.earlyDrawn === 0,
  `no card is drawn before the engine says its sheets are ready (${load.early} frames waited, ${load.earlyDrawn} drew)`);
check(load.first?.instances === 52 && load.revealed === 52, `then all fifty-two at once (${load.first?.instances})`);
for (const stage of load.stages) {
  check(stage.total > 0 && stage.done === stage.total && stage.failed === 0,
    `${stage.label}: ${stage.done}/${stage.total}${stage.finishedAt !== undefined ? ` at ${Math.round(stage.finishedAt)} ms` : ''}`);
}
const swap = JSON.parse(await evaluate(`(async () => {
  const from = __felt.frames().length;
  document.getElementById('restyle').click();
  const sheet = __felt.cards()[0].sheet;
  const t = performance.now();
  while (!(sheet.ready() && __felt.cards().every(c => c.revealed)) && performance.now() - t < 30000) {
    await new Promise(r => setTimeout(r, 50));
  }
  await new Promise(r => setTimeout(r, 200));
  const during = __felt.frames().slice(from);
  return JSON.stringify({ ms: performance.now() - t, frames: during.length,
    fewest: Math.min(...during.map(f => f.instances)), ready: sheet.ready() });
})()`));
check(swap.ready && swap.fewest === 52,
  `changing deck keeps every card on show till the new one is finished (${swap.frames} frames, never fewer than ${swap.fewest})`);
const warm = JSON.parse(await evaluate(`(async () => {
  const first = __felt.loadingReport().readyAt;
  const old = __felt.board;
  const art = old.engine.services.get('art-store');
  const before = art.report().length;
  __felt.newBoard();
  const b = __felt.board; const t = performance.now();
  while (!__felt.loadingReport().ready && performance.now() - t < 20000) await new Promise(r => setTimeout(r, 20));
  return JSON.stringify({ first, second: performance.now() - t, sameEngine: b.engine === old.engine,
    newCanvas: b.canvas !== old.canvas && !old.canvas.isConnected, oldDestroyed: old.isDestroyed,
    newArt: art.report().length - before, drawn: __felt.cards().filter(c => c.revealed).length });
})()`));
check(warm.sameEngine && warm.newCanvas && warm.oldDestroyed, 'a board destroyed and made again runs on the same engine');
check(warm.newArt === 0 && warm.second < warm.first / 2 && warm.drawn === 52,
  `and starts warm: no art fetched again, ready in ${Math.round(warm.second)} ms against ${Math.round(warm.first)} cold`);
// A page load later, the portraits come from IndexedDB instead of being made.
// Cleared first, since the stacks page has already kept the same courts.
const courtsOn = async () => {
  await until(`__felt.loadingReport().ready`, 20000);
  await sleep(800);   // the PNG writes, after the courts land
  return JSON.parse(await evaluate(`JSON.stringify((() => {
    const r = __felt.loadingReport(); const store = __felt.board.engine.services.get('art-store');
    return { courts: r.stages.find(st => st.id === 'courts')?.finishedAt, readyAt: r.readyAt,
      hits: store.persisted.hits, misses: store.persisted.misses, writes: store.persisted.writes };
  })())`));
};
await evaluate(`__felt.board.engine.services.get('art-store').persisted.clear()`);
await open('loading.html', '!!window.__felt?.frames');
const cold = await courtsOn();
await open('loading.html', '!!window.__felt?.frames');
const kept = await courtsOn();
check(cold.misses >= 12 && cold.writes >= 12, `a cold load makes the twelve courts and keeps them (${cold.writes} kept)`);
check(kept.hits >= 12 && kept.misses === 0 && kept.courts < cold.courts,
  `the next load draws them from the last visit: courts at ${Math.round(kept.courts)} ms against ${Math.round(cold.courts)} ms, ready at ${Math.round(kept.readyAt)} against ${Math.round(cold.readyAt)}`);

// --- one stack: canned animations tapped fast ------------------------------
console.log('\none stack');
await open('one-stack.html', '__felt?.pile?.().length >= 5');
await until(`__felt.pile().length >= 5 && !__felt.board.tweens.count`, 20000);
const taps = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const flip = document.getElementById('flip');
  const top = () => __felt.pile()[__felt.pile().length - 1];
  const was = top().card.faceUp; let maxZ = 0, maxScale = 0, landed = 0;
  const card = top(); const set = card.setFaceUp; card.setFaceUp = function (up) { landed++; return set.call(this, up); };
  const watch = () => { const p = top().shown; maxZ = Math.max(maxZ, p.z); maxScale = Math.max(maxScale, p.scaleX); };
  b.on('update', watch);
  const t0 = performance.now();
  for (let i = 0; i < 7; i++) { flip.click(); await new Promise(r => setTimeout(r, 30)); }
  while (b.tweens.count) await new Promise(r => setTimeout(r, 20));
  const settled = performance.now() - t0;
  b.off('update', watch); card.setFaceUp = set;
  const c = top();
  return JSON.stringify({ maxZ, maxScale, landed, settled, z: c.z, shownZ: c.shown.z, turn: c.turn, flipped: c.card.faceUp !== was });
})()`));
check(taps.maxZ <= 18.01 && taps.maxScale <= 1.0001,
  `seven quick taps on flip never lift the card past one flip's height (${taps.maxZ.toFixed(1)} units)`);
check(taps.z === 0 && taps.shownZ === 0 && taps.turn === 0, 'and leave it flat on the table');
check(taps.flipped && taps.landed === 1,
  `seven taps 30 ms apart are one flip, not a queue of seven (${taps.landed} landed, settled in ${Math.round(taps.settled)} ms)`);

// --- hold'em ----------------------------------------------------------------
console.log("\nhold'em");
await open('holdem.html', '!!window.__felt?.deck?.().length');
await evaluate(`(() => { __felt.setSpeed(0.2); __felt.deal(); return true; })()`);
await sleep(300);
if (!await until(`__felt.dealing() === false`, 90000)) {
  console.log('  FAIL the deal never finished');
  done(1);
}
await sleep(500);
const order = JSON.parse(await evaluate('JSON.stringify(__felt.order)'));
check(JSON.stringify(order.slice(0, 8)) === JSON.stringify(['you', 'west', 'north', 'east', 'you', 'west', 'north', 'east']),
  'hole cards go one at a time, twice round the table');
check(JSON.stringify(order.slice(8)) === JSON.stringify(['burn', 'board', 'board', 'board', 'burn', 'board', 'burn', 'board']),
  'a card is burned before the flop, the turn and the river');
const hand = JSON.parse(await evaluate(`JSON.stringify({
  counts: Object.fromEntries([...__felt.piles].map(([k, v]) => [k, v.cards.length])),
  deck: __felt.deck().length,
  settled: [...__felt.piles.values()].every((p) => {
    if (p.kind === 'pile') return p.cards.every(c => c.angle === 0);
    const places = __felt.handPositions(p.hand, p.cards.length);
    return p.cards.every((c, i) => Math.abs(((c.angle - places[i].angle + 540) % 360) - 180) < 0.5);
  }),
  flat: [...__felt.piles.values()].every(p => p.cards.every(c => c.z === 0 && c.turn === 0 && c.bow === 0 && c.tilt === 0)),
  faceUp: Object.fromEntries([...__felt.piles].map(([k, v]) => [k, v.cards.every(c => c.card.faceUp)])),
  showing: Object.fromEntries([...__felt.piles].map(([k, v]) => [k, v.cards.every(c => c.facingSide === (v.faceUp ? 'face' : 'back'))])),
  unique: new Set([...[...__felt.piles.values()].flatMap(p => p.cards), ...__felt.deck()].map(c => c.card.id)).size,
})`));
check(JSON.stringify(hand.counts) === JSON.stringify({ you: 2, west: 2, north: 2, east: 2, board: 5, burn: 3 }),
  'every pile ends with the right number of cards');
check(hand.deck === 36, `thirty-six left in the deck (${hand.deck})`);
check(hand.unique === 52, `no card dealt twice (${hand.unique} distinct)`);
check(hand.settled, 'every card comes to rest where its pile holds it, after spinning');
check(hand.flat, 'and back on the felt: nothing left lifted, turned or bent');
check(hand.faceUp.you && hand.faceUp.board && !hand.faceUp.west && !hand.faceUp.burn,
  'your cards and the board face up, everyone else-s face down');
check(Object.values(hand.showing).every(Boolean), 'and each card is showing the side the rules think it is');

// --- the riffle -------------------------------------------------------------
console.log('\nthe riffle');
await open('shuffle.html', '!!window.__felt?.cards?.().length');
const riffle = JSON.parse(await evaluate(`(async () => {
  const before = __felt.cards().map(c => c.card.id).join();
  await __felt.go(1);
  const cards = __felt.cards();
  return JSON.stringify({ ...__felt.bench.seen,
    kept: cards.map(c => c.card.id).join() === before,
    squared: Math.max(...cards.map(c => Math.hypot(c.x - 240, c.y - 210))),
    flat: cards.every(c => c.bow === 0 && c.tilt === 0 && c.turn === 0 && c.z === 0),
    shadows: cards.every(c => c.shadowStrength === 1),
  });
})()`));
check(riffle.bent === 52, `every card is bent, not just some (${riffle.bent})`);
check(riffle.spread > 100, `the two packets part (${riffle.spread} units)`);
check(riffle.bow > 0.12 && riffle.bow < 0.45, `and bow, without folding (${riffle.bow})`);
check(riffle.over === 0, `a landed card never draws over one still in a hand (${riffle.over})`);
check(riffle.kept, 'the deck is left in the order it was already in');
check(riffle.squared < 0.01, `and squares up again (${riffle.squared.toFixed(2)} units off)`);
check(riffle.flat && riffle.shadows, 'flat again afterwards, with its shadows back');

// --- hands ------------------------------------------------------------------
console.log('\nhands');
await open('hands.html', '!!window.__felt?.deck?.().length');
const turning = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board;
  let worst = 0; let last = new Map();
  // Every frame, how far each held card turned since the last one. A re-fan
  // moves a card a few degrees; a spin is the bug.
  const watch = () => {
    for (const c of [...__felt.held(), ...__felt.opposite()]) {
      // A throw spins on purpose; only what moves a card already held counts.
      if ((__felt.animator.running(c, 'move')?.priority ?? 0) > 0) { last.delete(c); continue; }
      const was = last.get(c);
      // Whole turns do not count: a throw lands on its angle less the turns
      // it spun, which is the same picture.
      if (was !== undefined) {
        const step = Math.abs(((c.angle - was) % 360 + 540) % 360 - 180);
        worst = Math.max(worst, step);
      }
      last.set(c, c.angle);
    }
  };
  b.on('update', watch);
  for (let i = 0; i < 10; i++) { __felt.throwOne(); await new Promise(r => setTimeout(r, 260)); }
  // Till everything has landed and turned over, not a fixed time: under
  // software GL a slow frame can leave the last flip still in the air.
  await new Promise(r => setTimeout(r, 500));
  for (let t = 0; t < 80 && b.tweens.count; t++) await new Promise(r => setTimeout(r, 100));
  b.off('update', watch);
  return JSON.stringify({ worst, held: __felt.held().length, opposite: __felt.opposite().length,
    mineUp: __felt.held().every(c => c.card.faceUp), theirsDown: __felt.opposite().every(c => !c.card.faceUp) });
})()`));
check(turning.worst < 20, `no card in a hand spins to reach its new place (worst ${turning.worst.toFixed(1)}° in a frame)`);
check(turning.held + turning.opposite === 10, 'ten thrown, ten held');
check(turning.mineUp && turning.theirsDown, 'mine turned over in the air, theirs left face down');

// --- faces and the deck editor ----------------------------------------------
console.log('\nfaces');
await open('faces.html', '!!window.__felt?.cards?.().length');
const faces = await evaluate(`(async () => { await new Promise(r => setTimeout(r, 2500));
  const art = __felt.board.services.get('card-art');
  const keys = art.report().filter(a => a.status === 'loaded').map(a => a.key);
  return { half: keys.filter(k => k.includes('-half-K-')).length, full: keys.filter(k => k.includes('-full-K-')).length }; })()`);
check(faces.half >= 1 && faces.full >= 1, `both cuts of the court are rendered for the three faces (${faces.half} half, ${faces.full} full)`);
// Dragging the size slider never blanks the cards: each size shows a finished
// one scaled until its own is painted, and another deck is a restyle.
const resize = JSON.parse(await evaluate(`(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const shown = () => __felt.cards().filter(c => c.revealed).length;
  const fewest = { size: 99, deck: 99 };
  // Loaded first: this is about resizing, and a deck still painting on a
  // slow machine is not drawn yet by design.
  for (let t = 0; t < 150 && shown() < __felt.cards().length; t++) await wait(100);
  const slider = document.getElementById('size');
  for (let w = 60; w <= 140; w += 4) { slider.value = String(w); slider.dispatchEvent(new Event('input')); await wait(40); fewest.size = Math.min(fewest.size, shown()); }
  for (let k = 0; k < 3; k++) { document.getElementById('deck').click(); for (let i = 0; i < 4; i++) { await wait(50); fewest.deck = Math.min(fewest.deck, shown()); } }
  const b = __felt.board;
  return JSON.stringify({ ...fewest, cards: __felt.cards().length, pages: b.atlas.pages.length, layers: b.renderer.textureLayers });
})()`));
// Up to eight pages: a sheet left half painted by a drag is kept as a stand-in
// while its look has no finished size, and its few faces hold a page.
check(resize.layers <= resize.pages + 1 && resize.pages <= 8,
  `and the art texture stays the size of what is shown (${resize.pages} pages, ${resize.layers} layers after the drag)`);
check(resize.size === resize.cards && resize.deck === resize.cards,
  `resizing and restyling never blanks a card (fewest drawn: ${resize.size} while resizing, ${resize.deck} changing deck, of ${resize.cards})`);

console.log('\nthe deck editor');
await open('deck.html', '!!window.__felt?.editor');
const rules = await evaluate(`JSON.stringify(__felt.rules)`);
check(rules === JSON.stringify({ spades: 'black', hearts: 'red', diamonds: 'red', clubs: 'black' }),
  'what a suit counts as does not move with what it is printed in');
const pip = await evaluate(`(() => { const r = __felt.suitTexture('spades', 0xffffff); return !!r && r.width > 0; })()`);
check(pip, 'a lone pip for an empty place is a real picture');

// --- throws -----------------------------------------------------------------
console.log('\nthrowing');
await open('throws.html', '!!window.__felt?.deck?.().length');
const thrown = JSON.parse(await evaluate(`(async () => {
  const pile = __felt.piles()[2];
  let rose = 0;
  const b = __felt.board;
  const watch = () => { for (const c of __felt.loose()) rose = Math.max(rose, c.shown.z); };
  b.on('update', watch);
  await __felt.throwAtPoint({ x: 100, y: 560 });
  await __felt.throwAtPile(pile);
  await __felt.throwAtPile(pile);
  b.off('update', watch);
  const cards = pile.cards;
  return JSON.stringify({ rose, count: cards.length, down: cards.every(c => c.z === 0), angled: cards.some(c => c.angle !== 0) });
})()`));
check(thrown.rose > 20, `a thrown card leaves the felt on the way (${thrown.rose.toFixed(1)} units up)`);
check(thrown.count === 2 && thrown.down, 'and comes down onto the pile it was thrown at');
check(thrown.angled, 'a messy pile takes it at its own crooked angle');

// --- lighting: a light on the board changes what is drawn -------------------
console.log('\nlighting');
await open('lighting.html', '!!window.__felt?.held');
const lightRun = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const L = f.light; const h = f.held;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  f.stopRocking();
  // Its art finished: a board that waits for art draws no card till then.
  for (let i = 0; i < 120 && !(h.revealed && f.row.every(c => c.revealed)); i++) await wait(250);
  await wait(200);
  // Mean brightness of a square of the board, in board units.
  const lum = (x, y, r) => { const c = b.snapshotCanvas(); const s = c.width / b.width;
    const px = c.getContext('2d').getImageData(Math.round((x - r) * s), Math.round((y - r) * s),
      Math.round(2 * r * s), Math.round(2 * r * s)).data;
    let t = 0; for (let i = 0; i < px.length; i += 4) t += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return t / (px.length / 4); };
  const plain = { name: 'plain', specular: 0, shininess: 1, metallic: 0, sheen: 0, grain: 0, grainScale: 1, foil: 0 };
  // Its back, which is the same all over: only the light changes it.
  h.setFaceUp(false); h.angle = 0; h.turn = 0; h.z = 40;
  L.set({ azimuth: 0, elevation: 35, ambient: 0.3, material: f.stocks.matte });
  const tipped = async () => { const out = {}; for (const tilt of [0.6, -0.6]) { h.tilt = tilt; await wait(30);
    out[tilt > 0 ? 'towards' : 'away'] = lum(h.x, h.y, 8); } return out; };
  const lit = await tipped();
  const calls = b.renderer.drawCalls;
  L.off(); const unlit = await tipped(); L.set();
  // Flat on the felt, under a light with no highlight: as painted.
  h.tilt = 0; h.z = 0; h.setFaceUp(true); L.material = plain; L.off(); await wait(30);
  const flatOff = lum(h.x - 14, h.y + 26, 5);
  L.set(); await wait(30);
  const flatOn = lum(h.x - 14, h.y + 26, 5);
  // Up in the air, lit from the right and then from the left: the shadow is
  // on the far side from the light each time, and further off than the halo.
  h.z = 80; L.material = f.stocks.matte;
  const sides = {};
  for (const az of [90, -90]) { L.set({ azimuth: az, elevation: 45 }); await wait(30);
    sides[az] = { left: lum(h.x - 82, h.y, 10), right: lum(h.x + 82, h.y, 10) }; }
  // Through a lost context: the light is uniforms, set every frame.
  const gl = b.renderer.gl; const ext = gl.getExtension('WEBGL_lose_context');
  ext.loseContext(); await wait(300); ext.restoreContext(); await wait(1500);
  h.z = 40; h.setFaceUp(false); L.set({ azimuth: 0, elevation: 35, material: f.stocks.matte });
  const restored = await tipped();
  h.setFaceUp(true); h.tilt = 0.35; h.z = 60; L.set({ azimuth: -35, elevation: 50, ambient: 0.45, material: f.stocks.linen });
  return JSON.stringify({ lit, unlit, calls, flatOff, flatOn, sides, restored, lost: gl.isContextLost() });
})()`));
const r1 = (v) => v.toFixed(1);
check(lightRun.lit.towards > lightRun.lit.away * 1.3,
  `lit, a card tipped towards the light is brighter than one tipped away (${r1(lightRun.lit.towards)} / ${r1(lightRun.lit.away)})`);
check(Math.abs(lightRun.unlit.towards - lightRun.unlit.away) < Math.abs(lightRun.lit.towards - lightRun.lit.away) * 0.25,
  `unlit, the same two tips are nearly the same (${r1(lightRun.unlit.towards)} / ${r1(lightRun.unlit.away)})`);
check(Math.abs(lightRun.flatOn - lightRun.flatOff) < 2,
  `a card lying flat under a light is drawn as painted (${r1(lightRun.flatOn)} lit, ${r1(lightRun.flatOff)} unlit)`);
check(lightRun.sides[90].left < lightRun.sides[90].right - 4 && lightRun.sides[-90].right < lightRun.sides[-90].left - 4,
  `a card in the air casts its shadow away from the light (from the right: ${r1(lightRun.sides[90].left)} left / ${r1(lightRun.sides[90].right)} right)`);
check(lightRun.calls === 1, `lit, it is still one draw call (${lightRun.calls})`);
check(!lightRun.lost && lightRun.restored.towards > lightRun.restored.away * 1.3,
  `the light survives a lost WebGL context (${r1(lightRun.restored.towards)} / ${r1(lightRun.restored.away)})`);

console.log('');
// --- flicking: let go while moving and it keeps going ----------------------
console.log('\nflicking');
await open('flick.html', '__felt?.deck?.().length === 52');
const flick = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const rect = b.canvas.getBoundingClientRect();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 11, bubbles: true }));
  // A flick up the table.
  const first = f.deck().at(-1); const x0 = first.x, y0 = first.y;
  fire('pointerdown', x0, y0); await wait(200);
  for (let i = 1; i <= 6; i++) { fire('pointermove', x0, y0 - i * 22); await wait(12); }
  fire('pointerup', x0, y0 - 132);
  let highest = 0; const t0 = performance.now();
  while (performance.now() - t0 < 4000) { highest = Math.max(highest, first.shown.z); await wait(16); }
  const flung = { travelled: Math.hypot(first.x - x0, first.y - y0), z: first.shown.z, highest,
    inside: first.x > 0 && first.x < b.width && first.y > 0 && first.y < b.height,
    score: document.getElementById('score').textContent };
  // Moved, stopped, then let go: set down where it is.
  const second = f.deck().at(-1);
  fire('pointerdown', second.x, second.y); await wait(150);
  for (let i = 1; i <= 4; i++) { fire('pointermove', second.x, second.y - 20); await wait(12); }
  const placedAt = { x: second.x, y: second.y };
  await wait(300);
  fire('pointerup', placedAt.x, placedAt.y); await wait(1200);
  const placed = Math.hypot(second.x - placedAt.x, second.y - placedAt.y);
  // Flicked on ice, then caught while it slides.
  document.getElementById('surface').click();
  const third = f.deck().at(-1); const x3 = third.x, y3 = third.y;
  fire('pointerdown', x3, y3); await wait(150);
  for (let i = 1; i <= 6; i++) { fire('pointermove', x3 - i * 6, y3 - i * 10); await wait(12); }
  fire('pointerup', x3 - 36, y3 - 60);
  await wait(250);
  fire('pointerdown', third.x, third.y);
  const caughtAt = { x: third.x, y: third.y };
  await wait(600);
  const drift = Math.hypot(third.x - caughtAt.x, third.y - caughtAt.y);
  fire('pointerup', third.x, third.y);
  return JSON.stringify({ ...flung, placed, drift });
})()`));
check(flick.travelled > 150 && flick.inside, `a card flicked up the table keeps going, and stays on it (${Math.round(flick.travelled)} units)`);
check(flick.z === 0 && /points|Missed/.test(flick.score), `and comes to rest flat, scored ("${flick.score.split(' -')[0]}")`);
check(flick.placed < 2, `a card that stopped before it was let go is set down, not flung (${flick.placed.toFixed(1)} units)`);
check(flick.drift < 3, `a card grabbed while it slides is caught where it is (${flick.drift.toFixed(1)} units of drift)`);


const walls = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const rect = b.canvas.getBoundingClientRect();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 12, bubbles: true }));
  const flickFrom = async (card, dx, dy, ms = 2500, grip = 0, moves = 6) => {
    const x0 = card.x + grip, y0 = card.y + grip; let over = 0, high = 0, angles = [];
    let lastX = card.x, back, afterWall = 0;
    fire('pointerdown', x0, y0); await wait(150);
    for (let i = 1; i <= moves; i++) { fire('pointermove', x0 + i * dx, y0 + i * dy); await wait(12); }
    const was = card.card.faceUp;
    fire('pointerup', x0 + moves * dx, y0 + moves * dy);
    const t = performance.now(); const off = b.on('render', () => {
      const p = card.shown; over = Math.max(over, Math.abs(p.tilt), Math.abs(p.turn)); high = Math.max(high, p.z); angles.push(p.angle);
      // Off the right-hand wall: from when it starts back, how far it turns.
      if (back === undefined && p.x < lastX - 0.5 && dx > 0) back = p.angle;
      if (back !== undefined) afterWall = Math.max(afterWall, Math.abs(p.angle - back));
      lastX = p.x; });
    while (performance.now() - t < ms) await wait(30);
    b.off('render', off);
    return { over, high, turnedOver: card.card.faceUp !== was, spun: Math.max(...angles) - Math.min(...angles), afterWall, z: card.shown.z,
      flat: Math.abs(Math.sin(card.shown.tilt)) + Math.abs(Math.sin(card.shown.turn)) };
  };
  // 3D: straight up into the top wall, hard.
  document.getElementById('surface').textContent.includes('ice') && document.getElementById('surface').click();
  const up = await flickFrom(f.deck().at(-1), 0, -30);
  // 2D: the same board with its lens off, sideways into a wall.
  b.setFov(0);
  // Held by a corner, so it arrives turned and meets the wall corner first.
  // Let go well short of the wall, so it has room to build up speed into it.
  // Synthetic pointer events under software GL do not always come out fast
  // enough to reach the wall: up to three tries, each with a fresh card.
  let side;
  for (let k = 0; k < 3; k++) {
    side = await flickFrom(f.deck().at(-1), 32, -8, 2500, 16, 3);
    if (side.afterWall > 10) break;
  }
  b.setFov(45);
  return JSON.stringify({ up, side });
})()`));
check(walls.up.high > 12 && walls.up.over > 1.4 && walls.up.z === 0 && walls.up.flat < 1e-6,
  `in 3D a wall knocks a flicked card up and over end over end (${walls.up.high.toFixed(0)} units up, ${(walls.up.over / Math.PI).toFixed(2)} half turns at most), and it lands flat`);
// Height only: the pick-up's own turn face up (flipCard) may still be
// finishing as it is let go, and that is not the flick.
check(walls.side.high === 0 && walls.side.afterWall > 10,
  `in 2D it stays on the felt and a corner hit sets it spinning off the wall (${walls.side.afterWall.toFixed(0)} degrees after the wall)`);
// --- painted tables: casino layouts painted on the felt --------------------
console.log('\npainted tables');
await open('tables.html', '__felt?.marks?.().length > 10');
const painted = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  /** How many pixels in a box are near a colour. */
  const near = (x, y, w, h, [R, G, B]) => {
    const c = b.snapshotCanvas(); const r = c.width / b.width;
    const px = c.getContext('2d').getImageData(x * r, y * r, w * r, h * r).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - R) + Math.abs(px[i + 1] - G) + Math.abs(px[i + 2] - B) < 90) n++;
    return n;
  };
  const out = {};
  for (const name of ['blackjack', 'baccarat', 'parlour', 'borders', 'craps']) {   // craps last: its paint is sampled below
    f.show(name);
    await wait(1500);
    const marks = f.marks();
    out[name] = { marks: marks.length, drawn: marks.every(m => m.region && m.width > 0 && m.height > 0),
      under: marks.every(m => m.depth < 0 && !m.interactive), cards: f.table().cards.length, pages: b.atlas.pages.length };
  }
  // Craps: COME is red, the point numbers yellow, the pass line white.
  out.paint = { red: near(140, 175, 200, 40, [210, 48, 44]), yellow: near(90, 75, 360, 30, [242, 194, 48]),
    white: near(140, 405, 200, 30, [243, 239, 226]) };
  return JSON.stringify(out);
})()`));
check(['blackjack', 'baccarat', 'craps'].every(n => painted[n].drawn && painted[n].under && painted[n].marks > 15),
  `blackjack, baccarat and craps are painted, under the cards and out of the way of drags (${['blackjack', 'baccarat', 'craps'].map(n => painted[n].marks).join(', ')} marks)`);
check(painted.parlour.drawn && painted.parlour.under && painted.parlour.marks > 15,
  `the parlour table is painted in old patterns: guilloché, Greek key, seigaiha (${painted.parlour.marks} marks)`);
check(painted.borders.drawn && painted.borders.under && painted.borders.marks >= 9 * 2 + 12,
  `and every running border the engine draws is painted, framed in rope (${painted.borders.marks} marks)`);
check(painted.blackjack.cards === 52 && painted.baccarat.cards === 52 && painted.parlour.cards === 52, 'and the card tables deal onto their layouts');
check(painted.paint.red > 200 && painted.paint.yellow > 200 && painted.paint.white > 200,
  `the paint is the colour asked for: red, yellow and white on the craps layout (${painted.paint.red}/${painted.paint.yellow}/${painted.paint.white} px)`);
const layoutPages = Math.max(...['blackjack', 'baccarat', 'craps', 'parlour', 'borders'].map(n => painted[n].pages));
check(layoutPages <= 3, `and every layout fits the atlas in ${layoutPages} page(s)`);
// --- pieces: chips, a dealer button, dice and a peg board ------------------
console.log('\npieces');
await open('pieces.html', '__felt?.pieces?.stacks?.length > 8');
const pcs = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const P = f.pieces;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const shot = () => { const c = b.snapshotCanvas(); return { pen: c.getContext('2d'), r: c.width / b.width }; };
  const rgb = (css) => { const n = parseInt(css.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const out = {};
  // Every denomination, one chip each, sampled in the ring of body colour
  // between the inlay and the dashed ring.
  const probes = P.set.denominations.map((d, i) => P.stack({ id: 'probe-' + d.value, x: 40 + i * 64, y: 730, chips: [d.value] }));
  await wait(300);
  { const { pen, r } = shot();
    out.colours = probes.map((s) => {
      const chip = s.top; const want = rgb(P.set.of(chip.value).color); const R = chip.width / 2;
      const x0 = Math.floor((chip.x - R) * r); const y0 = Math.floor((chip.y - R) * r);
      const n = Math.ceil(2 * R * r) + 2; let ring = 0, near = 0;
      const px = pen.getImageData(x0, y0, n, n).data;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        // From the chip's true middle, which is not on a pixel.
        const d = Math.hypot(x0 + x + 0.5 - chip.x * r, y0 + y + 0.5 - chip.y * r) / (R * r);
        if (d < 0.57 || d > 0.62) continue;
        ring++; const i = (y * n + x) * 4;
        // Nearest, of all the set's colours, to its own.
        const dist = (c) => Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]);
        if (P.set.denominations.every((o) => o.value === chip.value || dist(rgb(o.color)) > dist(want))) near++;
      }
      return { value: chip.value, share: near / ring };
    }); }
  out.chipRegions = new Set(P.stacks.flatMap(s => s.chips).map(c => c.face)).size;
  out.chipValues = new Set(P.stacks.flatMap(s => s.chips).map(c => c.value)).size;
  for (const s of probes) P.removeStack(s);
  // A bet, a collect, a payout: every stack's value, and the chips really there.
  const value = (s) => s.value;
  const banks = [...f.banks.values()]; const bets = [...f.bets.values()];
  const total = () => [...P.stacks].reduce((n, s) => n + s.value, 0);
  const before = { banks: banks.map(value), total: total() };
  const westBefore = f.banks.get('west').values.slice();
  await f.bet();
  await wait(200);
  const inPlace = (s) => s.chips.every((c, i) => { const p = s.place(i); return Math.hypot(c.x - p.x, c.y - p.y) < 0.01 && c.shown.z === 0; });
  out.bet = { banks: banks.map(value), bets: bets.map(value), total: total(), placed: bets.every(inPlace) && banks.every(inPlace),
    westBroke: !westBefore.includes(5) && f.bets.get('west').values.join() === '5,5,5' };
  await f.collect();
  await wait(200);
  out.collect = { bets: bets.map(value), pot: f.pot.value, potChips: f.pot.count, placed: inPlace(f.pot) };
  // The pot's chips drawn in the pot: its pixels are chips, not felt.
  const winner = f.seats[(1 + 0) % f.seats.length].id;
  const winnerBefore = f.banks.get(winner).value;
  await f.win();
  await wait(200);
  out.win = { pot: f.pot.value, gained: f.banks.get(winner).value - winnerBefore, total: total(), placed: inPlace(f.banks.get(winner)) };
  out.before = before;
  // The dealer button moves round the seats.
  const d0 = { x: f.dealerButton.x, y: f.dealerButton.y };
  f.nextHand(); await wait(1200);
  out.button = { moved: Math.hypot(f.dealerButton.x - d0.x, f.dealerButton.y - d0.y), at: Math.hypot(f.dealerButton.x - f.seats[1].button.x, f.dealerButton.y - f.seats[1].button.y) };
  // The dice: told 6 and 2, they land on 6 and 2 - by their orientation, and
  // by counting the pips on the top face in the picture.
  out.dice = [];
  for (const want of [[6, 2], [1, 5], [3, 4]]) {
    const got = await f.roll(want);
    await wait(150);
    const { pen, r } = shot();
    const pips = f.dice.map((die) => {
      const top = die.faces.get(die.showing);
      const k = 1 / (1 - top.z / b.distance);       // the lens, around the face's own middle
      const half = die.size * 0.47 * k;
      const w = Math.round(2 * half * r);
      const px = pen.getImageData((top.x - half) * r, (top.y - half) * r, w, w).data;
      const light = new Uint8Array(w * w);
      for (let i = 0; i < w * w; i++) light[i] = px[i * 4] > 200 && px[i * 4 + 1] > 190 && px[i * 4 + 2] > 180 ? 1 : 0;
      let blobs = 0; const seen = new Uint8Array(w * w);
      for (let i = 0; i < w * w; i++) {
        if (!light[i] || seen[i]) continue;
        let size = 0; const stack = [i]; seen[i] = 1;
        while (stack.length) { const j = stack.pop(); size++; const x = j % w, y = (j / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = ny * w + nx;
            if (nx >= 0 && ny >= 0 && nx < w && ny < w && light[n] && !seen[n]) { seen[n] = 1; stack.push(n); } } }
        if (size > 6) blobs++;
      }
      return blobs;
    });
    out.dice.push({ want, got, showing: f.dice.map(d => d.showing), pips, flat: f.dice.every(d => Math.abs(d.z - d.size / 2) < 1e-6) });
  }
  // The peg board: red pegs 5 then 7 - the back peg leapfrogs to 12.
  f.crib.reset();
  const m1 = await f.peg(0, 5); const m2 = await f.peg(0, 7); const m3 = await f.peg(1, 9);
  await wait(300);
  const pegAt = (p, i) => { const peg = f.crib.pegs[p][i]; return { x: peg.x, y: peg.y }; };
  const off = (p, i, hole) => { const at = pegAt(p, i); const h = f.crib.hole(p, hole); return Math.hypot(at.x - h.x, at.y - h.y); };
  const red = f.crib.state(0).pegs; const blue = f.crib.state(1).pegs;
  { const { pen, r } = shot();
    const h = f.crib.hole(0, 12); const px = pen.getImageData(h.x * r - 1, h.y * r - 1, 3, 3).data;
    out.pegPixel = [px[16], px[17], px[18]]; }
  out.pegs = { red, blue, moves: [m1, m2, m3].map(m => [m.peg, m.from, m.to]),
    off: Math.max(off(0, 0, red[0]), off(0, 1, red[1]), off(1, 0, blue[0]), off(1, 1, blue[1])), scores: [f.crib.score(0), f.crib.score(1)] };
  // Save, change everything, restore: the same plain data back.
  f.save(); const saved = JSON.stringify(P.state());
  await f.bet(); await f.peg(1, 4); f.dice[0].set(1);
  f.restore(); await wait(200);
  out.restored = JSON.stringify(P.state()) === saved;
  if (!out.restored) out.diff = [saved, JSON.stringify(P.state())];
  b.render();
  out.draw = { calls: b.renderer.drawCalls, instances: b.renderer.instanceCount, pages: b.atlas.pages.length, painted: P.board.services.get('piece-art').painted };
  return JSON.stringify(out);
})()`));
check(pcs.colours.every((c) => c.share > 0.8),
  `every chip is drawn in its denomination's colour (${pcs.colours.map((c) => `${c.value}: ${Math.round(c.share * 100)}%`).join(', ')})`);
check(pcs.chipRegions === pcs.chipValues, `and chips of one value share one picture (${pcs.chipRegions} pictures for ${pcs.chipValues} values)`);
check(pcs.bet.banks.every((v, i) => v === pcs.before.banks[i] - 15) && pcs.bet.bets.every((v) => v === 15) && pcs.bet.total === pcs.before.total && pcs.bet.placed,
  `a bet takes 15 from every bank to its circle, nothing lost, every chip in its place (${pcs.bet.banks.join(', ')})`);
check(pcs.bet.westBroke, 'a bank with no fives breaks a 25 to make 15');
check(pcs.collect.bets.every((v) => v === 0) && pcs.collect.pot === 60 && pcs.collect.placed,
  `collecting sweeps every bet into the pot (${pcs.collect.pot} in ${pcs.collect.potChips} chips)`);
check(pcs.win.pot === 0 && pcs.win.gained === 60 && pcs.win.total === pcs.before.total && pcs.win.placed,
  `and the pot goes to the winner, stacked (${pcs.win.gained} gained)`);
check(pcs.button.moved > 50 && pcs.button.at < 0.5, `the dealer button moves to the next seat (${pcs.button.at.toFixed(2)} units off it)`);
check(pcs.dice.every((d) => d.got.join() === d.want.join() && d.showing.join() === d.want.join() && d.flat),
  `dice land flat on the faces asked for (${pcs.dice.map((d) => d.showing.join('+')).join(', ')})`);
check(pcs.dice.every((d) => d.pips.join() === d.want.join()),
  `and the pips counted in the picture agree (${pcs.dice.map((d) => d.pips.join('+')).join(', ')})`);
check(pcs.pegs.red.join() === '12,5' && pcs.pegs.blue.join() === '0,9' && pcs.pegs.off < 0.01 && pcs.pegs.scores.join() === '12,9',
  `pegs leapfrog into the right holes (red ${pcs.pegs.red.join('/')}, blue ${pcs.pegs.blue.join('/')}, ${pcs.pegs.off.toFixed(3)} units off)`);
check(pcs.pegPixel[0] > 120 && pcs.pegPixel[0] > pcs.pegPixel[2] * 1.6, `and the red peg is drawn in hole 12 (rgb ${pcs.pegPixel.join(',')})`);
if (!pcs.restored) console.log(pcs.diff.join('\n'));
check(pcs.restored, 'saving and restoring gives back the same plain-data state');
check(pcs.draw.calls === 1 && pcs.draw.pages <= 2,
  `chips, tokens, dice and the peg board in one draw call and ${pcs.draw.pages} atlas page(s) (${pcs.draw.instances} instances, ${pcs.draw.painted} piece pictures)`);
// --- magnetic stacks: flicked near its suit, it is drawn in -----------------
console.log('\nmagnetic stacks');
await open('magnets.html', '__felt?.deck?.().length === 52');
const mag = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const rect = b.canvas.getBoundingClientRect();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 13, bubbles: true }));
  const count = () => f.stacks().reduce((n, s) => n + s.count, 0);
  /** Carries the top card to (x, y), then either sets it down or flicks it by (dx, dy) a move. */
  const carry = async (to, flick) => {
    const card = f.deck().at(-1); let x = card.x, y = card.y;
    fire('pointerdown', x, y); await wait(150);
    for (let i = 1; i <= 10; i++) { fire('pointermove', x + (to.x - x) * i / 10, y + (to.y - y) * i / 10); await wait(16); }
    x = to.x; y = to.y; await wait(250);
    if (flick) { for (let i = 1; i <= 6; i++) { fire('pointermove', x + i * flick.x, y + i * flick.y); await wait(12); }
      fire('pointerup', x + 6 * flick.x, y + 6 * flick.y); }
    else fire('pointerup', x, y);
    const t = performance.now();
    while (performance.now() - t < 3000 && f.loose().includes(card) === false && count() === 0) await wait(30);
    await wait(1800);
    return card;
  };
  const stackOf = (card) => f.stacks().find(s => s.suit === card.card.suit);
  // Set down a little off its own stack: drawn the rest of the way, squared up.
  let card = f.deck().at(-1); let own = stackOf(card);
  await carry({ x: own.x + 40, y: own.y + 45 });
  const setDown = { count: count(), dx: card.x - own.x, dy: card.y - own.y, angle: card.angle, z: card.shown.z, faceUp: card.card.faceUp };
  // Set down on another suit's stack: not pulled.
  card = f.deck().at(-1);
  const other = f.stacks().find(s => s.suit !== card.card.suit);
  await carry({ x: other.x + 30, y: other.y + 40 });
  const wrong = { count: count(), loose: f.loose().includes(card), off: Math.hypot(card.x - other.x, card.y - other.y) };
  // Flicked at its stack from a card's length below it, off to one side.
  card = f.deck().at(-1); own = stackOf(card);
  const before = count();
  await carry({ x: own.x + 25, y: own.y + 220 }, { x: -2, y: -12 });
  const flicked = { gained: count() - before, d: Math.hypot(card.x - own.x, card.y - own.y), angle: card.angle };
  return JSON.stringify({ setDown, wrong, flicked });
})()`));
check(mag.setDown.count === 1 && Math.hypot(mag.setDown.dx, mag.setDown.dy) < 1 && Math.abs(mag.setDown.angle % 360) < 0.01 && mag.setDown.faceUp,
  `a card set down near its suit's stack is drawn onto it and squared up (${Math.hypot(mag.setDown.dx, mag.setDown.dy).toFixed(2)} units off)`);
check(mag.wrong.count === 1 && mag.wrong.loose && mag.wrong.off > 30,
  `another suit's stack does not pull it (${mag.wrong.off.toFixed(0)} units away, loose)`);
check(mag.flicked.gained === 1 && mag.flicked.d < 3,
  `a card flicked at its stack curves in and lands on it (${mag.flicked.d.toFixed(1)} units off)`);
// --- the code panel: each demo shows the code it runs -----------------------
const panel = JSON.parse(await evaluate(`(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const toggle = document.querySelector('.felt-code-toggle'); const aside = document.querySelector('.felt-code');
  const was = aside.hidden; toggle.click();
  const t = performance.now(); while (!aside.querySelector('pre') && performance.now() - t < 3000) await wait(50);
  return JSON.stringify({ was, open: !aside.hidden, titles: [...aside.querySelectorAll('summary')].map(s => s.textContent),
    code: aside.querySelector('pre')?.textContent ?? '', api: [...aside.querySelectorAll('.api')].map(s => s.textContent) });
})()`));
check(panel.was && panel.open && panel.titles.length >= 2 && panel.code.includes('accepts:') && panel.api.includes('createTable'),
  `the Code button opens the demo's own source, in regions (${panel.titles.length}: "${panel.titles[0]}"…), felt's names marked`);

// --- the tour: a long page, a board per idea, its code inline ---------------
console.log('\nthe tour');
await open('tour.html', '__felt?.boards?.length === 9');
const tour = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  let t = performance.now();
  while ([...document.querySelectorAll('pre[data-region]')].some(p => !p.textContent) && performance.now() - t < 4000) await wait(50);
  const regions = [...document.querySelectorAll('pre[data-region]')].map(p => ({ title: p.dataset.region, lines: p.textContent.split('\\n').length }));
  // A drag from the first column onto the second, on the drag board.
  const b = f.board; b.canvas.scrollIntoView({ block: 'center' }); await wait(300);
  const rect = b.canvas.getBoundingClientRect();
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 14, bubbles: true }));
  const before = f.columns();
  const from = { x: 100, y: 70 + 24 * (before[0] - 1) + 20 };
  fire('pointerdown', from.x, from.y); await wait(120);
  for (let i = 1; i <= 8; i++) { fire('pointermove', from.x + 140 * i / 8, from.y - 20 * i / 8); await wait(30); }
  await wait(200); fire('pointerup', from.x + 140, from.y - 20); await wait(800);
  // Every board but the blank one drew cards.
  t = performance.now();
  while (f.boards.slice(1).some(x => x.renderer.instanceCount === 0) && performance.now() - t < 5000) await wait(100);
  return JSON.stringify({ regions, before, after: f.columns(), drawn: f.boards.map(x => x.renderer.instanceCount) });
})()`));
check(tour.regions.length === 10 && tour.regions.every(r => r.lines >= 2),
  `the tour shows all ten sections' code, from its own source (${tour.regions.map(r => r.lines).join(', ')} lines)`);
check(tour.drawn[0] === 0 && tour.drawn.slice(1).every(n => n > 0), `nine boards on one page, the first blank and the rest drawing (${tour.drawn.join(', ')})`);
check(tour.after[0] === tour.before[0] - 1 && tour.after[1] === tour.before[1] + 1,
  `a card dragged off one column lands on the next (${tour.before.join('·')} → ${tour.after.join('·')})`);

// --- solitaire: a game written as zone rules on a Table ---------------------
console.log('\nsolitaire');
await open('solitaire.html', '__felt?.columns?.length === 7');
const sol = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const rect = b.canvas.getBoundingClientRect();
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 15, bubbles: true }));
  // Held by the strip of it that shows above the next card down, as a player would.
  const drag = async (card, to) => {
    const g = -32, x0 = card.x, y0 = card.y + g;
    fire('pointerdown', x0, y0); await wait(120);
    const t = to.next(); for (let i = 1; i <= 8; i++) { fire('pointermove', x0 + (t.x - x0) * i / 8, y0 + (t.y + g - y0) * i / 8); await wait(30); }
    await wait(150); fire('pointerup', t.x, t.y + g); await wait(900);
  };
  while (f.table.busy) await wait(100);
  const dealt = { sizes: f.columns.map(c => c.size), tops: f.columns.every(c => c.top.card.faceUp), stock: f.stock.size,
    under: f.columns.every(c => c.cards.slice(0, -1).every(x => !x.card.faceUp)) };
  // A column top dropped where the rules say no: sent back.
  const a = f.columns[0], z = f.columns.find(c => c !== a && !c.accepts([a.top.card], a));
  const card = a.top; await drag(card, z);
  const refused = { stayed: a.top === card, size: z.size };
  // Deal seeded games until one has a legal column-to-column move, and make it by hand.
  let legal;
  for (let s = 1; s <= 12 && !legal; s++) {
    await f.deal(s);
    for (const from of f.columns) for (const to of f.columns)
      if (!legal && from !== to && to.accepts([from.top.card], from)) legal = { from, to, card: from.top, below: from.cards.at(-2) };
  }
  let made = null;
  if (legal) { const before = legal.to.size; await drag(legal.card, legal.to); await wait(500);
    made = { landed: legal.to.top === legal.card && legal.to.size === before + 1, uncovered: !legal.below || legal.below.card.faceUp }; }
  // The stock: a tap turns one onto the waste.
  const s = f.stock.top; fire('pointerdown', s.x, s.y); fire('pointerup', s.x, s.y); await wait(700);
  const tapped = { waste: f.waste.size, up: f.waste.top?.card.faceUp };
  // Each foundation takes only its own suit: the ace of hearts on the spades'
  // is refused, on the hearts' it goes, and the two of hearts follows it.
  const dataOf = (id) => ({ ...f.table.card(id).card, faceUp: true });
  const [spades, hearts] = f.foundations;
  const suits = { aceOnSpades: spades.accepts([dataOf('hearts-A')]), aceOnHearts: hearts.accepts([dataOf('hearts-A')]),
    spadeAce: spades.accepts([dataOf('spades-A')]), twoFirst: hearts.accepts([dataOf('hearts-2')]) };
  // A run: the queen and jack on one column go together onto a king - set
  // up with sync, the way a saved game or a server's state would be shown.
  const setup = { 'column-0': ['clubs-K'], 'column-1': ['diamonds-9', 'hearts-Q', 'spades-J'] };
  const named = new Set(Object.values(setup).flat());
  const state = Object.fromEntries([f.stock, f.waste, ...f.foundations, ...f.columns].map(z => [z.id, []]));
  await f.table.sync({ ...state, ...setup, stock: f.table.cards.map(c => c.card.id).filter(id => !named.has(id)) }, { instant: true });
  for (const id of ['clubs-K', 'hearts-Q', 'spades-J']) f.table.card(id).setFaceUp(true);
  f.table.card('diamonds-9').setFaceUp(false);
  await wait(300);
  await drag(f.table.card('hearts-Q'), f.columns[0]);
  await wait(600);
  const run = { onKing: f.columns[0].cards.map(c => c.card.id).join(), left: f.columns[1].cards.map(c => c.card.id + (c.card.faceUp ? '+' : '-')).join() };
  return JSON.stringify({ dealt, refused, made, waste: tapped.waste, wasteUp: tapped.up, run, suits });
})()`));
check(JSON.stringify(sol.dealt.sizes) === '[1,2,3,4,5,6,7]' && sol.dealt.tops && sol.dealt.under && sol.dealt.stock === 24,
  `solitaire deals seven columns, each with its last card turned up, and 24 in the stock`);
check(sol.refused.stayed, 'a card dropped where the rules say no goes back to its column');
check(sol.made && sol.made.landed && sol.made.uncovered, `a legal move made by hand lands, and the card it uncovers turns up`);
check(sol.waste === 1 && sol.wasteUp, 'a tap on the stock turns a card onto the waste, face up');
check(!sol.suits.aceOnSpades && sol.suits.aceOnHearts && sol.suits.spadeAce && !sol.suits.twoFirst,
  'each foundation takes only its own suit, from the ace up');
check(sol.run.onKing === 'clubs-K,hearts-Q,spades-J' && sol.run.left === 'diamonds-9+',
  `a run picked up by its first card moves together, and uncovers the card under it (${sol.run.onKing} / ${sol.run.left})`);

// --- undo, redo, and a game saved across a reload ---------------------------
console.log('\nundo and saves');
// The arrangement as the player sees it: each zone's cards, and which way up.
const SOL_STATE = `JSON.stringify(Object.fromEntries(__felt.table.zones.map(z => [z.id, z.cards.map(c => c.card.id + (c.card.faceUp ? '+' : '-'))])))`;
// Cards not sitting where their zone lays them: "right numbers, wrong screen".
const SOL_ASTRAY = `__felt.table.zones.reduce((n, z) => { const p = z.places(z.size);
  return n + z.cards.filter((c, i) => Math.hypot(c.x - p[i].x, c.y - p[i].y) > 1 || Math.abs(c.angle - p[i].angle) > 0.01).length; }, 0)`;
const SOL_QUIET = `(async () => { const f = __felt; const w = (ms) => new Promise(r => setTimeout(r, ms)); const t = performance.now();
  while ((f.table.busy || f.table.cards.some(c => f.table.isMoving(c) || f.animator.busy(c, 'flip') || f.animator.busy(c, 'move')))
    && performance.now() - t < 15000) await w(100);
  await w(250); return true; })()`;
const undoRun = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const quiet = () => ${SOL_QUIET};
  const state = () => ${SOL_STATE};
  const astray = () => ${SOL_ASTRAY};
  const rect = b.canvas.getBoundingClientRect();
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const fire = (type, x, y) => b.canvas.dispatchEvent(new PointerEvent(type, { ...page(x, y), pointerId: 16, bubbles: true }));
  const drag = async (card, to) => {
    const g = -32, x0 = card.x, y0 = card.y + g;
    fire('pointerdown', x0, y0); await wait(120);
    const t = to.next(); for (let i = 1; i <= 8; i++) { fire('pointermove', x0 + (t.x - x0) * i / 8, y0 + (t.y + g - y0) * i / 8); await wait(30); }
    await wait(150); fire('pointerup', t.x, t.y + g); await wait(900);
  };
  // A deal with a column-to-column move that uncovers a face-down card.
  let legal;
  for (let s = 1; s <= 40 && !legal; s++) {
    await f.deal(s);
    for (const from of f.columns) for (const to of f.columns)
      if (!legal && from !== to && from.size > 1 && to.accepts([from.top.card], from)) legal = { from, to, under: from.cards.at(-2) };
  }
  if (!legal) return JSON.stringify({ legal: false });
  await quiet();
  const dealt = state(); const dealtScore = document.getElementById('score').textContent;
  const s0 = f.stock.top; fire('pointerdown', s0.x, s0.y); fire('pointerup', s0.x, s0.y); await wait(700);
  await drag(legal.from.top, legal.to);
  await quiet();
  const played = state(); const steps = f.history.index;
  const uncovered = legal.under.card.faceUp; const playedScore = document.getElementById('score').textContent;
  let undos = 0; while (await f.history.undo()) undos++;
  await quiet();
  const undone = { same: state() === dealt, astray: astray(), under: legal.under.card.faceUp, score: document.getElementById('score').textContent === dealtScore,
    undo: document.getElementById('undo').disabled, redo: !document.getElementById('redo').disabled };
  let redos = 0; while (await f.history.redo()) redos++;
  await quiet();
  const redone = { same: state() === played, astray: astray(), score: document.getElementById('score').textContent === playedScore };
  // Undone while the card is still in the air: it turns round and goes back.
  const s1 = f.stock.top; fire('pointerdown', s1.x, s1.y); fire('pointerup', s1.x, s1.y); await wait(40);
  const midFlight = await f.history.undo(); await quiet();
  const backMidFlight = state() === played && astray() === 0;
  return JSON.stringify({ legal: true, steps, uncovered, undos, undone, redos, redone, midFlight, backMidFlight, played,
    log: f.history.log().map(m => m.by + ':' + m.cards.join('+') + ':' + m.from + '>' + m.to) });
})()`));
check(undoRun.legal && undoRun.steps === 2 && undoRun.uncovered,
  `two plays are two steps: a tap on the stock, and a drag that turns up the card under it (${undoRun.log?.join(', ')})`);
check(undoRun.undos === 2 && undoRun.undone.same && !undoRun.undone.under && undoRun.undone.astray === 0,
  `undo puts back the deal exactly - every zone, every side, the uncovered card face down again (${undoRun.undone.astray} astray)`);
check(undoRun.undone.score && undoRun.undone.undo && undoRun.undone.redo, 'and the score with it, Undo greyed out and Redo lit');
check(undoRun.redos === 2 && undoRun.redone.same && undoRun.redone.astray === 0 && undoRun.redone.score,
  `redo plays both again, to the same arrangement and score (${undoRun.redone.astray} astray)`);
check(undoRun.midFlight && undoRun.backMidFlight, 'a move undone while its card is still in the air lands back where it was');
// Reloaded, the game comes back where it was, with no deal and its history.
await send('Page.reload');
await until('__felt?.columns?.length === 7');
const resumedAt = JSON.parse(await evaluate(`JSON.stringify({ ok: __felt.resumed.ok, busy: __felt.table.busy, state: ${SOL_STATE} })`));
await evaluate(SOL_QUIET);
const resumed = JSON.parse(await evaluate(`JSON.stringify({ state: ${SOL_STATE}, astray: ${SOL_ASTRAY}, index: __felt.history.index,
  undo: !document.getElementById('undo').disabled })`));
check(resumedAt.ok && !resumedAt.busy && resumedAt.state === undoRun.played,
  'reloaded, the game resumes at once where it was - no deal, the same zones and sides');
check(resumed.state === undoRun.played && resumed.astray === 0 && resumed.index === 2 && resumed.undo,
  `and every card is in its place, with the moves still there to undo (${resumed.astray} astray)`);
// A save that will not read: a new game, not an error.
await send('Page.navigate', { url: `${host}/stacks.html` });
await until('!!window.__felt?.board');
await evaluate(`localStorage.setItem('felt:save:felt-solitaire', '{"format":1,"game":"felt-solit'); true`);
await open('solitaire.html', '__felt?.columns?.length === 7');
await evaluate(SOL_QUIET);
const fresh = JSON.parse(await evaluate(`JSON.stringify({ resumed: __felt.resumed, sizes: __felt.columns.map(c => c.size), stock: __felt.stock.size,
  saved: JSON.parse(localStorage.getItem('felt:save:felt-solitaire') ?? 'null')?.history?.steps?.length })`));
check(!fresh.resumed.ok && fresh.resumed.problem === 'corrupt' && JSON.stringify(fresh.sizes) === '[1,2,3,4,5,6,7]' && fresh.stock === 24
  && fresh.saved === 1, `a corrupt save is set aside for a new deal, which is saved in its place (${fresh.resumed.problem})`);

// --- tap to move: selection, legal targets, refusals, highlights that follow --
console.log('\ntap to move');
await open('select.html', '__felt?.columns?.length === 6 && !__felt.table.busy');
const sel = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  while (f.table.busy) await wait(100);
  const rect = b.canvas.getBoundingClientRect();
  const page = (x, y) => ({ clientX: rect.left + x / b.width * rect.width, clientY: rect.top + y / b.height * rect.height });
  const tap = async (x, y, ms = 450) => { const at = page(x, y);
    b.canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerId: 16, bubbles: true }));
    b.canvas.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerId: 16, bubbles: true })); await wait(ms); };
  const tapCard = (card) => tap(card.x, card.y + 24);
  const tapZone = (zone, ms) => { const p = zone.next(); return tap(p.x, p.y, ms); };
  // Real pixels: the mean colour of a band just outside a card's left and
  // right edges - felt, unless something is lit round it.
  const { width: cw, height: ch } = f.table.cardSize();
  const ring = (x, y) => {
    const shot = b.snapshotCanvas(); const pen = shot.getContext('2d'); const k = shot.width / b.width;
    let r = 0, g = 0, bl = 0, n = 0;
    for (const side of [-1, 1]) for (let dy = 0; dy <= ch / 2 - 6; dy += 4) {
      const px = pen.getImageData(Math.round((x + side * (cw / 2 + 2)) * k), Math.round((y + dy) * k), 1, 1).data;
      r += px[0]; g += px[1]; bl += px[2]; n++;
    }
    return { r: r / n, g: g / n, b: bl / n };
  };
  const atZone = (zone) => { const t = zone.top; return t ? ring(t.x, t.y) : ring(zone.next().x, zone.next().y); };
  const [c0, c1, c2, c3, c4, c5] = f.columns;
  const setup = { 'column-0': ['spades-7', 'hearts-6'], 'column-1': ['clubs-7'], 'column-2': ['diamonds-5'],
    'column-3': ['spades-2'], 'column-4': [], 'column-5': ['hearts-3'] };
  const named = new Set(Object.values(setup).flat());
  const state = Object.fromEntries([f.deck, ...f.foundations, ...f.columns].map(z => [z.id, []]));
  f.selection().clear();
  await f.table.sync({ ...state, ...setup, deck: f.table.cards.map(c => c.card.id).filter(id => !named.has(id)) }, { instant: true });
  for (const id of named) f.table.card(id).setFaceUp(true);
  await wait(400);
  const felt = atZone(c2);
  // Each place as it looks unlit - an empty one shows its painted outline.
  const unlit = Object.fromEntries([c1, c2, c3, c4, c5, f.foundations[1]].map(z => [z.id, atZone(z)]));
  // Tap the six of hearts: selected, lifted and lit gold; the black seven and
  // the empty column lit as targets, and nothing else.
  const six = f.table.card('hearts-6');
  const before = ring(six.x, six.y);
  await tapCard(six);
  const selected = { ids: f.selection().cards.map(c => c.card.id), before, after: ring(six.x, six.y), z: six.shown.z };
  const lit = Object.fromEntries([c1, c2, c3, c4, c5, f.foundations[1]].map(z => [z.id, atZone(z)]));
  const targets = f.selection().targets().map(z => z.id);
  // Tap the seven of clubs: the six goes onto it.
  await tapCard(f.table.card('clubs-7')); await wait(500);
  const moved = { onto: c1.cards.map(c => c.card.id).join(), left: c0.cards.map(c => c.card.id).join(), selected: f.selection().cards.length,
    at: { dx: six.x - c1.places(2)[1].x, dy: six.y - c1.places(2)[1].y }, gold: ring(six.x, six.y) };
  // The two of spades onto the hearts' foundation: refused, flashed red, still selected.
  await tapCard(f.table.card('spades-2'));
  const home = f.foundations[1];
  await tapZone(home, 90);
  const refused = { flash: atZone(home), selected: f.selection().cards.map(c => c.card.id), size: home.size };
  await wait(700);
  refused.after = atZone(home);
  await tap(240, 690);
  // A highlight on a card goes where the card goes - read off mid-flight, then by pixels where it lands.
  const three = f.table.card('hearts-3');
  f.highlights.card(three, { color: 0xff7de9, shape: 'both' }, { group: 'smoke' });
  await wait(250);
  const was = { x: three.x, y: three.y, ring: ring(three.x, three.y) };
  const flight = f.table.move(three, c4, { duration: 600 });
  await wait(250);
  const sprites = b.nodes().filter(n => !n.interactive && n.depth === three.depth - 0.5);
  const p = three.shown;
  const mid = { n: sprites.length, off: Math.max(...sprites.map(s => Math.hypot(s.x - p.x, s.y - p.y) + Math.abs(s.z - p.z) + Math.abs(s.angle - p.angle))),
    along: Math.hypot(p.x - was.x, p.y - was.y), left: Math.hypot(p.x - c4.next().x, p.y - c4.next().y) };
  await flight; await wait(300);
  const landed = { ring: ring(three.x, three.y), old: ring(was.x, was.y), moved: Math.hypot(three.x - was.x, three.y - was.y) };
  f.highlights.clear('smoke');
  return JSON.stringify({ felt, unlit, selected, lit, targets, moved, refused, was, mid, landed });
})()`));
const blue = (c) => c.b - sel.felt.b;
const lift = (id) => sel.lit[id].b - sel.unlit[id].b;
const goldOf = (c) => c.r - sel.felt.r;
check(sel.selected.ids.join() === 'hearts-6' && goldOf(sel.selected.after) > 40 && goldOf(sel.selected.before) < 10 && sel.selected.z > 5,
  `a tapped card is selected, lifted and lit: red over the felt ${goldOf(sel.selected.before).toFixed(0)} → ${goldOf(sel.selected.after).toFixed(0)}`);
check(sel.targets.join() === 'column-1,column-4' && lift('column-1') > 40 && lift('column-4') > 40,
  `its legal targets light up (${sel.targets.join(', ')}: blue +${lift('column-1').toFixed(0)}, +${lift('column-4').toFixed(0)})`);
check(['column-2', 'column-3', 'column-5', 'foundation-hearts'].every(id => Math.abs(lift(id)) < 6),
  `and the places it may not go stay dark (${['column-2', 'column-3', 'column-5', 'foundation-hearts'].map(id => lift(id).toFixed(0)).join(', ')})`);
check(sel.moved.onto === 'clubs-7,hearts-6' && sel.moved.left === 'spades-7' && sel.moved.selected === 0
  && Math.hypot(sel.moved.at.dx, sel.moved.at.dy) < 0.5 && goldOf(sel.moved.gold) < 10,
  `a tap on a target moves it there, and lets go of the selection (${sel.moved.onto})`);
check(sel.refused.size === 0 && sel.refused.selected.join() === 'spades-2' && sel.refused.flash.r - sel.felt.r > 40
  && sel.refused.after.r - sel.felt.r < 8,
  `a tap where it may not go is refused: flashed red (+${(sel.refused.flash.r - sel.felt.r).toFixed(0)}) and gone again, still selected`);
check(sel.mid.n === 2 && sel.mid.off < 0.01 && sel.mid.along > 5 && sel.mid.left > 5,
  `a highlight rides its card in flight: ${sel.mid.n} sprites at its shown pose, half way (off by ${sel.mid.off.toFixed(3)})`);
check(sel.landed.moved > 50 && sel.landed.ring.b - sel.felt.b > 40 && Math.abs(sel.landed.old.b - sel.unlit['column-4'].b) < 6 && sel.was.ring.b - sel.felt.b > 40,
  `and lights it where it lands, not where it was (+${(sel.landed.ring.b - sel.felt.b).toFixed(0)} there, ${(sel.landed.old.b - sel.unlit['column-4'].b).toFixed(0)} here)`);
// --- two seats: one game, three copies, in lockstep -------------------------
console.log('\ntwo seats');
await open('seats.html', '!!window.__felt?.server');
await until(`__felt.seats.south.state.hands.south.length === 6 && __felt.seats.north.state.hands.north.length === 6`, 15000);
const seatsRun = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const turn = () => f.server.state.turn;
  // Waits on the game rather than the wall clock: under software GL the
  // engine's time runs slower than real time.
  const landed = async (n) => { const t = performance.now();
    while (f.server.state.pile.length < n && performance.now() - t < 10000) await wait(50); await wait(300); };
  f.play(turn()); await landed(1);
  const next = turn();
  f.play(next); await landed(2);
  f.play(next); await wait(1500);   // not their turn any more: refused by every copy alike
  const afterRefused = f.server.state.pile.length;
  document.getElementById('lag').click();   // 400 ms each way
  f.play(turn()); await landed(3);
  const s = f.server.state;
  return JSON.stringify({ pile: s.pile.length, afterRefused, agreed: f.hashes.agreed, differed: f.hashes.differed,
    late: f.seats.north.late + f.seats.south.late,
    same: JSON.stringify(f.seats.north.state) === JSON.stringify(s) && JSON.stringify(f.seats.south.state) === JSON.stringify(s),
    members: f.board.engine.memberCount, boards: f.boards.length,
    drawn: f.boards.map(b => b.renderer.instanceCount) });
})()`));
check(seatsRun.pile === 3 && seatsRun.afterRefused === 2, `plays reach the game in turn, and an out-of-turn one is refused (${seatsRun.pile} on the pile)`);
check(seatsRun.differed === 0 && seatsRun.agreed > 100 && seatsRun.same,
  `server and both seats agree on every tick (${seatsRun.agreed} ticks compared, ${seatsRun.differed} differed)`);
check(seatsRun.late === 0, `with 400 ms latency nothing arrives late: commands are stamped ahead of the trip (${seatsRun.late} late)`);
// 13 each: twelve in the hands and on the pile, and of the forty in the deck
// only the top one - the rest are exactly under it, and not drawn.
check(seatsRun.boards === 2 && seatsRun.members === 2 && seatsRun.drawn.every(n => n >= 10),
  `two boards on one engine, both drawing (${seatsRun.drawn.join(', ')} instances)`);

// --- readouts, toasts and announcements -------------------------------------
console.log('\nreadouts & toasts');
await open('readouts.html', '!!window.__felt?.score && document.fonts.status === "loaded"');
const ro = JSON.parse(await evaluate(`(async () => {
  const f = __felt; const b = f.board; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const settle = async () => { for (let i = 0; i < 40 && b.tweens.count; i++) await wait(50); await wait(100); };
  /** The score's box on a fresh frame: its pixels, and how many are its gold. */
  const box = () => {
    const c = b.snapshotCanvas(); const r = c.width / b.width; const s = f.score.bounds;
    const x = Math.floor((b.width - 200) * r), y = Math.floor(s.y * r), w = Math.ceil(178 * r), h = Math.ceil(s.height * r);
    const px = c.getContext('2d').getImageData(x, y, w, h).data;
    let gold = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 170 && px[i + 2] < 140) gold++;
    return { px, gold };
  };
  f.score.set(1, { animate: false, pop: false }); await settle();
  const one = box();
  f.score.set(88888, { animate: false, pop: false }); await settle();
  const many = box();
  let changed = 0;
  for (let i = 0; i < one.px.length; i += 4) if (Math.abs(one.px[i] - many.px[i]) + Math.abs(one.px[i + 1] - many.px[i + 1]) > 60) changed++;
  // Hammered: five hundred values, every digit, and the atlas does not grow.
  const before = { pages: b.atlas.pages.length, paints: b.atlas.paints, glyphs: f.glyphs.size };
  for (let i = 0; i < 500; i++) f.score.set(i * 7919, { animate: false, pop: false });
  await settle();
  const after = { pages: b.atlas.pages.length, paints: b.atlas.paints, glyphs: f.glyphs.size, text: f.score.text };
  // A toast comes, sits over the board, and goes.
  const rect = b.canvas.getBoundingClientRect();
  const handle = f.toasts.show('Smoke toast', { duration: 400 });
  let shown = null;
  for (let t = performance.now(); performance.now() - t < 3000 && !shown; await wait(30)) {
    const el = handle.element;
    if (el && Number(el.style.opacity) > 0.95) { const r = el.getBoundingClientRect(); shown = { l: r.left, t: r.top, r: r.right, b: r.bottom }; }
  }
  let gone = false;
  for (let t = performance.now(); performance.now() - t < 4000 && !gone; await wait(50)) {
    gone = handle.phase === 'gone' && !document.querySelector('[data-toast="' + handle.id + '"]');
  }
  const inside = !!shown && shown.l >= rect.left && shown.r <= rect.right && shown.t >= rect.top && shown.b <= rect.bottom;
  // A float rises off the board point it was given.
  const fl = f.toasts.float('+10', 380, 300, { duration: 3000 });
  await wait(60);
  const fr = fl.element.getBoundingClientRect();
  const want = { x: rect.left + 380 / b.width * rect.width, y: rect.top + 300 / b.height * rect.height };
  const floatOff = Math.abs((fr.left + fr.right) / 2 - want.x);
  fl.dismiss();
  // The live region hears it: a polite burst, and an assertive one at once.
  const announcer = f.announcer;
  announcer.announce('Smoke says hello');
  announcer.announce('and goodbye');
  let polite = '';
  for (let t = performance.now(); performance.now() - t < 3000 && !polite.includes('hello'); await wait(30)) polite = announcer.politeRegion.textContent;
  document.querySelector('#stuck').click();
  let assertive = '';
  for (let t = performance.now(); performance.now() - t < 3000 && !assertive.includes('No moves'); await wait(30)) assertive = announcer.assertiveRegion.textContent;
  const regions = document.querySelectorAll('[aria-live]').length;
  return JSON.stringify({ changed, oneGold: one.gold, manyGold: many.gold, before, after, shown, inside, gone, floatOff,
    polite, assertive, regions, role: announcer.politeRegion.getAttribute('role'), log: document.querySelector('#said').textContent });
})()`));
check(ro.changed > 200 && ro.manyGold > ro.oneGold * 2 && ro.oneGold > 20,
  `a readout's pixels change with its value, in its own ink (${ro.changed} px changed; gold ${ro.oneGold} -> ${ro.manyGold})`);
check(ro.after.pages === ro.before.pages && ro.after.paints - ro.before.paints <= 12 && ro.after.glyphs <= 48,
  `hammering the score 500 times does not grow the atlas (${ro.before.pages} -> ${ro.after.pages} pages, ${ro.after.paints - ro.before.paints} new paints, ${ro.after.glyphs} glyphs in use; shows ${ro.after.text})`);
check(ro.inside && ro.gone, `a toast appears over the board and goes away (${ro.shown ? 'shown inside the canvas' : 'never shown'}, ${ro.gone ? 'gone' : 'still there'})`);
check(ro.floatOff < 3, `a float rises off the board point it was given (${ro.floatOff.toFixed(1)} px off)`);
check(ro.polite.includes('Smoke says hello. and goodbye') && ro.assertive.includes('No moves left') && ro.regions === 2 && ro.role === 'status',
  `the page's one live region hears it: polite coalesced ("${ro.polite.trim()}"), assertive at once ("${ro.assertive.trim()}")`);
check(ro.log.includes('Smoke says hello'), 'and the page logs what was said, for sighted testers');

// --- the demo as one page: scenes, not navigations --------------------------
console.log('\nthe demo app');
await send('Page.navigate', { url: `${host}/` });
await until('!!window.__feltApp?.director?.scene');
const spa = JSON.parse(await evaluate(`(async () => {
  const app = window.__feltApp; const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const names = [...document.querySelectorAll('a.demo')].map(a => a.getAttribute('href').replace('./', '').replace('.html', ''));
  const loadsBefore = performance.getEntriesByType('navigation').length;
  const visits = []; let leftovers = 0;
  for (const name of names) {
    document.querySelector('a.demo[href="./' + name + '.html"]').click();
    const t = performance.now();
    const live = () => app.director.scene === name && window.__felt?.board && !window.__felt.board.isDestroyed
      && (window.__felt.board.renderer.instanceCount > 0 || window.__felt.board.renderer.drawCalls > 0);
    while (!live() && performance.now() - t < 8000) await wait(50);
    visits.push({ name, scene: app.director.scene, canvases: document.querySelectorAll('canvas').length,
      members: app.engine.memberCount, drawn: (window.__felt?.board?.renderer?.instanceCount ?? 0) + (window.__felt?.board?.renderer?.drawCalls ?? 0), hash: location.hash });
    await wait(300);
    document.querySelector('a.home').click();
    const back = performance.now();
    while (!(app.director.scene === 'index' && document.querySelector('a.demo')) && performance.now() - back < 5000) await wait(20);
    await wait(150);
    if (document.querySelectorAll('canvas').length || app.engine.memberCount || app.engine.updateCount
      || document.querySelector('.felt-fps') || document.querySelector('.felt-toasts')) leftovers++;
  }
  // Again, warm: the art is the engine's from the first visit.
  const art = app.engine.services.get('art-store'); const known = art.report().length;
  document.querySelector('a.demo[href="./stacks.html"]').click();
  const t = performance.now();
  while (!(app.director.scene === 'stacks' && !window.__felt.board.isDestroyed
    && window.__felt.board.renderer.instanceCount > 70) && performance.now() - t < 8000) await wait(10);
  const warm = performance.now() - t;
  // The back button, through the hash.
  history.back(); await wait(500);
  const afterBack = app.director.scene;
  history.forward(); await wait(1200);
  return JSON.stringify({ visits, leftovers, warm, newArt: art.report().length - known, afterBack,
    afterForward: app.director.scene, navigations: performance.getEntriesByType('navigation').length - loadsBefore,
    sameDocument: !!window.__feltApp });
})()`));
const opened = spa.visits.filter(v => v.scene === v.name && v.canvases >= 1 && v.members === v.canvases && v.drawn > 0 && v.hash === '#/' + v.name);
if (opened.length !== spa.visits.length) console.log(JSON.stringify(spa.visits.filter(v => !opened.includes(v))));
check(opened.length === spa.visits.length, `every demo opens as a scene in one page, with its board drawing (${opened.length}/${spa.visits.length})`);
check(spa.leftovers === 0, `leaving a scene leaves nothing behind: no canvas, board, timer or meter (${spa.leftovers} left something)`);
check(spa.sameDocument && spa.navigations === 0, 'and the page never navigated');
check(spa.newArt === 0, `a demo visited again fetches no art again, and draws in ${Math.round(spa.warm)} ms`);
check(spa.afterBack === 'index' && spa.afterForward === 'stacks', `back and forward move between scenes (${spa.afterBack}, ${spa.afterForward})`);

check(errors.length === 0, `no page threw (${errors.length}${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''})`);
console.log(failures ? `\n${failures} failed` : '\nall good');
done(failures ? 1 : 0);
