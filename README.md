# felt

A WebGL2 engine for card games, and nothing else.

Everything [phaser-card-engine](https://github.com/exterkamp/phaser-card-engine)
does, without Phaser underneath it: the same cards, stacks, hands, faces,
courts, decks, throws, deals, riffles and tuck box, drawn by a renderer that
only ever has to draw cards. Every card on the table is one instance of one
instanced draw call, a card can lift, tip, roll and bend because it is a real
two-sided surface in a real (optional) perspective, and a board that nothing
is moving on draws nothing at all.

```ts
import { createBoard, CardSprite, loadCardArt, renderCourts, shuffledDeck, throwCard,
  COURT_PALETTES } from 'felt';

const board = createBoard({ parent: 'board', width: 480, height: 640, backgroundColor: '#13463a' });
void loadCardArt(board);                          // suits, backs, fonts - not required first
void renderCourts(board, COURT_PALETTES.press);   // portraits land when they land

const cards = shuffledDeck().map((card) => new CardSprite(board, { ...card, faceUp: true }));
await throwCard(board, cards[0], { x: 240, y: 320 }, { arc: 28 });
```

## What it is made of

| | |
| --- | --- |
| `src/core/` | Everything that draws nothing, carried over from phaser-card-engine **unchanged** with its tests: cards and suit vocabularies, `Stack` and `Hand` geometry, `cardFaceMetrics` and the three faces, shuffles and `riffleSplit`, the six decks and their inks, court palettes and the background parting, the tuck box as quads. Its own entry point, `felt/core`, and it runs in node. |
| `src/runtime/` | `Engine` (the page's one loop, clock, fixed steps, lifecycle and services), `Clock` (`RafClock`, `ManualClock`), `PageLifecycle`, `Scene` and `Director`, `Disposables`, `Simulation` (deterministic game state for multiplayer). |
| `src/gl/` | `Renderer` (one instanced program for every card and sprite, one depth-tested program for solid meshes), `Atlas` (every picture on a few 2048² layers of one texture array), `lens.ts` (the projection, written once in TypeScript and once in GLSL). |
| `src/scene/` | `Board` (canvas, pixel ratio, fit, input, the sleep-when-still loop), `Node` and `Sprite`, `Tweens` with Phaser's config shape and ease names. |
| `src/art/` | `CardSprite`, the face and back painters, suit pips, the court renderer and its worker, tuck box printing. |
| `src/play/` | `throwCard`, `dealCards`, `layHand`, `orderStack`, `flipCard`, `riffleShuffle`, `TuckBox`. |

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
- **The tuck box needed three meshes in a careful order**, because Phaser
  sorted faces within a mesh and never between them. Here its parts share a
  depth buffer and occlude each other like solid things.

Measured, in the same software-rendered headless Chrome: the hold'em riffle
runs at **54 ms a frame against Phaser's 176**, the whole engine plus core is
**21 kB gzipped** against Phaser's 331 kB, and the stacks page - 52 cards,
every label, every slot - is **74 instances in 1 draw call** (a squared pile is drawn as its top card:
the cards exactly under an opaque one are skipped). A still board draws **0**
frames. On the stress page, 4160 cards all moving every frame cost **2.5 ms**
of CPU a frame, flat or in 3D. A cold start is ready in about 0.6 s, and a
load with the courts kept from the last visit in about 0.2 s.

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
| `new TuckBox(this, x, y, opts)` + `update` | `new TuckBox(board, x, y, opts)` - steps itself while it spins |
| `toBoard(this, pointer)` | pointers arrive in board units already; `board.toBoard(clientX, clientY)` |
| `this.input.setDraggable(sprite)` + `drag` events | `sprite.draggable = true`; `board.on('dragstart' \| 'drag' \| 'dragend')` |
| `this.add.text`, `this.add.graphics` | `board.text(...)`, `board.graphic(w, h, paint)` |
| `this.tweens.add({...})` | `board.tweens.add({...})` - same shape, same ease names |
| `cardSnapshot`, `cardPlane`, `bendPlane` | gone: every card bends |
| - | `flipCard(board, sprite)`: lift, roll half a turn, land the other side up |
| - | `board.pick(x, y)`, `board.snapshot()`, `board.keepAwake()` |
| - | `animatorOf(board).play(target, { channel, policy, intent, debounce, ... })` |

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

felt is a game engine, not only a renderer: see `docs/runtime.md` for how it
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

## The demo

```bash
npm install
npm run demo        # http://localhost:4390, and the LAN address
```

The index is one page: every demo is a scene, and moving between them never
navigates (each still works on its own page too). There are three basics -
one stack, the engine loading, and two seats playing one game through a fake
network in lockstep - then the same nine pages as phaser-card-engine's - stacks, card sizes, throwing,
hold'em, hands, the deck editor, the riffle, the tuck box, card faces - ported
to felt. Some do more than before: thrown cards arc off the felt, cards dealt
face up flip over in the air, and the riffled packets are the cards
themselves.

## Testing

```bash
npm test            # typecheck (library, specs, demos) + 320 vitest specs in node
npm run smoke -- --host=http://localhost:4390   # real Chrome, real WebGL2 (SwiftShader)
```

The smoke test drives every demo through CDP and checks what is on screen
against what the geometry asked for: one draw call for the stacks page, the
card a finger lands on is the one drawn in front, a real pointer drag between
piles, all twelve courts rendered, messy angles settled and bounded, hold'em's
deal order and final counts, the riffle bending all 52 without ever drawing the
pile over the packets, hands re-fanning without spinning, the tuck box handing
over its deck, throws leaving the felt - and that a still board draws no frames.

## What is next

This is the reimplementation. What it was built to be good at, and does not do
yet:

- **Multiplayer, over a real network.** `Simulation` is the deterministic
  state and the lockstep protocol; a transport (WebSocket, WebRTC), joining
  mid-game from a snapshot, and rollback for late commands are next.
- **Lighting and materials** for the 3D cards: a light direction, a sheen on
  the stock, real cast shadows onto the felt rather than the card's own halo.
- **A stress page** - a thousand cards in flight - to measure on real GPUs.

## Licence

CC0, as phaser-card-engine. The court art is Dmitry Fomin's CC0 English
pattern; the fonts are OFL and Apache-2.0 - see `ATTRIBUTION.md`.
