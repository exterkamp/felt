import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The demo, served straight from the package it demonstrates.
//
// publicDir points at the package's own assets, so `/cards/art/...` in the
// browser is exactly the path deckThemePath returns - which is the contract
// this package asks of a consumer, tested here by being a consumer.
export default defineConfig({
  root: 'demo',
  // `/` for the dev server and for `npm run demo:serve`; the project path
  // when GitHub Pages builds it, where the site is not at the root of a
  // host. demo/serve.ts hands the same value to the engine so the card art
  // moves with the pages.
  base: process.env['DEMO_BASE'] ?? '/',
  publicDir: resolve(__dirname, 'assets'),
  resolve: {
    // The subpath first: these are prefix matches, so the bare name would
    // otherwise swallow `felt/core` and try to open `src/index.ts/core`.
    alias: {
      'felt/core': resolve(__dirname, 'src/core/index.ts'),
      'felt': resolve(__dirname, 'src/index.ts'),
    },
  },
  // Bound to every interface on purpose: the point of this demo is a card
  // game, and a card game is tested with a thumb. `npm run demo` prints the
  // LAN address alongside localhost - open that one on a phone.
  //
  // allowedHosts covers reaching the machine by name rather than by number;
  // Vite blocks unknown Host headers by default (DNS rebinding protection)
  // and raw IPs are allowed already, so this is only for `http://box.local`
  // style addresses.
  server: {
    host: '0.0.0.0',
    port: Number(process.env['PORT'] ?? 4390),
    allowedHosts: ['.local', '.lan', '.home', '.internal'],
  },
  preview: { host: '0.0.0.0', port: 4391 },
  build: {
    outDir: resolve(__dirname, 'demo-dist'),
    emptyOutDir: true,
    // Every page, by name: rollup needs each entry point listed.
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'demo/index.html'),
        'one-stack': resolve(__dirname, 'demo/one-stack.html'),
        loading: resolve(__dirname, 'demo/loading.html'),
        seats: resolve(__dirname, 'demo/seats.html'),
        stress: resolve(__dirname, 'demo/stress.html'),
        flick: resolve(__dirname, 'demo/flick.html'),
        magnets: resolve(__dirname, 'demo/magnets.html'),
        tables: resolve(__dirname, 'demo/tables.html'),
        tour: resolve(__dirname, 'demo/tour.html'),
        solitaire: resolve(__dirname, 'demo/solitaire.html'),
        select: resolve(__dirname, 'demo/select.html'),
        stacks: resolve(__dirname, 'demo/stacks.html'),
        sizes: resolve(__dirname, 'demo/sizes.html'),
        throws: resolve(__dirname, 'demo/throws.html'),
        holdem: resolve(__dirname, 'demo/holdem.html'),
        hands: resolve(__dirname, 'demo/hands.html'),
        deck: resolve(__dirname, 'demo/deck.html'),
        shuffle: resolve(__dirname, 'demo/shuffle.html'),
        faces: resolve(__dirname, 'demo/faces.html'),
      },
    },
  },
});
