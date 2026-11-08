import { afterEach, describe, expect, it, vi } from 'vitest';
import { compilePath, createRouter, type RouteMatch, type SceneHost } from './router.js';
import type { GoOptions, Scene } from './scene.js';

/** A director that only records what it was asked to do. */
function fakeDirector(names: string[] = []) {
  const known = new Set(names);
  const went: { name: string; data: unknown; options?: GoOptions }[] = [];
  const host: SceneHost = {
    async go(name, data, options) {
      if (!known.has(name)) throw new Error(`no scene ${name}`);
      went.push({ name, data, options });
    },
    has: (name) => known.has(name),
    add: (scene) => { known.add(scene.name); },
  };
  return { host, went, known };
}

const scene = (name: string): Scene<never> => ({ name, create() {} });

describe('compilePath', () => {
  it('matches fixed paths, params and a trailing wildcard', () => {
    expect(compilePath('/')('/')).toEqual({});
    expect(compilePath('/stacks')('/stacks')).toEqual({});
    expect(compilePath('/stacks')('/hands')).toBeUndefined();
    expect(compilePath('/play/:game')('/play/klondike')).toEqual({ game: 'klondike' });
    expect(compilePath('/play/:game')('/play')).toBeUndefined();
    expect(compilePath('/play/:game')('/play/a/b')).toBeUndefined();
    expect(compilePath('/play/:game')('/play/hello%20world')).toEqual({ game: 'hello world' });
    expect(compilePath('/files/*')('/files/a/b/c')).toEqual({ '*': 'a/b/c' });
    expect(compilePath('/files/*')('/files')).toEqual({ '*': '' });
    expect(compilePath('*')('/any/thing')).toEqual({ '*': 'any/thing' });
  });

  it('does not match a param that will not decode', () => {
    expect(compilePath('/play/:game')('/play/%E0%A4%A')).toBeUndefined();
  });
});

describe('a router, in memory', () => {
  it('starts at its initial route and shows that scene', async () => {
    const d = fakeDirector(['index', 'stacks']);
    const router = createRouter(d.host, {
      mode: 'memory', initial: '/stacks',
      routes: [{ path: '/', scene: 'index' }, { path: '/stacks', scene: 'stacks' }],
    });
    await router.start();
    expect(d.went.map((g) => g.name)).toEqual(['stacks']);
    expect(router.current?.path).toBe('/stacks');
  });

  it('gives the scene its params and query, or what data makes of them', async () => {
    const d = fakeDirector(['table']);
    const router = createRouter(d.host, {
      mode: 'memory',
      routes: [{ path: '/play/:game', scene: 'table', data: (m) => ({ game: m.params.game, seed: m.query.get('seed') }) },
        { path: '/', scene: 'table' }],
    });
    await router.start();
    await router.navigate('/play/yukon?seed=7');
    expect(d.went.at(-1)?.data).toEqual({ game: 'yukon', seed: '7' });
  });

  it('restarts the same scene for a different URL, and does nothing for the same one', async () => {
    const d = fakeDirector(['table']);
    const router = createRouter(d.host, { mode: 'memory', initial: '/play/a', routes: [{ path: '/play/:game', scene: 'table' }] });
    await router.start();
    await router.navigate('/play/b');
    await router.navigate('/play/b');
    expect(d.went.map((g) => (g.data as RouteMatch).params.game)).toEqual(['a', 'b']);
    expect(d.went[1].options?.restart).toBe(true);
  });

  it('follows redirects, including from a function, and the catch-all', async () => {
    const d = fakeDirector(['index', 'table']);
    const router = createRouter(d.host, {
      mode: 'memory',
      routes: [
        { path: '/', scene: 'index' },
        { path: '/play/:game', scene: 'table' },
        { path: '/game/:game', redirect: (m) => `/play/${m.params.game}` },
        { path: '*', redirect: '/' },
      ],
    });
    await router.start();
    await router.navigate('/game/golf');
    expect(router.current?.url).toBe('/play/golf');
    await router.navigate('/nowhere');
    expect(router.current?.path).toBe('/');
  });

  it('refuses a redirect loop', async () => {
    const d = fakeDirector(['index']);
    const router = createRouter(d.host, {
      mode: 'memory', routes: [{ path: '/', scene: 'index' }, { path: '/a', redirect: '/b' }, { path: '/b', redirect: '/a' }],
    });
    await router.start();
    await expect(router.navigate('/a')).rejects.toThrow(/loop/);
  });

  it('asks the guard, which can refuse or send somewhere else', async () => {
    const d = fakeDirector(['index', 'secret', 'login']);
    let allowed = false;
    const router = createRouter(d.host, {
      mode: 'memory',
      routes: [{ path: '/', scene: 'index' }, { path: '/secret', scene: 'secret' }, { path: '/login', scene: 'login' },
        { path: '/closed', scene: 'secret' }],
      guard: (to) => (to.path === '/closed' ? false : to.path === '/secret' && !allowed ? '/login' : true),
    });
    await router.start();
    await router.navigate('/secret');
    expect(router.current?.path).toBe('/login');
    await router.navigate('/closed');
    expect(router.current?.path).toBe('/login');
    allowed = true;
    await router.navigate('/secret');
    expect(router.current?.path).toBe('/secret');
  });

  it('loads a lazy scene once, from a module or a scene, and adds it to the director', async () => {
    const d = fakeDirector(['index']);
    const load = vi.fn(async () => ({ scene: scene('late') }));
    const router = createRouter(d.host, {
      mode: 'memory', routes: [{ path: '/', scene: 'index' }, { path: '/late', scene: load }, { path: '/also', scene: scene('also') }],
    });
    await router.start();
    await router.navigate('/late');
    await router.navigate('/');
    await router.navigate('/late');
    await router.navigate('/also');
    expect(load).toHaveBeenCalledTimes(1);
    expect(d.known.has('late') && d.known.has('also')).toBe(true);
    expect(d.went.map((g) => g.name)).toEqual(['index', 'late', 'index', 'late', 'also']);
  });

  it('lets the newest of two navigations win', async () => {
    const d = fakeDirector(['index', 'b']);
    let release!: () => void;
    const slow = new Promise<{ scene: Scene<never> }>((resolve) => { release = () => resolve({ scene: scene('a') }); });
    const router = createRouter(d.host, {
      mode: 'memory', routes: [{ path: '/', scene: 'index' }, { path: '/a', scene: () => slow }, { path: '/b', scene: 'b' }],
    });
    await router.start();
    const first = router.navigate('/a');
    await router.navigate('/b');
    release();
    await first;
    expect(router.current?.path).toBe('/b');
    expect(d.went.map((g) => g.name)).toEqual(['index', 'b']);
  });

  it('keeps a scene asleep when its route asks', async () => {
    const d = fakeDirector(['lobby', 'table']);
    const router = createRouter(d.host, {
      mode: 'memory', routes: [{ path: '/', scene: 'lobby', keep: true }, { path: '/t', scene: 'table' }],
    });
    await router.start();
    await router.navigate('/t');
    expect(d.went[1].options?.keep).toBe(true);
  });

  it('goes back through its own history', async () => {
    const d = fakeDirector(['index', 'a']);
    const router = createRouter(d.host, { mode: 'memory', routes: [{ path: '/', scene: 'index' }, { path: '/a', scene: 'a' }] });
    await router.start();
    await router.navigate('/a');
    router.back();
    await vi.waitFor(() => expect(router.current?.path).toBe('/'));
  });

  it('reports every route shown', async () => {
    const d = fakeDirector(['index', 'a']);
    const router = createRouter(d.host, { mode: 'memory', routes: [{ path: '/', scene: 'index' }, { path: '/a', scene: 'a' }] });
    const seen: string[] = [];
    router.onChange((m) => seen.push(m.path));
    await router.start();
    await router.navigate('/a');
    expect(seen).toEqual(['/', '/a']);
  });
});

// --- the History API, against a fake browser -----------------------------------

function fakeBrowser(start: string) {
  let url = new URL(start, 'https://example.test');
  const stack = [url.href];
  let at = 0;
  const listeners = new Map<string, Set<() => void>>();
  const location = {
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get hash() { return url.hash; },
    get href() { return url.href; },
    get origin() { return url.origin; },
  };
  const history = {
    pushState: (_: unknown, __: string, href: string) => {
      url = new URL(href, url); stack.splice(at + 1); stack.push(url.href); at = stack.length - 1;
    },
    replaceState: (_: unknown, __: string, href: string) => { url = new URL(href, url); stack[at] = url.href; },
    back: () => {
      if (at === 0) return;
      at--; url = new URL(stack[at]);
      for (const l of listeners.get('popstate') ?? []) l();
    },
  };
  const window = {
    addEventListener: (type: string, l: () => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(l); },
    removeEventListener: (type: string, l: () => void) => { listeners.get(type)?.delete(l); },
    scrollTo: () => {},
  };
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', history);
  vi.stubGlobal('window', window);
  return { get url() { return url; }, stack };
}

describe('a router, on real paths', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads the route from the path under its base, and writes it back there', async () => {
    const browser = fakeBrowser('/felt/stacks?x=1');
    const d = fakeDirector(['index', 'stacks', 'table']);
    const router = createRouter(d.host, {
      base: '/felt/', links: false,
      routes: [{ path: '/', scene: 'index' }, { path: '/stacks', scene: 'stacks' }, { path: '/play/:game', scene: 'table' }],
    });
    await router.start();
    expect(router.current?.url).toBe('/stacks?x=1');
    await router.navigate('/play/yukon');
    expect(browser.url.pathname).toBe('/felt/play/yukon');
    expect(router.href('/')).toBe('/felt/');
    expect(router.href('stacks')).toBe('/felt/stacks');
  });

  it('treats the base without its slash as the root', async () => {
    fakeBrowser('/felt');
    const d = fakeDirector(['index']);
    const router = createRouter(d.host, { base: '/felt', links: false, routes: [{ path: '/', scene: 'index' }] });
    await router.start();
    expect(router.current?.path).toBe('/');
  });

  it('moves an old #/name link onto its real path', async () => {
    const browser = fakeBrowser('/felt/#/stacks');
    const d = fakeDirector(['index', 'stacks']);
    const router = createRouter(d.host, {
      base: '/felt/', links: false, routes: [{ path: '/', scene: 'index' }, { path: '/stacks', scene: 'stacks' }],
    });
    await router.start();
    expect(router.current?.path).toBe('/stacks');
    expect(browser.url.pathname).toBe('/felt/stacks');
    expect(browser.url.hash).toBe('');
  });

  it('follows the back button', async () => {
    fakeBrowser('/felt/');
    const d = fakeDirector(['index', 'stacks']);
    const router = createRouter(d.host, {
      base: '/felt/', links: false, routes: [{ path: '/', scene: 'index' }, { path: '/stacks', scene: 'stacks' }],
    });
    await router.start();
    await router.navigate('/stacks');
    history.back();
    await vi.waitFor(() => expect(router.current?.path).toBe('/'));
    expect(d.went.map((g) => g.name)).toEqual(['index', 'stacks', 'index']);
  });

  it('puts the URL back when a guard refuses a back', async () => {
    const browser = fakeBrowser('/felt/');
    const d = fakeDirector(['index', 'table']);
    let leave = false;
    const router = createRouter(d.host, {
      base: '/felt/', links: false,
      routes: [{ path: '/', scene: 'index' }, { path: '/table', scene: 'table' }],
      guard: (to, from) => leave || from?.path !== '/table',
    });
    await router.start();
    await router.navigate('/table');
    history.back();
    await vi.waitFor(() => expect(browser.url.pathname).toBe('/felt/table'));
    expect(router.current?.path).toBe('/table');
  });
});
