# felt

WebGL2 card-game engine; the Phaser-free successor to `~/code/phaser-card-engine`.

- Node 24 (`.nvmrc`): `source ~/.nvm/nvm.sh && nvm use 24`
- `npm test` — typecheck (lib + specs + demos) and vitest (node, no browser)
- `npm run build` — tsc to `dist/`
- Demo: `devrun up --name felt-demo --port-env PORT -- npx vite` (vite.config.ts reads `$PORT`)
- Smoke (real Chrome via CDP + SwiftShader): `npm run smoke -- --host=$(devrun url felt-demo)`

Layout: `src/core` is phaser-card-engine's pure half copied verbatim — change it
there first if a fix should reach both. `src/runtime` engine/clock/lifecycle/
scenes/simulation, `src/gl` renderer/atlas/lens, `src/scene` board/nodes/tweens,
`src/art` painters, `src/play` gestures.

Rules (see docs/runtime.md): nothing in module state but constants and the one
`engine()`. Page-wide things are engine services; per-context things are board
services. Anything a scene starts goes through its context so it is undone
when the scene ends. No raw `setTimeout` or `requestAnimationFrame` in demos.
Every demo is a scene (`defineScene` + `standalone(scene)`), calls
`showCode(ctx)`, and wraps the code its feature is in with `// #region Title`
/ `// #endregion` - the Code panel (`demo/code.ts`) shows those regions from
the demo's own source, so keep them on the code that matters. The tour
(`demo/tour.ts`, "From a blank board") instead calls `showRegions(ctx)`, which
fills each `<pre data-region="Title">` in its page with that region; change
its prose in `tour.html` when the code it explains changes.

The projection is written twice — `src/gl/lens.ts` and `PROJECT` in
`src/gl/shaders.ts` — and picking/`deckCentre` depend on them agreeing.

Verify visual changes in a real browser (smoke + a screenshot); the bugs this
lineage keeps hitting are "right numbers, wrong screen".
