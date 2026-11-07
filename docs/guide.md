# felt: the guide

Everything in more detail than the [README](../README.md). felt is a WebGL2 engine for card games, and nothing else.

Everything [phaser-card-engine](https://github.com/exterkamp/phaser-card-engine)
does, without Phaser underneath it: the same cards, stacks, hands, faces,
courts, decks, throws, deals and riffles, drawn by a renderer that
only ever has to draw cards. Every card on the table is one instance of one
instanced draw call, a card can lift, tip, roll and bend because it is a real
two-sided surface in a real (optional) perspective, and a board that nothing
is moving on draws nothing at all. On top of that sit the things a game needs:
a Table of zones with rules, tap-to-move and highlights, undo and saves,
readouts and toasts, chips, dice and a peg board, and paint for the felt.

**Try it: [exterkamp.github.io/felt](https://exterkamp.github.io/felt/)** -
twenty demos, every one of them a phone-sized table.

```ts
import { createBoard, CardSprite, loadCardArt, renderCourts, shuffledDeck, throwCard,
  COURT_PALETTES } from '@exterkamp/felt';

const board = createBoard({ parent: 'board', width: 480, height: 640, backgroundColor: '#13463a' });
void loadCardArt(board);                          // suits, backs, fonts - not required first
void renderCourts(board, COURT_PALETTES.press);   // portraits land when they land

const cards = shuffledDeck().map((card) => new CardSprite(board, { ...card, faceUp: true }));
await throwCard(board, cards[0], { x: 240, y: 320 }, { arc: 28 });
```

## What it is made of

| | |
| --- | --- |
| `src/core/` | Everything that draws nothing, carried over from phaser-card-engine **unchanged** with its tests: cards and suit vocabularies, `Stack` and `Hand` geometry, `cardFaceMetrics` and the three faces, shuffles and `riffleSplit`, the six decks and their inks, court palettes and the background parting. Its own entry point, `felt/core`, and it runs in node. |
| `src/runtime/` | `Engine` (the page's one loop, clock, fixed steps, lifecycle and services), `Clock` (`RafClock`, `ManualClock`), `PageLifecycle`, `Scene` and `Director`, `Disposables`, `Simulation` (deterministic game state for multiplayer). |
| `src/gl/` | `Renderer` (one instanced program for every card and sprite), `Atlas` (every picture on a few 2048² layers of one texture array), `lens.ts` (the projection, written once in TypeScript and once in GLSL). |
| `src/scene/` | `Board` (canvas, pixel ratio, fit, input, the sleep-when-still loop), `Node` and `Sprite`, `Tweens` with Phaser's config shape and ease names. |
| `src/art/` | `CardSprite`, the card sheets, the face and back painters, suit pips, the court renderer and its worker; `paintFelt` and the running borders. |
| `src/play/` | `throwCard`, `dealCards`, `layHand`, `orderStack`, `flipCard`, `riffleShuffle`, `flickCard`. |
| `src/table/` | The `Table` - zones that own their cards, moves, rules, drag and flick, `sync` - and what builds on it: selection, tap-to-move and highlights; table state, undo history and saves. |
| `src/ui/` | Readouts drawn on the board, toasts over it, and screen-reader announcements. |
| `src/pieces/` | Chips and chip stacks, tokens, dice and a cribbage peg board. |

## Why not Phaser

The things phaser-card-engine had to work round are the reasons for this:

- **A card was a Container of a dozen game objects** - a body image, a back
  image, text for each index, an image per pip, a portrait and a frame. Here a
  card is 32 floats: a face and a back, each a region of the atlas painted once
  per look and shared by every card that looks like it, and a body the shader
  cuts out of them. The rounded corners, the hairline edge and the drop shadow
  are arithmetic in the fragment shader rather than three baked textures per
  card size.
- **Depth did not sort inside a Container**, which once silently flipped every
  first-on-top pile. There is no container here: the board keeps one list
  sorted by depth, then by creation order.
- **HiDPI needed `createBoard` + `boardRoot` + a scaled root container.** The
  board is in logical units and the canvas is at the device's ratio from the
  start; every picture is rasterised at that ratio.
- **Bending a card meant swapping it for a Mesh** for the length of a riffle,
  snapshot and all. Here `bow`, `tilt`, `turn` and `z` are properties of every
  card, zero by default, and cost nothing when they are zero.

Measured, in the same software-rendered headless Chrome: the hold'em riffle
runs at **54 ms a frame against Phaser's 176**, the whole engine plus core is
**21 kB gzipped** against Phaser's 331 kB, and the stacks page - 52 cards,
every label, every slot - is **74 instances in 1 draw call** (a squared pile is drawn as its top card:
the cards exactly under an opaque one are skipped). A still board draws **0**
frames. On the stress page, 4160 cards all moving every frame cost **2.5 ms**
of CPU a frame, flat or in 3D. A cold start is ready in about 0.6 s, and a
load with the courts kept from the last visit in about 0.2 s.

**The bench** (`demo/bench.html`) runs the same table on both engines - the
same cards, the same layout, every card moved every frame - and times every
animation-frame callback in the page, so neither engine is measured by its
own accounting. Its twin lives on phaser-card-engine's `bench` branch.
Headless Chrome on SwiftShader, on a busy machine - so the frame rates are the
software rasteriser's and left out; the JavaScript is the engines':

| cards | making them (felt / Phaser) | JS a frame, all moving, median | JS heap |
| ---: | ---: | ---: | ---: |
| 52 | - / - | 0.4 / 1.1 ms | 12 / 35 MB |
| 208 | 3 / 417 ms | 0.3 / 2.4 ms | 9 / 36 MB |
| 520 | 10 / 632 ms | 0.5 / 5.6 ms | 9 / 38 MB |
| 1040 | 38 / 1561 ms | 0.9 / 18.1 ms | 9 / 43 MB |
| 2080 | 62 / 2330 ms | 1.5 / 60.2 ms | 11 / 54 MB |

From navigation to 52 cards drawn: 2.3 s against 7.7 s. Sitting still, felt
spends under 1 ms of JavaScript a second at every size (it draws nothing);
Phaser draws every frame regardless.

## Flat or 3D: the lens

```ts
createBoard({ ..., fov: 45 });               // default: real perspective for anything lifted
createBoard({ ..., fov: 0 });                // orthographic: nothing ever foreshortens
createBoard({ ..., lens: 'board' });         // one camera over the middle of the table
```

The camera sits over the table at whatever distance makes **z = 0 exactly
board units**, so a flat game is pixel-identical whatever the lens and never
has to know it exists. With the default `lens: 'local'` each card is seen from
straight above itself, which is what Phaser's per-mesh projection did and what
a card game usually wants: a card tipped in a corner looks the same as one
tipped in the middle. `'board'` is the physically true picture.

A card's pose is `x, y, z` (z towards the camera), `angle` in degrees in the
table's plane, `tilt` (radians, top edge away), `turn` (radians about its long
axis - half a turn shows the other side, mirrored back the right way round),
and `bow` (a parabola down its length, positive dishes the middle away). A
lifted card's shadow falls further down the table and softer.

**Picking up.** On a board with perspective, a dragged card comes up off
the felt. Its shadow falls further out, softer, with a wide penumbra. It
leans into the drag: it rolls and tips away from the direction of pull, and
swings round in the plane. It is seen through a stronger lens of its own
while held, so its tipping reads as depth, and its shadow is cast flat on the
felt beneath it rather than in its own plane. Springs settle it when the hand
stops, with one small swing back and no wobble, and it drops back when let
go. This is the board's own behaviour, so no game code is
needed for it. It is one offset on the card, so the game's own `setPosition`,
layouts and throws compose with it. A `dragstart` handler can
`pointer.refuse()` a card that is not to be moved (one under the top of a
pile). Tune it with `createBoard({ pickUp: { lift, maxSwivel, maxSway,
stiffness, damping, perspective } })`, or turn it off with `pickUp: false`; on a flat
board (`fov: 0`) it is off.

**Flicking.** Let go of a dragged card while it is still moving and it keeps
going. `pointer.velocity` is how fast the pointer was moving over its last
tenth of a second, and zero if it had stopped. `flickCard(board, card,
pointer.velocity, { grip, friction, bounds })` slides the card to a stop
under friction. A hard flick hops off the felt and lands. Held off-centre,
the card spins. With `bounds` it meets the table's edges as a rigid card:
each wall hit is an impulse at the corner that struck. Square on, it bounces
straight back. Corner first, it spins off at an angle, and a glancing hit
twists it. On a board with perspective (`mode: '3d'`, the default there),
the wall also knocks it up off the felt, end over end about the wall's line.
It lands flat after a whole number of half turns: after an odd number the
card itself is the other side up, and turned round if it went over its
width. On a flat board (`board.setFov(0)`), it stays on the felt.
`simulateFlick` gives the same path without playing it, so a game can know
where a card will stop. The flick runs on the card's `move` channel, so
picking the card up again catches it where it is.

**Magnets.** `flickCard(..., { magnets: [{ x, y, angle, reach }] })` gives a
flick places it can land. On the felt, inside a magnet's reach (default 90),
the card is pulled towards the middle, harder the nearer it is, and slowed,
so a card flicked near one curves in rather than sailing past. One that
stops inside a reach, or drifts in close and slow, glides the rest of the
way and squares up to the magnet's angle. A fast enough card gets away. The
game decides which places are valid and passes only those, so a stack that
can't take the card doesn't pull it. `onRest(path)` reports
`path.caught`, the index of the magnet that took it. The Magnetic stacks
demo has one stack per suit.

## The table: making a game

Underneath, placement is geometry: a Stack or a Hand says where its *n*th
card sits, and nothing more. Games built straight on that kept their own
array of sprites next to every stack, and each wrote its own layout code,
depth bands, in-flight bookkeeping and drag-and-drop. `createTable(board)`
does that once.

```ts
const table = createTable(board);
const stock = table.pile({ id: 'stock', x: 40, y: 70, faceUp: false, drag: false });
const column = table.pile({
  id: 'column-0', x: 40, y: 190, fan: 'down', step: 24, drag: 'run',
  canTake: (cards) => cards.every((c) => c.faceUp),
  accepts: (cards, pile) => !pile.topCard || rankValue(cards[0].rank) === rankValue(pile.topCard.rank) - 1,
});
stock.put(shuffle(buildDeck()));
table.draggable();                        // the zones' rules decide every pick-up and drop
table.on('move', ({ cards, from, to }) => { /* the game's turn */ });
await table.move(stock.top!, column);     // thrown there, turned to the zone's side on landing
```

- **Zones**: `table.pile()` and `table.hand()` hold their cards, lay them
  out in a depth band of their own, and turn arrivals to their `faceUp`.
- **Moves**: `table.move(cards, zone)` takes the cards out of their old
  zone at once and flies them in. `table.deal(from, zones, { rounds })`
  deals round them, and `zone.put(cards)` places cards instantly.
- **Rules**: each zone's `accepts` and `drag` / `canTake` drive
  `table.draggable()`: what can be picked up, the drop outline, sending
  back, carrying runs. With `{ flick: true }` they also drive the magnets of
  a flicked card. They govern the player only; the game's own moves are
  not checked.
- **Sync**: `table.sync({ zoneId: cardIds })` shows a state kept somewhere
  else (a `Simulation`, a server, a saved game) by moving only what isn't
  where the state says.
- **Events and sequences**: `move`, `take`, `drop`, `tap` and `refuse`
  events, and `table.run(sequence)` so a deal can't start twice.

See the Solitaire demo (Klondike as thirteen zones and their rules),
Two seats (one `sync` per view), and section 9 of the tour.

## Selecting, tapping to move, and highlights

Dragging is not the only way to play a table: on a phone held in one hand,
and for anyone who can't drag, a card is *tapped* and then its destination
is. `selectable(table)` does that by the same zone rules a drop asks.

```ts
table.draggable();                                   // still works alongside
const selection = selectable(table, { dragTargets: true });
selection.on('change', ({ items }) => { /* what is selected */ });
selection.on('refuse', ({ to }) => say(`not on ${to.id}`));
button('hint', () => selection.hint({ score: (m) => (m.to.kind === 'pile' ? 1 : 0) }));

const lights = highlights(board);                    // the board's highlights
lights.define('mine', { color: '#ff7de9', shape: 'both', pulse: 800 });
const h = lights.card(card, 'mine');                 // follows the card wherever it goes
lights.zone(pile, 'target');                         // its top card, or its empty place
void lights.flash(pile, 'refused');                  // a brief red "no"
h.remove();
```

- **Selection**: a tap selects what a drag would pick up (`drag`/`canTake`:
  the card, or its run), lifts it on its own Animator channel and lights it;
  the zones that `accepts` it light up as targets; a tap on one moves it
  there (`by: 'tap'`); a tap on one that refuses it flashes red. Any move of
  a selected card clears it. `multi: true` adds and removes cards instead.
  `selection.tap({ card })` / `tap({ zone })` drive it without a pointer -
  for a keyboard or a screen reader.
- **Highlights** (`highlights(board)`, a board service): `selected`,
  `target`, `hint` (pulsing) and `refused` (flashed) built in, `define` for
  a game's own. Each is a sprite painted once in white per card size and
  shape and tinted, so a whole table of them shares one or two atlas
  pictures. Before every frame each is put on its card's *shown* pose -
  throws, flips, the pick-up's lift, swivel and extra perspective included -
  and half a step of depth under it, so its own card covers its middle and
  whatever lies over the card lies over its glow too.
- **The pure half** (`src/table/moves.ts`, all exported from `felt`): `legalTargets`,
  `legalMoves`, `hintMove`, the tap-to-move state machine `decideTap`, and
  `SelectionSet` - generic over anything shaped like a zone, so a game's
  rules can be tested in node.

See the Tap to move demo.

## Undo, history and saves

A table's whole arrangement is plain JSON: `captureTable(table)` reads each
zone's card ids in order, which cards are face up, and the cards loose on
the felt with where they lie. `restoreTable(table, state)` puts it back:
cards fly to their places and turn to their sides (or, with
`{ instant: true }`, are simply there). It is the *logical* arrangement, so
it can be read mid-flight: a card thrown at a pile is in it, and a card
turning over counts as the side it is turning to.

```ts
const history = createHistory(table, {
  game: { save: () => game, load: (saved) => { game = saved; render(); } },   // score, passes, turn: JSON
  cap: 200,
});
button('undo', () => history.undo());          // animated; resolves once landed
history.on('change', ({ canUndo, canRedo }) => { /* grey the buttons */ });
await history.group(() => playAiTurn(), 'turn'); // several awaited moves, one undo step
history.reset();                                 // after a deal: this is the start
history.log();                                   // [{ cards, from, to, by }, ...] for a replay
```

- **Steps**: every move the table makes in one go - one drop, one tap, and
  whatever the game's `move` handler does in answer (the card a move turns
  up, the score) - is one step, recorded a microtask later. A sequence that
  awaits between moves is one step with `group(fn)` or `begin()`/`end()`.
  `commit()` records a change the table did not announce (a card turned in
  place, a game-state change). A step that changes nothing is not kept.
- **Undo and redo** restore whole snapshots, table and game, so they cannot
  drift. A new step after an undo discards the redo branch; past `cap` steps
  the oldest go. The history's own restores move cards `by: 'sync'` and are
  never recorded; a game's `move` handler should ignore `sync` too.
- **In flight**: undo works while cards are still in the air (the step is
  already recorded; they turn round and go back). It answers false while
  cards are in the player's hand, or while a group is open.

A save is that history in an envelope: `{ format: SAVE_FORMAT, game, version,
savedAt, history }`.

```ts
const save = createSave({ id: 'klondike', version: 1 });   // localStorage; `store` to plug in another
const resumed = save.resume(history);       // instant, before anything is drawn
if (!resumed.ok) newGame();                 // 'none' | 'corrupt' | 'old-version' | 'unfit' | ...
ctx.scope.add(autosave(history, save, { lifecycle: ctx.engine }));
```

`autosave` writes after every step, undo and redo, when the page is hidden,
frozen or left (the engine's `suspend`), and once more when disposed - given
to the scene's scope, leaving the scene saves it. Nothing is written while a
group is open, so a page closed mid-deal comes back to a new deal rather
than half of one. `resume` puts the table back at once, with no deal and no
flights, so the first frame drawn is the saved game. A save that will not
do (unparseable, another game's, another state `version` with no `migrate`,
a newer `format`, or zones and cards this table does not have) is reported
and cleared, never thrown. The Solitaire demo has Undo, Redo (and ctrl+z /
ctrl+shift+z), keeps its move count and passes through the stock with every
step, and comes back after a reload where it was left.

## Painting the felt

The markings on a table - the words round a blackjack layout, a craps
table's numbers, bet boxes, the scrolls in its corners - are painted on the
felt: a shape in one colour of paint, worn a little by the nap, and an
ordinary sprite under the cards.

```ts
import { paintFelt, paintFeltSvg } from '@exterkamp/felt';

paintFelt(board, { text: 'BLACKJACK PAYS 3 TO 2', font: DISPLAY_FONT, size: 20, arc: 360 }, { x: 240, y: 104, color: 'yellow' });
paintFelt(board, { text: 'COME', size: 52 }, { x: 240, y: 195, color: 'red' });
paintFelt(board, { shape: 'rect', width: 82, height: 106, radius: 10, dash: [6, 4] }, { x, y });
paintFelt(board, { path: CORNER, viewBox: [100, 100], width: 96, stroke: 1.6 }, { x: 52, y: 52, color: 'gold' });
await paintFeltSvg(board, medallionSvg, { width: 46, height: 46 }, { x: 240, y: 365 });
```

- **Paints**: `FELT_INKS` - white, cream, yellow, gold, red, black, blue,
  green - by name, or any CSS colour. `wear` (0-1) is how worn it is.
- **Marks**: words (several lines, letter spacing, outlined with `stroke`,
  or bent round a circle with `arc` - placed by the middle of their line),
  SVG path data in a viewBox (filled or stroked), outlines (`rect`,
  `ellipse`, `line`, dashed; `stroke: 0` fills), a whole SVG document or any
  image, or your own Canvas 2D drawing. Documents, images and drawings keep
  their own colours unless given one.
- Same marks share one picture in the atlas. One mark is never painted bigger
  than an atlas page: a mark the size of the table comes out a little softer
  instead. Words in a font still loading are laid out again when it arrives.
  `board.setBackground()` changes the cloth under it all.
- **Borders**: `border(pattern, { length, height, stroke })` is a running
  band to paint - `greek-key`, `running-dog` (the Vitruvian scroll), `rope`,
  `bead-and-reel`, `dentil`, `chevron`, `scallop`, `interlace` or
  `guilloche` (all in `BORDER_PATTERNS`) - repeated a whole number of times
  to fit its length, outside edge at the top. `paintFeltFrame` puts one round
  a rectangle, outside edge outwards, with a block in each corner:

  ```ts
  paintFeltFrame(board, 'greek-key', { x: 240, y: 360, width: 464, height: 704, depth: 17, color: 'gold' });
  paintFelt(board, border('running-dog', { length: 380, height: 18 }), { x: 240, y: 130, color: 'gold' });
  ```

  They are generated, not drawn from anyone's artwork, so carry no licence.

See the Painted tables demo: blackjack, baccarat and craps; a parlour table
of old patterns generated in code - a guilloché rosette and band, a Greek
key frame and seigaiha waves; and every border.

## Readouts, toasts and announcements

Scores, counters, clocks and pile labels are **readouts**: text on the board,
at a board position, that changes cheaply.

```ts
import { announce, formatClock, readout, toastsOf } from '@exterkamp/felt';

const score = readout(board, { x: 458, y: 52, align: 'right', size: 30, color: '#ffd166', countUp: 350, pop: true });
const clock = readout(board, { x: 22, y: 52, align: 'left', format: (ms) => formatClock(ms) });
const stock = readout(board, { x: 100, y: 400, depth: -1, format: (n) => `Stock ${n}` });   // under the cards
ctx.every(250, () => clock.set(ctx.engine.time - started));
score.set(score.value as number + 15);

toastsOf(board).show('Nice!', { tone: 'good' });                       // a banner, top
toastsOf(board).show("Player 2's turn", { place: 'center' });
toastsOf(board).float('+10', card.x, card.y - 42);                       // rises off a board point
announce('You moved the seven of hearts to column three.');            // said by a screen reader
```

- **Readouts are glyphs.** Each character of a style is painted once, in
  white, into a small atlas region (a board service, `glyphsOf(board)`,
  counting uses); a line is a row of sprites showing them, tinted to its
  colour, in the same draw call as the cards. Changing the value repaints
  nothing - measured: a score hammered 500 times through every digit made
  **8 new paints and no new atlas page** (one per glyph it had not shown
  before), and a second 500 made none. `board.text` would have made a region
  per distinct string. The cost is kerning - glyphs sit on their advances -
  which numbers (tabular by default) do not miss and short labels barely do.
- `format` is a function or `formatNumber` options (`group`, `decimals`,
  `sign: 'always'` for `+15`, `pad`, `prefix`/`suffix`); `formatClock` gives
  `mm:ss` (`h:mm:ss` from an hour, `round: 'ceil'` for countdowns, `tenths`).
  `align` left/center/right anchors the line at `x`; `valign` its `y`.
  `depth` puts it under the cards (below 0) or over them. `countUp` (ms)
  eases a number to its new value; `pop` scales it up and back on a change;
  both stop under `prefers-reduced-motion`. At rest every glyph's edge is on
  a canvas pixel, painted at the board's pixel ratio, so it is drawn 1:1. A
  web font still loading is measured and painted again when it arrives.
- **Toasts are DOM**, in a layer pinned over the canvas at board units and
  the scale `fit()` showed the canvas at - re-aligned on every resize, fit and
  rebuilt canvas, so a float at (x, y) rises off whatever is at (x, y). A
  toast is a new string nearly every time, which is what the atlas is worst
  at; in the DOM it is a text node, laid out crisply at the size it is shown,
  styled with CSS (`.felt-toast--good`), never in the atlas. The trade: toasts
  are not in `board.snapshot()` and are always over the cards. They run on
  the board's frame clock (paused with the page, gone with the board).
- **Toast policy** (`ToastQueue`, pure): top and bottom stack three, more
  wait (oldest first, the stalest dropped beyond four); the centre shows one
  at a time; floats are never queued (past twelve the oldest goes early). The
  same text (or `key`) again while it is up counts onto it ("Nice! ×3") and
  restarts its time. `urgent` jumps the queue and pushes the oldest off.
  Durations follow the length of the message (`durationFor`), or `Infinity`
  until dismissed; a tap dismisses. Under reduced motion they fade without
  moving.
- **Announcements**: one pair of ARIA live regions per page (an engine
  service, `announcerOf(engine)`): two regions talk over each other, one made
  early is in the document before its first message, and a scene change does
  not cut "You win!" off. Polite messages are coalesced into one sentence
  after a quiet 250 ms (at most a second); a `key` keeps only the newest
  (`{ key: 'score' }`); the same words twice in a burst are said once;
  `politeness: 'assertive'` goes at the next frame. Banners announce
  themselves politely by default (`announce: false`, `'assertive'`, or other
  words to say); floats do not. `announcer.onAnnounce(fn)` feeds a visible log.

See the Readouts & toasts demo.
## Pieces that are not cards

Chips, a dealer button, dice and a cribbage board - drawn by the engine,
on the same board and in the same instanced draw as the cards. Each piece
is a `Node`: positioned, depth-sorted with the cards, picked through the
lens, lifted and swung when dragged, and moved by the same throws and
flicks. Each distinct look - a green 25 at 34 units, a red die's five - is
painted once into the atlas and shared.

```ts
import { createPieces, CASINO_DICE } from '@exterkamp/felt';

const pieces = createPieces(board, { diameter: 34 });     // the casino set: 1 5 25 100 500 1K 5K
const bank = pieces.stack({ id: 'you', x: 196, y: 540, chips: [100, 100, 25, 25, 5, 5, 5, 1, 1] });
const bet = pieces.stack({ id: 'bet', x: 240, y: 446 });
const pot = pieces.stack({ id: 'pot', x: 240, y: 344 });
await pieces.pay(bank, bet, 15);        // the fewest chips that make 15, breaking a 25 if it must
await pieces.collect([bet], pot);       // every bet into the pot
await pieces.move(pot, bank);           // and the pot to the winner
pieces.draggable();                     // pick up a chip and the ones on it; drop or flick them

const button = pieces.token({ label: 'D', x: 300, y: 228 });
await button.moveTo(378, 302);

const dice = [pieces.die({ style: CASINO_DICE }), pieces.die({ style: CASINO_DICE })];
const [a, b] = await pieces.roll(dice, { seed: 1042, from, to });   // the seed's roll, not the animation's

const crib = pieces.pegBoard({ x: 240, y: 70, colors: ['#d23a33', '#2f7fd1'] });
await crib.peg(0, 5);                   // the back peg leapfrogs the front one, five holes on

const saved = pieces.state();           // plain data: stacks, tokens, dice, pegs
pieces.restore(saved);
```

- **Chips** are their denomination: a stack is a list of values, bottom
  first, and its worth is their sum. The arithmetic is pure and in node -
  `makeChange`, `payFrom` (exact change from the stack if any chips add
  up, the fewest that do; otherwise the smallest chip whose change lets it
  pay is broken first), `colorUp`, `stackValue`, `exactChips` - over a
  `ChipSet` of any denominations, not only the casino's.
- **A stack looks like one** from straight above: each chip a thickness
  further up the board than the one under it, so every chip's rim shows as a
  sliver, edge spots and all; nudged and turned a little from the stack's
  seed (`chipStackLayout`: the same mess on every screen, and a chip added
  never moves the others), twenty to a column. Moves change the stacks at
  once and fly the chips; `split`, `merge`, `breakChip` and `colorUp` too.
- **Tokens**: a disc or a pill with a label - `D`, `SB`, `PASS` - or a plain
  player colour. `moveTo` slides one, lifted a little; dragged it can be
  flicked.
- **Dice** are real cubes: six faces drawn as small cards set on the cube,
  only those turned towards the camera drawn, one shadow cast on the felt.
  The result is decided first - a value, or `rollDice(seed)` - and the
  tumble (`dieTumble`) is worked backwards from the resting orientation, so
  it cannot land on anything else and never sinks a corner into the table.
  Pips or numbers; ivory or the casino's red.
- **The peg board**: a lane of 121 holes per player in fives, out and back,
  start holes and the game hole. `peg(player, n)` changes the state at once
  (`scorePegs`) and hops the back peg over the front one into its hole.

Why not zones of the Table? A zone owns cards - identified, ordered, face up
or down, synced by id - and its rules are about cards. Two red fives are the
same chip, a stack is a quantity, and what a dealer does with one has no
card counterpart; dice and a peg board are not containers at all. So
`Pieces` is parallel to the Table, in its words (`stack` for `pile`,
`move`, `draggable`, `on('move')`, `state()`/`restore()`), and neither
needs the other. See the Chips, dice and pegs demo.

## Canned animations

Flips, throws, landing pops and re-fans go through the board's `Animator`.
What an animation adds to a card while it runs (lift, roll, arc, pop) is an
offset on its resting pose, so nothing a tap interrupts is ever left behind.
Each runs on a channel of the card with a policy for being asked again -
`queue`, `latest`, `interrupt`, `finish`, `ignore` - and asks are
**deduplicated** by `intent` (what the animation leaves the card as) and
**debounced**. A flip is a wish for the other side from where the card is
*going*: a burst of taps is one flip, a tap during a flip waits as at most one
more, and a third tap calls that off. Throwing a card again to where it is
already flying, or re-fanning a hand to the places its cards are already
going, carries on rather than starting over.

## The engine, scenes and the page

felt is a game engine, not only a renderer: see [`runtime.md`](runtime.md) for how it
was designed against Phaser, PixiJS, Excalibur, LittleJS, Kaplay, PlayCanvas
and Babylon.

- **One `Engine` per page** (`engine()`; `createEngine()` for tests and
  servers). It runs the only frame loop, on a `Clock` (`RafClock` in a browser,
  `ManualClock` by hand), and every board is a member of it. It sleeps when
  nothing moves. Its `simTime` advances in fixed steps (`onFixedUpdate`, 30
  a second by default, at most 5 a frame, the rest dropped). It owns
  services, so the art's CPU-side pictures (`ArtStore`) are shared by every
  board and outlive any one of them: a board made for the next screen is
  ready in about 150 ms against about 950 cold.
- **The page lifecycle** (`PageLifecycle`): hidden, frozen or put in the
  back/forward cache, the engine requests no frames; back, it drops the gap
  and every board draws itself again, asleep or not. A WebGL context that is
  lost and not restored within a second (`CONTEXT_RESTORE_WAIT_MS`) is
  replaced with a new canvas, and every atlas picture is repainted from how
  it was painted.
- **Scenes and a `Director`**: `defineScene({ name, init, load, create,
  update, fixedUpdate, pause, resume, sleep, wake, shutdown })`. A scene's
  context owns its boards, listeners, timers (`delay`, `every`, `wait`, on
  engine time) and frame callbacks, and undoes them all when the scene ends.
  `director.go(name, data, { fade, keep })` changes screen without the page
  navigating; with `{ hash: true }` the back button works.
- **`Simulation`**: the game as plain data, changed only by commands stamped
  with the tick they apply at, with a saveable seeded `Rng`. Copies fed the
  same commands agree to the bit (`hash()`). It also offers `snapshot`,
  `restore` and `replay`, and runs on the engine's fixed steps or headless.
- **Kept between visits**: rendered court portraits are stored in IndexedDB
  (`PersistedArt`), so the next page load is ready in about half the time.

## Card sheets: the engine owns the pictures

A `CardSprite` does not paint itself, hold atlas regions or wait for art. It
is a card, a pose and a handle on two of the engine's **card sheets**
(`CardSheets.of(board)`):

- a **face sheet** per look - size, layout, stock, inks, court palette,
  density - with one cell per suit and rank, shared by every card of that
  deck. The back colour is not part of it, so four seats with four backs
  share one sheet of faces;
- a **back sheet** per theme, colour and size.

What the engine does with them:

- **Painted on demand, warmed in the background.** A cell is painted the
  first time anything shows it, in a pre-pass before that frame is drawn.
  Once a sheet has been in use for twenty frames the rest of its standard
  deck is painted at 3 ms a frame, so a card turned over later never waits.
  A sheet being scrubbed past (a size slider, a theme button) is never
  warmed.
- **Late art repaints in place.** A court portrait, the index font or a suit
  glyph arriving repaints the cells that wanted it. Cells on screen go at
  once; the rest at 4 ms a frame.
- **Kept, not dropped.** A sheet nobody is using stays (eight face sheets,
  sixteen backs), so dealing again, or going back to a deck already seen,
  paints nothing. Unused sheets are given up, oldest first, only when the
  atlas needs the room.
- **A card is a lookup.** It asks its sheet for `card.suit`/`card.rank` every
  frame, so changing a card's rank shows the new face with nobody telling it;
  `sprite.restyle(style)` moves it to another deck's sheets.

- **No card is drawn half-finished.** On a board that waits for art (the
  default, `createBoard({ waitForArt })`) a card is not drawn until both its
  sheets are finished: the whole standard deck painted, with nothing it asked
  for - the index fonts, a suit glyph, the back, a court portrait - still on
  its way. Art that fails to load is given up on rather than waited for. A
  sheet cards are waiting on is warmed at once and harder (10 ms a frame). A
  card restyled to a look not yet finished goes on showing the old one until
  the new one is, so switching deck never blinks the table.

`loadingReport(board)` says how far the engine has got, stage by stage -
WebGL2, fonts, suit glyphs, backs, court portraits, sheet cells - with when
each finished and what is still awaited; `await cardsReady(board)` is the
first frame the cards are drawn. The **Loading** demo draws it as bars.

Painting itself stays off the GPU's critical path. Each picture is rastered
into a small CPU canvas from CPU-backed sources and shared mip chains; rank
text is rastered once per size and ink. It is uploaded as premultiplied
bytes, and the texture array grows by GPU-side copy.

## From phaser-card-engine

The names were kept wherever the idea survived, so a port is mostly deleting
`this.root` and `scene`:

| phaser-card-engine | felt |
| --- | --- |
| `createBoard({ scene })`, `boardRoot(this)` | `createBoard({...})` - no scene, no root |
| `preloadCardArt(this, ...)` in `preload` | `loadCardArt(board, ...)`, any time (alias `preloadCardArt`) |
| `new CardSprite(this, card, style)` | `new CardSprite(board, card, style)` - same `CardStyle` |
| `orderStack(root, sprites, stack, base)` | `orderStack(sprites, stack, base)` |
| `layHand(this, root, sprites, hand, opts)` | `layHand(board, sprites, hand, opts)` |
| `throwCard(this, sprite, target, opts)` | `throwCard(board, sprite, target, opts)` + `arc` |
| `riffleShuffle(this, root, sprites, stack)` | `riffleShuffle(board, sprites, stack)` |
| `renderCourts(this, palette, opts)` | `renderCourts(board, palette, opts)` |
| `suitTexture(scene, suit, color)` → key | `suitTexture(board, suit, color, size)` → region; `board.image(region, ...)` |
| `new TuckBox(this, x, y, opts)` + `update` | not carried over |
| `toBoard(this, pointer)` | pointers arrive in board units already; `board.toBoard(clientX, clientY)` |
| `this.input.setDraggable(sprite)` + `drag` events | `sprite.draggable = true`; `board.on('dragstart' \| 'drag' \| 'dragend')` |
| `this.add.text`, `this.add.graphics` | `board.text(...)`, `board.graphic(w, h, paint)` |
| `this.tweens.add({...})` | `board.tweens.add({...})` - same shape, same ease names |
| `cardSnapshot`, `cardPlane`, `bendPlane` | gone: every card bends |
| - | `flipCard(board, sprite)`: lift, roll half a turn, land the other side up |
| - | `board.pick(x, y)`, `board.snapshot()`, `board.keepAwake()` |
| - | `animatorOf(board).play(target, { channel, policy, intent, debounce, ... })` |

## The demo

```bash
npm install
npm run demo        # http://localhost:4390, and the LAN address
```

Or [on GitHub Pages](https://exterkamp.github.io/felt/). The index is one
page: every demo is a scene, and moving between them never navigates (each
still works on its own page too), and each shows its own source in a Code
panel.

- **Basics:** from a blank board (the tour), one stack, the engine loading,
  two seats playing one game through a fake network in lockstep, and a
  stress page of four thousand cards.
- **Moving cards:** stacks, hands, throwing, flicking, magnetic stacks,
  dealing hold'em, the riffle.
- **Games and their parts:** solitaire (with undo and resume), tap to move,
  readouts and toasts, chips, dice and pegs, and painted tables - blackjack,
  baccarat, craps, a parlour table of old patterns, and every border.
- **The cards themselves:** card faces, the deck editor, card sizes.

## Testing

```bash
npm test            # typecheck (library, specs, demos) + 440 vitest specs in node
npm run smoke -- --host=http://localhost:4390   # real Chrome, real WebGL2 (SwiftShader)
```

The smoke test drives every demo through CDP and checks what is on screen
against what the geometry asked for: one draw call for the stacks page, the
card a finger lands on is the one drawn in front, a real pointer drag between
piles, all twelve courts rendered, messy angles settled and bounded, hold'em's
deal order and final counts, chips in their colours and dice on their faces, the riffle bending all 52 without ever drawing the
pile over the packets, hands re-fanning without spinning, throws leaving the felt - and that a still board draws no frames.

## What is next

What it does not do yet:

- **Multiplayer, over a real network.** `Simulation` is the deterministic
  state and the lockstep protocol; a transport (WebSocket, WebRTC), joining
  mid-game from a snapshot, and rollback for late commands are next.
- **Replays and hints** from the history: `history.log()` is already the
  move list, and `restoreTable` can step a table through it; a replay player
  and a solver's "show me" are not written yet.
- **Sound**: card snaps, shuffles and deals, unlocked by the first tap.
- **Playing by keyboard**: `selection.tap()` can be driven without a
  pointer and announcements already speak; keys and focus are not wired up.
- **Turns and phases**: whose turn it is, deal - play - score, a turn
  timer, a hook for a computer player. Every game still writes its own.

## Licence

CC0, as phaser-card-engine. The court art is Dmitry Fomin's CC0 English
pattern; the fonts are OFL and Apache-2.0 - see [`ATTRIBUTION.md`](../ATTRIBUTION.md).
