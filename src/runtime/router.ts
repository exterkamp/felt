import type { Dispose } from './disposables.js';
import type { GoOptions, Scene } from './scene.js';

// Routes: which scene a URL means, and the URL a scene is at.
//
// The Director moves between scenes without the page navigating; this is
// what ties that to the address bar. A table of routes - a path, the scene
// it shows, what that scene is given - and a router that keeps the two in
// step: a link followed, the back button, a reload or a URL pasted in all
// end up at the same scene with the same data.
//
// Real paths by default (`/play/klondike`), through the History API, so a
// URL reads like any other site's. That asks one thing of the server: a
// path it has no file for has to answer with the page that runs the
// router. (GitHub Pages serves `stacks.html` for `/stacks` by itself, and a
// copy of the page as `404.html` covers the rest.) Where that cannot be
// arranged, `mode: 'hash'` keeps the route after a `#` instead, and
// `mode: 'memory'` keeps it nowhere - for tests, and for a board embedded in
// somebody else's page that must not touch their URL.
//
// Rolled here rather than taken from a router library because the hard half
// of routing - changing screens one at a time, ending the old one cleanly,
// keeping one asleep to come back to - is the Director's already, and felt
// has no runtime dependencies. What is left is matching paths, which is a
// page of code.

/** What a route path matched: its `:params`, the query string, and the URL. */
export interface RouteMatch {
  /** The route it matched. */
  readonly route: Route;
  /** The path, inside the base: `/play/klondike`. */
  readonly path: string;
  /** `:name` segments, decoded; a trailing `*` as `params['*']`. */
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** The fragment after the route, without its `#`. Empty in hash mode. */
  readonly fragment: string;
  /** Path and query, as `navigate` would take it back. */
  readonly url: string;
}

type SceneModule = Scene<never> | { scene: Scene<never> } | { default: Scene<never> };

export interface Route {
  /**
   * `/`, `/stacks`, `/play/:game`, `/files/*`, or `*` for anything not
   * matched by a route before it. Matched in order; the first wins.
   */
  readonly path: string;
  /**
   * The scene: one the director already has, by name; the scene itself; or a
   * function that loads it - `() => import('./table')` - called the first
   * time the route is wanted, so a scene's code arrives when it is needed.
   */
  readonly scene?: string | Scene<never> | (() => SceneModule | Promise<SceneModule>);
  /** Somewhere else instead: a path, or one worked out from the match. Replaces the URL. */
  readonly redirect?: string | ((match: RouteMatch) => string);
  /** What the scene is started with. Default the match itself. */
  readonly data?: (match: RouteMatch) => unknown;
  /** The page's title while the route shows. */
  readonly title?: string | ((match: RouteMatch) => string);
  /** Keep the scene asleep when it is left, to wake when its route is come back to. */
  readonly keep?: boolean;
  /** Milliseconds to fade out and in. Default the router's. */
  readonly fade?: number;
}

/** What a guard says: go on, stay put, or go here instead. */
export type GuardResult = boolean | string;

export interface RouterOptions {
  readonly routes: readonly Route[];
  /** Where the route lives: the path (default), after a `#`, or nowhere. */
  readonly mode?: 'history' | 'hash' | 'memory';
  /** The path the app is served under: `/felt/`. Default `/`. Not used in hash or memory mode. */
  readonly base?: string;
  /** Asked before every change; see GuardResult. A navigation it refuses leaves the URL where it was. */
  readonly guard?: (to: RouteMatch, from: RouteMatch | undefined) => GuardResult | Promise<GuardResult>;
  /** Follow clicks on links to routes as scene changes. Default true. */
  readonly links?: boolean;
  /** Milliseconds to fade between scenes. Default 0. */
  readonly fade?: number;
  /** Back to the top of the page after a navigation (not after back or forward). Default true. */
  readonly scroll?: boolean;
  /** Where memory mode starts. Default `/`. */
  readonly initial?: string;
}

export interface NavigateOptions {
  /** Replace the current history entry rather than adding one. */
  readonly replace?: boolean;
}

/** The part of a Director a router drives. */
export interface SceneHost {
  go<D>(name: string, data?: D, options?: GoOptions): Promise<void>;
  has(name: string): boolean;
  add(scene: Scene<never>): unknown;
}

interface Compiled {
  readonly route: Route;
  readonly match: (path: string) => Record<string, string> | undefined;
  readonly catchAll: boolean;
}

/** Turns a route path into a matcher. Exported for the tests. */
export function compilePath(path: string): (path: string) => Record<string, string> | undefined {
  if (path === '*') return (p) => ({ '*': p.replace(/^\//, '') });
  const parts = split(path);
  const rest = parts[parts.length - 1] === '*';
  const fixed = rest ? parts.slice(0, -1) : parts;
  return (candidate) => {
    const got = split(candidate);
    if (rest ? got.length < fixed.length : got.length !== fixed.length) return undefined;
    const params: Record<string, string> = {};
    for (let i = 0; i < fixed.length; i++) {
      const want = fixed[i];
      const seg = got[i];
      if (want.startsWith(':')) {
        try {
          params[want.slice(1)] = decodeURIComponent(seg);
        } catch {
          return undefined;
        }
      } else if (want !== seg) {
        return undefined;
      }
    }
    if (rest) params['*'] = got.slice(fixed.length).join('/');
    return params;
  };
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Puts a base in the form `/felt/`: leading and trailing slash. */
function normaliseBase(base: string): string {
  const trimmed = base.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

/** A path, made absolute inside the app: `stacks` and `./stacks` are `/stacks`. */
function normalisePath(path: string): string {
  const clean = `/${path.replace(/^\.?\/+/, '').replace(/^\.$/, '')}`;
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

/**
 * Keeps the director's scene and the URL in step. Make one with
 * `createRouter`, then `start()` it once the page is ready.
 */
export class Router {
  private readonly compiled: Compiled[];
  private readonly mode: 'history' | 'hash' | 'memory';
  readonly base: string;
  private readonly loaded = new Map<Route, Promise<string>>();
  private readonly handlers = new Set<(match: RouteMatch) => void>();
  private readonly cleanups: Dispose[] = [];
  private memory: string[];
  private memoryAt = 0;
  private now?: RouteMatch;
  // Bumped by every navigation: one that has been overtaken by a newer one
  // stops wherever it has got to rather than changing scene after it.
  private turn = 0;
  private started = false;

  constructor(readonly director: SceneHost, private readonly options: RouterOptions) {
    this.mode = options.mode ?? 'history';
    this.base = this.mode === 'history' ? normaliseBase(options.base ?? '/') : '/';
    this.compiled = options.routes.map((route) => ({
      route, match: compilePath(route.path), catchAll: route.path === '*',
    }));
    this.memory = [normalisePath(options.initial ?? '/')];
  }

  /** The route showing, once there is one. */
  get current(): RouteMatch | undefined {
    return this.now;
  }

  /**
   * Shows the route the URL is at, and starts listening: to back and
   * forward, and (unless `links: false`) to clicks on links to routes.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.mode !== 'memory' && typeof window !== 'undefined') {
      const onPop = () => { void this.show(this.location(), 'pop'); };
      const event = this.mode === 'hash' ? 'hashchange' : 'popstate';
      window.addEventListener(event, onPop);
      this.cleanups.push(() => window.removeEventListener(event, onPop));
      if (this.options.links !== false && typeof document !== 'undefined') {
        const onClick = (event: MouseEvent) => this.onClick(event);
        document.addEventListener('click', onClick);
        this.cleanups.push(() => document.removeEventListener('click', onClick));
      }
    }
    let at = this.location();
    // A link from before the app had real paths - `#/stacks` - lands on the
    // path it meant.
    if (this.mode === 'history' && typeof location !== 'undefined') {
      const old = /^#(\/[^#]*)$/.exec(location.hash)?.[1];
      if (old && this.resolve(old) && !this.resolve(old)!.route.path.startsWith('*')) at = old;
    }
    await this.show(at, 'replace');
  }

  /** Goes to a path inside the app: `/play/yukon`, `stacks?seed=4`. */
  navigate(to: string, options: NavigateOptions = {}): Promise<void> {
    return this.show(to, options.replace ? 'replace' : 'push');
  }

  /** Back one entry, as the browser's button does. */
  back(): void {
    if (this.mode === 'memory') {
      if (this.memoryAt === 0) return;
      this.memoryAt--;
      void this.show(this.memory[this.memoryAt], 'pop');
      return;
    }
    history.back();
  }

  /** The href that reaches a path: for an `<a>`, or to share. */
  href(path: string): string {
    const clean = this.inApp(path);
    if (this.mode === 'hash') return `#${clean}`;
    if (this.mode === 'memory') return clean;
    return `${this.base}${clean.slice(1)}`;
  }

  /** What a path would match, without going there. */
  resolve(path: string): RouteMatch | undefined {
    const url = new URL(this.inApp(path), 'http://felt.invalid');
    const clean = normalisePath(decodeURI(url.pathname));
    for (const c of this.compiled) {
      const params = c.match(clean);
      if (params) {
        return {
          route: c.route, path: clean, params, query: url.searchParams,
          fragment: url.hash.replace(/^#/, ''), url: `${clean}${url.search}`,
        };
      }
    }
    return undefined;
  }

  /** Called with every route shown. */
  onChange(handler: (match: RouteMatch) => void): Dispose {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /** Stops listening. The scene showing is left as it is: the director owns it. */
  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.handlers.clear();
  }

  // --- going somewhere --------------------------------------------------------

  private async show(to: string, how: 'push' | 'replace' | 'pop', hops = 0): Promise<void> {
    const turn = ++this.turn;
    const match = this.resolve(to);
    if (!match) {
      console.warn(`felt: no route for ${to}`);
      if (how === 'pop') this.write(this.now?.url ?? '/', 'replace');
      return;
    }
    const redirect = match.route.redirect;
    if (redirect !== undefined) {
      if (hops > 8) throw new Error(`felt: ${to} redirects in a loop`);
      return this.show(typeof redirect === 'string' ? redirect : redirect(match), how === 'pop' ? 'replace' : how, hops + 1);
    }
    const guard = this.options.guard ? await this.options.guard(match, this.now) : true;
    if (turn !== this.turn) return;
    if (guard === false) {
      // The browser has already moved for a back or forward; put it back.
      if (how === 'pop' && this.now) this.write(this.now.url, 'replace');
      return;
    }
    if (typeof guard === 'string') {
      if (hops > 8) throw new Error(`felt: ${to} redirects in a loop`);
      return this.show(guard, how === 'pop' ? 'replace' : how, hops + 1);
    }

    const same = this.now?.url === match.url && this.now.route === match.route;
    const name = await this.sceneOf(match.route);
    if (turn !== this.turn) return;
    if (how !== 'pop') this.write(match.url + (match.fragment ? `#${match.fragment}` : ''), same ? 'replace' : how);
    const from = this.now;
    this.now = match;
    const title = match.route.title;
    if (title !== undefined && typeof document !== 'undefined') {
      document.title = typeof title === 'string' ? title : title(match);
    }
    if (!same) {
      const data = match.route.data ? match.route.data(match) : match;
      await this.director.go(name, data, {
        fade: match.route.fade ?? this.options.fade,
        keep: from?.route.keep,
        // The same scene at a different URL - another game on the table
        // scene - starts again with the new data rather than staying put.
        restart: true,
      });
      if (how === 'push' && this.options.scroll !== false && typeof window !== 'undefined') window.scrollTo?.(0, 0);
    }
    for (const handler of [...this.handlers]) handler(match);
  }

  private sceneOf(route: Route): Promise<string> {
    const scene = route.scene;
    if (scene === undefined) return Promise.reject(new Error(`felt: route ${route.path} has no scene`));
    if (typeof scene === 'string') return Promise.resolve(scene);
    let loading = this.loaded.get(route);
    if (!loading) {
      loading = (async () => {
        const found = typeof scene === 'function' ? unwrap(await scene()) : scene;
        if (!this.director.has(found.name)) this.director.add(found);
        return found.name;
      })();
      // A load that failed can be tried again on the next visit.
      loading.catch(() => this.loaded.delete(route));
      this.loaded.set(route, loading);
    }
    return loading;
  }

  // --- the URL ----------------------------------------------------------------

  /** The path and query the browser is at, inside the app. */
  private location(): string {
    if (this.mode === 'memory') return this.memory[this.memoryAt];
    if (this.mode === 'hash') return location.hash.replace(/^#/, '') || '/';
    const path = location.pathname;
    const inside = path.startsWith(this.base) ? path.slice(this.base.length - 1)
      : `${path}/` === this.base ? '/' : path;
    return `${inside}${location.search}${location.hash}`;
  }

  private write(url: string, how: 'push' | 'replace'): void {
    if (this.mode === 'memory') {
      if (how === 'push') {
        this.memory = [...this.memory.slice(0, this.memoryAt + 1), url];
        this.memoryAt = this.memory.length - 1;
      } else {
        this.memory[this.memoryAt] = url;
      }
      return;
    }
    const href = this.href(url);
    if (how === 'push') history.pushState(null, '', href);
    else history.replaceState(null, '', href);
  }

  /** A path, or an href, as a path inside the app. */
  private inApp(path: string): string {
    let p = path;
    if (this.mode === 'history' && p.startsWith(this.base)) p = p.slice(this.base.length - 1);
    if (this.mode === 'hash') p = p.replace(/^#/, '');
    return p.startsWith('/') ? p : `/${p.replace(/^\.\//, '')}`;
  }

  private onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    if (link.hasAttribute('data-felt-native')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    let path: string;
    if (this.mode === 'hash') {
      if (url.pathname !== location.pathname || !url.hash.startsWith('#/')) return;
      path = url.hash.slice(1);
    } else {
      if (!url.pathname.startsWith(this.base) && `${url.pathname}/` !== this.base) return;
      // Only a link this router has a real route for. A link that would only
      // reach the catch-all is a page the server has: let the browser go.
      path = `${url.pathname}${url.search}${url.hash}`;
    }
    const match = this.resolve(path);
    if (!match || this.compiled.find((c) => c.route === match.route)?.catchAll) return;
    event.preventDefault();
    void this.navigate(path);
  }
}

function unwrap(module: SceneModule): Scene<never> {
  if ('create' in module) return module;
  if ('scene' in module) return module.scene;
  return module.default;
}

/**
 * A router over a director's scenes.
 *
 *     const router = createRouter(director, {
 *       base: import.meta.env.BASE_URL,
 *       routes: [
 *         { path: '/', scene: 'lobby' },
 *         { path: '/play/:game', scene: () => import('./table'), data: (m) => ({ game: m.params.game }) },
 *         { path: '*', redirect: '/' },
 *       ],
 *     });
 *     await router.start();
 */
export function createRouter(director: SceneHost, options: RouterOptions): Router {
  return new Router(director, options);
}
