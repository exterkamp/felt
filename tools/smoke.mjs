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
check(tiles.length === 10, `the home screen lists ten demos (${tiles.length})`);
let reachable = 0;
let wayBack = 0;
let boards = 0;
for (const href of tiles) {
  await send('Page.navigate', { url: href });
  await sleep(900);
  if (await evaluate(`!!document.querySelector('h1')`)) reachable++;
  if (await evaluate(`(() => { const a = document.querySelector('a.home');
    return !!a && a.href === location.href.replace(/[^/]*$/, ''); })()`)) wayBack++;
  if (await evaluate(`!!window.__felt?.board?.renderer?.gl`)) boards++;
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

const courts = await evaluate(`(async () => { await new Promise(r => setTimeout(r, 1500));
  const art = __felt.board.services.get('card-art');
  return [...['J','Q','K']].flatMap(r => ['spades','hearts','diamonds','clubs'].map(s => [r, s]))
    .filter(([r, s]) => [...art.assets?.keys?.() ?? []].some(k => k.endsWith('-half-' + r + '-' + s))).length; })()`);
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

// --- one stack: canned animations tapped fast ------------------------------
console.log('\none stack');
await open('one-stack.html', '__felt?.pile?.().length >= 5');
await until(`__felt.pile().length >= 5 && !__felt.board.tweens.count`, 20000);
const taps = JSON.parse(await evaluate(`(async () => {
  const b = __felt.board; const flip = document.getElementById('flip');
  const top = () => __felt.pile()[__felt.pile().length - 1];
  const was = top().card.faceUp; let maxZ = 0, maxScale = 0;
  const watch = () => { const p = top().shown; maxZ = Math.max(maxZ, p.z); maxScale = Math.max(maxScale, p.scaleX); };
  b.on('update', watch);
  for (let i = 0; i < 7; i++) { flip.click(); await new Promise(r => setTimeout(r, 30)); }
  while (b.tweens.count) await new Promise(r => setTimeout(r, 100));
  b.off('update', watch);
  const c = top();
  return JSON.stringify({ maxZ, maxScale, z: c.z, shownZ: c.shown.z, turn: c.turn, flipped: c.card.faceUp !== was });
})()`));
check(taps.maxZ <= 18.01 && taps.maxScale <= 1.0001,
  `seven quick taps on flip never lift the card past one flip's height (${taps.maxZ.toFixed(1)} units)`);
check(taps.z === 0 && taps.shownZ === 0 && taps.turn === 0, 'and leave it flat on the table');
check(taps.flipped, 'seven flips, played one after another, leave it the other side up');

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
    if (p.kind === 'stack') return p.cards.every(c => c.angle === 0);
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
  await new Promise(r => setTimeout(r, 1500));
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
  const keys = [...art.assets.keys()];
  return { half: keys.filter(k => k.includes('-half-K-')).length, full: keys.filter(k => k.includes('-full-K-')).length }; })()`);
check(faces.half >= 1 && faces.full >= 1, `both cuts of the court are rendered for the three faces (${faces.half} half, ${faces.full} full)`);

console.log('\nthe deck editor');
await open('deck.html', '!!window.__felt?.editor');
const rules = await evaluate(`JSON.stringify(__felt.rules)`);
check(rules === JSON.stringify({ spades: 'black', hearts: 'red', diamonds: 'red', clubs: 'black' }),
  'what a suit counts as does not move with what it is printed in');
const pip = await evaluate(`(() => { const r = __felt.suitTexture('spades', 0xffffff); return !!r && r.width > 0; })()`);
check(pip, 'a lone pip for an empty place is a real picture');

// --- the box ----------------------------------------------------------------
console.log('\nthe tuck box');
await open('box.html', '!!window.__felt?.box?.()');
const box = JSON.parse(await evaluate(`(async () => {
  const b = __felt.box();
  const spinning = b.turn; await new Promise(r => setTimeout(r, 500));
  const turned = b.turn !== spinning;
  await __felt.openAndDeal();
  const cards = __felt.cards();
  return JSON.stringify({ turned, cards: cards.length,
    landed: cards.every(c => Math.abs(c.x - 240) < 0.01 && Math.abs(c.y - 392) < 0.01),
    centre: b.deckCentre() });
})()`));
check(box.turned, 'the box turns on the spot');
const boxBack = await evaluate(`(async () => {
  const b = __felt.board; const ext = b.renderer.gl.getExtension('WEBGL_lose_context');
  ext.loseContext(); await new Promise(r => setTimeout(r, 300)); ext.restoreContext();
  await new Promise(r => setTimeout(r, 1000));
  const c = b.snapshotCanvas(); const px = c.getContext('2d').getImageData(c.width / 2 - 40, 140, 80, 120).data;
  let felt = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0x13) < 6 && Math.abs(px[i + 1] - 0x46) < 6) felt++;
  return felt / (px.length / 4);
})()`);
check(boxBack < 0.5, `and the tuck box survives a lost context too (${Math.round(boxBack * 100)}% felt where it stands)`);
check(box.cards === 52 && box.landed, `the deck comes out as fifty-two real cards and squares up (${box.cards})`);
check(Math.abs(box.centre.x - 240) < 4 && box.centre.y < 210, `and the block it replaced had risen out of the box (${box.centre.x.toFixed(1)}, ${box.centre.y.toFixed(1)})`);

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

console.log('');
check(errors.length === 0, `no page threw (${errors.length}${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''})`);
console.log(failures ? `\n${failures} failed` : '\nall good');
done(failures ? 1 : 0);
