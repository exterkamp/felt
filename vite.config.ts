import { defineConfig, type Connect } from 'vite';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Clean paths for the demo: `/stacks` is the stacks demo, as it is on GitHub
// Pages, which answers a path with the .html of the same name by itself.
// Vite would answer it with stacks.ts - it resolves a bare name to a module
// - so a page asked for by a browser is pointed at its .html first. The page
// then starts the app's router (see demo/kit.ts, standalone).
const cleanPaths: Connect.NextHandleFunction = (req, _res, next) => {
  const [path, query = ''] = (req.url ?? '').split('?');
  const name = /^\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
  if (name && req.headers.accept?.includes('text/html') && existsSync(resolve(__dirname, 'demo', `${name}.html`))) {
    req.url = `/${name}.html${query ? `?${query}` : ''}`;
  }
  next();
};

// The demo, served straight from the package it demonstrates.
//
// publicDir points at the package's own assets, so `/cards/art/...` in the
// browser is exactly the path deckThemePath returns - which is the contract
// this package asks of a consumer, tested here by being a consumer.
export default defineConfig({
  // The bench (demo/bench.html) posts its results here, so a phone's run
  // lands in the dev server's log.
  plugins: [{
    name: 'felt-clean-paths',
    configureServer(server) { server.middlewares.use(cleanPaths); },
    configurePreviewServer(server) { server.middlewares.use(cleanPaths); },
    // Any other path on Pages - a route with no file of its own - is
    // answered with 404.html: the index, so the router can take it from there.
    closeBundle() {
      const out = resolve(__dirname, 'demo-dist');
      if (existsSync(resolve(out, 'index.html'))) copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  }, {
    name: 'felt-bench-log',
    configureServer(server) {
      server.middlewares.use('/__bench', (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { console.log(`[bench] ${body}`); res.end('ok'); });
      });
    },
  }],
  root: 'demo',
  // `/` for the dev server and for `npm run demo:serve`; the project path
  // when GitHub Pages builds it, where the site is not at the root of a
  // host. demo/serve.ts hands the same value to the engine so the card art
  // moves with the pages.
  base: process.env['DEMO_BASE'] ?? '/',
  publicDir: resolve(__dirname, 'assets'),
  resolve: {
    // The subpath first: these are prefix matches, so the bare name would
    // otherwise swallow `@exterkamp/felt/core` and try to open `src/index.ts/core`.
    alias: {
      '@exterkamp/felt/core': resolve(__dirname, 'src/core/index.ts'),
      '@exterkamp/felt': resolve(__dirname, 'src/index.ts'),
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
        readouts: resolve(__dirname, 'demo/readouts.html'),
        pieces: resolve(__dirname, 'demo/pieces.html'),
      },
    },
  },
});
