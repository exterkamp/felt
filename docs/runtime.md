# felt's runtime: what a game engine needs, and how felt does it

felt began as a renderer for cards: `createBoard()` makes a canvas, a WebGL2
context, an atlas, a tween list and a requestAnimationFrame loop that sleeps
when nothing moves. That is a good renderer. It is not yet an engine. An
engine also owns **time**, the **page's lifecycle**, the **things that
outlive one view**, and **teardown**. This note records what is wrong today,
what other engines do, and the primitives felt should grow.

## What "dies going from page to page" is

Measured in headless Chrome (SwiftShader), 2026-11-05:

- 44 navigations between the demo pages by link: every page came up and
  drew. Headless Chrome refuses the back/forward cache
  (`BackForwardCacheDisabledForDelegate`), so the cached-page path a real
  browser takes could not be exercised there.
- **Every page starts from nothing.** The board is up 0.2 s after
  navigation; the cards are drawable at **1.1 s** (fonts 0.22 s, glyphs
  0.19 s, the twelve courts 1.08 s, the sheet 1.11 s). Every cache - the
  court rasters, the glyph mips, the text rasters, the worker - lives in
  module state that dies with the page. Since cards now wait for their art,
  that second is an empty felt on every navigation; on a phone it is
  several.
- **A lost context that is never restored is permanent.** felt handles
  `webglcontextlost` and `webglcontextrestored`, but if the browser never
  sends the second one (it is allowed not to; Safari and mobile Chrome
  sometimes don't, and a page coming out of the back/forward cache may come
  back with its context already gone), the board waits forever. Reproduced:
  lose the context with no restore and the board stays at the same frame
  count, dead.
- **Nothing listens to the page lifecycle.** There is no handling of
  `visibilitychange`, `pagehide`/`pageshow` (`persisted`), or
  `freeze`/`resume`. A board that is asleep, which is most of the time, draws
  nothing when the page comes back. With `preserveDrawingBuffer: false`, any
  time the browser throws the canvas's pixels away without a context event,
  the board stays blank until something happens to touch it. That is also
  the most likely cause of the earlier report, "we just randomly lost all the
  cards".

Not reproduced on a real GPU here: the sandbox cannot reach one. The three
causes above are certain from the code. Which one the user saw is not yet
known.

## What felt has today, by concern

| Concern | Today | Problem |
| --- | --- | --- |
| Loop | One rAF loop per board, sleeps when still, delta clamped to 100 ms | Several boards mean several loops. No pause or resume, no fixed step, no injectable clock. |
| Time | `board.time` (render time); the animator's debounce uses `performance.now()` | Two clocks, neither injectable. Simulation time and render time are not separate. |
| Lifecycle | Context lost/restored only | No visibility, bfcache, freeze or focus handling. No watchdog for a context that never comes back. |
| Art | `CardArt`/`CardSheets`/`Loading` per board, in `board.services`. Court rasters, page cache and worker are module singletons | GPU-bound and GPU-free state are mixed. Rasters (context-free, reusable) are thrown away with every board and every page. |
| Scenes | None: a page is a scene | Changing "screen" means a navigation, which means a cold start. |
| Teardown | `board.destroy()` cancels rAF, observers, canvas listeners, GL objects | Services are not disposed, timers and `setTimeout`s are not scoped, the worker pool is not owned by anyone. |
| Tests/server | Specs run on plain objects and `{ tweens }` | No headless engine, so an authoritative server cannot run the same loop. |


## What other engines do

Phaser 3.90 was read from its source in phaser-card-engine. The other six
were read from their published npm packages: pixi.js 8.22, excalibur 0.32,
littlejsengine 1.29, kaplay 3001.0.19, playcanvas 2.23 and
@babylonjs/core 9.34, plus three.js r187.

| | Loop | Hidden tab / resume | Context loss | Global state | Scenes |
| --- | --- | --- | --- | --- | --- |
| **Phaser** | `TimeStep`: rAF on every frame, never idle. Delta smoothed over 10 frames, "panic" reset after 120 | `visibilitychange` pauses the loop. Resume and focus reset the delta. Blur and focus are tracked | preventDefault, rebuild | One `Game` owns textures, cache, registry, input, sound, scale and plugins. A per-scene `Systems` holds the per-scene plugins | init, preload, create, update; pause/resume, sleep/wake, shutdown, destroy; transitions |
| **PixiJS 8** | `Ticker`: variable delta capped at 100 ms. **No listeners means no rAF** | nothing | preventDefault, re-upload textures lazily from CPU sources | `Ticker.shared` and `Assets` are module singletons, which hurt a second app on the page | none |
| **Excalibur** | Injectable `Clock`. Optional fixed step with interpolation. A gap over 200 ms is dropped | `hidden`/`visible` events; audio pauses | gives up and shows a "refresh the page" overlay | Loader, input and textures belong to each engine | onPreLoad, onInitialize, onActivate, onDeactivate; `Director` with transitions |
| **LittleJS** | Fixed 60 Hz accumulator; drops time after a 250 ms gap | audio suspends | **draws through Canvas2D while the context is lost**, then re-creates everything from kept images | all module-level: one game per page, no destroy | none |
| **Kaplay** | Fixed-step `fixedUpdate` plus variable update. Delta capped at 0.25 s; the gap is skipped on show | keeps scheduling rAF while hidden, but skips the work | none | one module context: a second `kaplay()` quits the first | `scene`/`go`; clears every handler on change |
| **PlayCanvas** | Delta clamped to 0.1 s. `autoRender=false` plus `renderNextFrame` renders on demand | sound only | each resource has loseContext/restoreContext | a module "current app" | script hooks; **the best ordered, deferred `destroy()`** |
| **Babylon** | `runRenderLoop`; rAF stops when the loop list is empty. Optional deterministic lockstep, max 4 steps | blur/focus flag only | preventDefault, rebuild everything, observables | `EngineStore.LastCreated*` breaks two engines on a page | ready and dispose observables; `NullEngine` for headless |

**None of them handles `pagehide`/`pageshow`/`freeze`.** The
back/forward cache is not handled anywhere: felt has to do it itself.
What they all share:

- one loop object with start and stop;
- a delta that is clamped, or a gap that is dropped rather than caught up;
- an optional fixed step with a cap;
- `preventDefault` on context loss;
- audio paused while hidden;
- a layered `destroy` that removes every listener it added.

What they get wrong, and felt should not:

- module singletons (Pixi, Kaplay, LittleJS, Babylon's `LastCreated*`);
- giving up on context loss (Excalibur);
- running rAF while hidden (Kaplay);
- clearing all handlers on a scene change (Kaplay).

## The primitives felt needs

Four objects, each owning the lifetime of what hangs off it. Nothing lives in
module state except constants.

### 1. `Engine`: one per page, the singleton

`engine()` returns the page's engine, made on first use. `createEngine()`
makes another, for tests and for a server. It is an object, not module state,
so two never fight. It owns:

- **The clock and the loop.** One rAF for every board on the page,
  scheduled through a `Clock` (`RafClock`, or `ManualClock` for tests and
  headless runs). The loop's phases are input, then `fixedUpdate` × n, then
  `update(dt)`, then animations and tweens, then `beforeRender` (the paint
  budget), then render of the dirty boards only, then `postRender`. It
  sleeps when no phase has work, as now. It is woken by touches, and also by
  every lifecycle event below.
- **Two times.** *Simulation time* advances in fixed steps (default 30 Hz,
  at most 5 steps a frame) and drives game rules, turn timers and netcode.
  *Render time* is variable and drives animation. The animator's debounce
  moves onto the engine's clock.
- **The page lifecycle.** The engine handles `visibilitychange`,
  `pagehide`/`pageshow` (`persisted`), `freeze`/`resume`, `blur`/`focus`, a
  change of devicePixelRatio, and resize.
  - Hidden or frozen: pause, so simulation time stops and no rAF runs.
  - Visible or resumed: drop the gap, check every board's context, re-fit,
    and **force one frame on every board**. A sleeping board is never left
    blank.
  - Games subscribe to `engine.on('hidden' | 'visible' | 'restored')`.
- **Context-free art.** Everything that is CPU pixels rather than GPU
  textures: fonts, suit glyphs and their mips, text rasters, court rasters,
  the court worker pool. It is shared by every board, it survives a board
  being destroyed, and it can be **persisted** (Cache Storage) so the next
  page starts warm.
- **Registries.** Boards, scenes and global input (keyboard).

### 2. `Board`: a view onto one canvas

What it is today, minus the loop and the art caches. A board owns its canvas,
its GL context, the atlas, the sheets (GPU regions painted from the engine's
art), picking and pointer input. It is driven by the engine's loop.

It gets a **context watchdog**. If a lost context is not restored within
about a second of the page being visible, the board throws the canvas away,
makes a new one, and replays the atlas. felt can do this because every
region already records how it was painted.

### 3. `Scene`: one screen of a game

The lifecycle is Phaser's, and it is what card games need: lobby, table,
results.

- **Hooks:** `init(data)`, `load()`, `create()`, `update(dt)`,
  `fixedUpdate(step)`, `pause`/`resume`, `sleep`/`wake`, `shutdown`,
  `destroy`.
- **Owned and disposed with it:** tweens, the animator's channels, timers
  (`scene.delay(ms)` on the clock, never `setTimeout`), board listeners and
  nodes.
- **A `Director`** with `go(name, data, { transition })`. Changing screen is
  then a scene change inside one page: no navigation, no cold start.

### 4. `Disposables`: the teardown discipline

Every `on`, `beforeRender`, `keepAwake` and timer returns a disposer, and is
registered to a scope (engine, board or scene). Destroying a scope runs them
in reverse order.

`destroy()` called mid-frame is deferred to the end of the frame, as
PlayCanvas does. The order is scenes, then boards (and GL), then the engine
(lifecycle listeners, workers).

### Later, for multiplayer

A headless engine is an `Engine` with a `ManualClock` and no boards. It runs
the same fixed-step simulation on a server, or in a test, deterministically
with the seeded RNG felt already has.

## The order to build it in

1. **Lifecycle and recovery** (small; fixes the blank board directly): the
   page-lifecycle listeners, a forced redraw on visible/pageshow/resume, the
   context watchdog and canvas rebuild, and the delta dropped on resume.
   Smoke tests use `Page.setWebLifecycleState`, and a context lost with no
   restore.
2. **`Engine` and one loop:** the clock, the phases, and moving the
   context-free art into the engine, so a second board is warm.
3. **`Scene` and `Director`,** and the demos as one page with a director, so
   moving between them is a scene change.
4. **Fixed step, `ManualClock`, headless:** the base for multiplayer state.
5. **Persisted raster cache,** so a cold page load paints from the last
   visit's courts instead of re-rendering them for a second.

## Status (2026-11-05): built

All five steps are in, each verified by unit specs and the CDP smoke test:

| Step | Where | Verified by |
| --- | --- | --- |
| 1. Lifecycle and recovery | `src/runtime/lifecycle.ts`, `Board.lifecycle`/`rebuild` | Hidden pages draw nothing. Shown, thawed and back/forward-restored pages redraw unasked. A context lost and never restored gets a new canvas with every card |
| 2. Engine and one loop | `src/runtime/engine.ts`, `clock.ts`, `ArtStore` | A board made again on the same engine is ready in about 155 ms against about 950 cold, with no art fetched again |
| 3. Scenes and Director | `src/runtime/scene.ts`, `demo/app.ts` | All 12 demos open as scenes in one document. Leaving one leaves no canvas, board, timer or meter. Back and forward work |
| 4. Fixed step, ManualClock, headless | `src/runtime/simulation.ts`, the Two seats demo | A server and two seats agree on every tick. An out-of-turn play is refused everywhere. Nothing is late at 400 ms |
| 5. Persisted rasters | `src/art/persisted-art.ts` | The next load draws its 12 courts from IndexedDB and is ready in about 505 ms against about 1009 |

`Page.setWebLifecycleState` hangs headless Chrome after a thaw (even a page
with no board), so the smoke test dispatches the lifecycle events in the page.
