import type { Board, BoardOptions } from '../scene/board.js';
import { createBoard } from '../scene/board.js';
import { Disposables, Dispose } from './disposables.js';
import type { Engine } from './engine.js';
import { engine as pageEngine } from './engine.js';
import type { LifecycleEvent } from './lifecycle.js';

// Scenes: the screens of a game - a lobby, a table, the results - and the
// director that moves between them without the page ever navigating.
//
// A page per screen is what killed felt going "from page to page": every
// navigation threw the engine away and started its art from nothing, and a
// page brought back from the browser's cache came back with nobody drawing.
// A scene is the screen without the page. Changing scene destroys the old
// one's boards and listeners and makes the next one's, on the same engine,
// whose art is all still there.
//
// The lifecycle is Phaser's, which is what card games need:
//
//   init(data) -> load() -> create() -> [update / fixedUpdate]* -> shutdown()
//
// with pause/resume while the page is away, and sleep/wake for a scene kept
// alive under another (a lobby under a table). Everything a scene makes
// through its context - boards, timers, listeners, frame callbacks - is
// owned by it and undone when it ends, so nothing of one screen is still
// running in the next.

export interface SceneContext<D = unknown> {
  readonly engine: Engine;
  readonly director: Director;
  readonly name: string;
  /** What `go` was given. */
  readonly data: D;
  /** The element the scene's markup lives in. */
  readonly root: HTMLElement;
  /** Teardowns that run when the scene ends, newest first. */
  readonly scope: Disposables;
  /** Whether the scene has ended. Long-running work checks this. */
  readonly ended: boolean;
  /** A board owned by the scene: destroyed with it. */
  board(options: Omit<BoardOptions, 'engine'>): Board;
  /** The first element under the scene's root matching a selector. */
  $<E extends Element = HTMLElement>(selector: string): E;
  /** Listens to any event target until the scene ends. */
  listen<K extends string>(target: EventTarget, type: K, handler: (event: Event) => void,
    options?: AddEventListenerOptions): Dispose;
  /** Calls back after `ms` of engine time, unless the scene ends first. */
  delay(ms: number, fn: () => void): Dispose;
  /** Calls back every `ms` of engine time until the scene ends. */
  every(ms: number, fn: () => void): Dispose;
  /** Resolves after `ms` of engine time. Never resolves once the scene has ended, so awaiting code stops there. */
  wait(ms: number): Promise<void>;
  /** Runs `fn` every frame until the scene ends or it is disposed. */
  onFrame(fn: (delta: number, time: number) => void): Dispose;
}

export interface Scene<D = unknown> {
  readonly name: string;
  readonly title?: string;
  /**
   * The scene's markup, put into its root when it starts. A function for
   * markup fetched or parsed late. Leave out for a scene that uses whatever
   * is already in the root (a page that is its own one scene).
   */
  readonly html?: string | (() => string | Promise<string>);
  init?(ctx: SceneContext<D>): void;
  /** Anything to have before `create`: art, data. Awaited. */
  load?(ctx: SceneContext<D>): void | Promise<void>;
  create(ctx: SceneContext<D>): void | Promise<void>;
  update?(delta: number, time: number, ctx: SceneContext<D>): void;
  fixedUpdate?(step: number, simTime: number, ctx: SceneContext<D>): void;
  /** The page went away (hidden, frozen, cached). */
  pause?(ctx: SceneContext<D>): void;
  /** The page is back. Boards have already drawn themselves again. */
  resume?(ctx: SceneContext<D>): void;
  /** Kept alive, hidden, under another scene. */
  sleep?(ctx: SceneContext<D>): void;
  /** Shown again. */
  wake?(ctx: SceneContext<D>, data: unknown): void;
  /** Ending: before everything it owns is torn down. */
  shutdown?(ctx: SceneContext<D>): void;
}

/** Writes a scene with its data type checked. */
export function defineScene<D = unknown>(scene: Scene<D>): Scene<D> {
  return scene;
}

export interface GoOptions {
  /** Milliseconds to fade out and in. Default 0. */
  fade?: number;
  /** Keep the scene being left alive and asleep, to `go` back to and wake. */
  keep?: boolean;
}

export interface DirectorOptions {
  engine?: Engine;
  /**
   * Mirror the current scene in `location.hash` (`#/name`), so the back
   * button and a reload come back to the same scene. Default false.
   */
  hash?: boolean;
}

type SceneState = 'starting' | 'running' | 'asleep' | 'ended';

class Running<D = unknown> implements SceneContext<D> {
  readonly scope = new Disposables();
  state: SceneState = 'starting';

  constructor(readonly director: Director, readonly scene: Scene<D>, readonly root: HTMLElement,
    public data: D) {}

  get engine(): Engine { return this.director.engine; }
  get name(): string { return this.scene.name; }
  get ended(): boolean { return this.state === 'ended'; }

  board(options: Omit<BoardOptions, 'engine'>): Board {
    const parent = typeof options.parent === 'string'
      ? this.root.querySelector<HTMLElement>(`#${options.parent}`) ?? options.parent
      : options.parent;
    const board = createBoard({ ...options, parent, engine: this.engine });
    this.scope.add(() => board.destroy());
    return board;
  }

  $<E extends Element = HTMLElement>(selector: string): E {
    const found = this.root.querySelector<E>(selector);
    if (!found) throw new Error(`felt: scene ${this.name} has no ${selector}`);
    return found;
  }

  listen(target: EventTarget, type: string, handler: (event: Event) => void,
    options?: AddEventListenerOptions): Dispose {
    target.addEventListener(type, handler, options);
    return this.scope.add(() => target.removeEventListener(type, handler, options));
  }

  delay(ms: number, fn: () => void): Dispose {
    let left = ms;
    let stop: Dispose = () => {};
    stop = this.onFrame((delta) => {
      left -= delta;
      if (left > 0) return;
      stop();
      fn();
    });
    return stop;
  }

  every(ms: number, fn: () => void): Dispose {
    let left = ms;
    return this.onFrame((delta) => {
      left -= delta;
      while (left <= 0) {
        left += ms;
        fn();
      }
    });
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => { this.delay(ms, resolve); });
  }

  onFrame(fn: (delta: number, time: number) => void): Dispose {
    const off = this.engine.onUpdate(fn);
    const dispose = this.scope.add(() => off());
    return () => this.scope.run(dispose);
  }
}

/**
 * Moves between scenes. One scene runs at a time (others may sleep under
 * it); `go` ends the running one - its shutdown, then every board, timer and
 * listener it made - and starts the next on the same engine.
 */
export class Director {
  readonly engine: Engine;
  private readonly scenes = new Map<string, Scene<never>>();
  private readonly asleep = new Map<string, Running>();
  private current?: Running;
  private going: Promise<void> = Promise.resolve();
  private readonly scope = new Disposables();
  private readonly handlers = new Set<(name: string) => void>();
  private readonly hash: boolean;
  /** Scenes started so far, for anyone measuring. */
  starts = 0;

  constructor(readonly host: HTMLElement, scenes: Scene<never>[] = [], options: DirectorOptions = {}) {
    this.engine = options.engine ?? pageEngine();
    this.hash = options.hash ?? false;
    for (const scene of scenes) this.add(scene);
    // The page's lifecycle, passed on to the running scene.
    this.scope.add(this.engine.on('suspend', () => this.lifecycle('suspend')));
    this.scope.add(this.engine.on('resume', () => this.lifecycle('resume')));
    if (this.hash && typeof window !== 'undefined') {
      const onHash = () => {
        const name = sceneFromHash();
        if (name && name !== this.current?.name && this.scenes.has(name)) void this.go(name);
      };
      window.addEventListener('hashchange', onHash);
      this.scope.add(() => window.removeEventListener('hashchange', onHash));
    }
  }

  add(scene: Scene<never>): this {
    this.scenes.set(scene.name, scene);
    return this;
  }

  has(name: string): boolean {
    return this.scenes.has(name);
  }

  /** The running scene's name. */
  get scene(): string | undefined {
    return this.current?.name;
  }

  /** The running scene's context, for tests and debugging. */
  get context(): SceneContext | undefined {
    return this.current;
  }

  /** Scenes asleep under the running one. */
  get sleeping(): string[] {
    return [...this.asleep.keys()];
  }

  onChange(handler: (name: string) => void): Dispose {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /**
   * Starts a scene, ending (or with `keep`, sleeping) the running one. Calls
   * made while a change is under way wait their turn, so a double-tapped
   * button changes scene once and then once more, never half of each.
   */
  go<D>(name: string, data?: D, options: GoOptions = {}): Promise<void> {
    const next = this.going.then(() => this.change(name, data, options));
    this.going = next.catch((error) => { console.error(`felt: scene ${name} failed`, error); });
    return next;
  }

  private async change(name: string, data: unknown, options: GoOptions): Promise<void> {
    const scene = this.scenes.get(name);
    if (!scene) throw new Error(`felt: no scene called ${name}`);
    const leaving = this.current;
    if (leaving?.name === name && leaving.state === 'running') return;
    const fade = options.fade ?? 0;
    if (leaving) {
      if (fade) await this.fadeTo(this.host, 0, fade);
      if (options.keep) this.sleep(leaving);
      else this.end(leaving);
    }
    this.current = undefined;

    const sleeping = this.asleep.get(name);
    if (sleeping) {
      this.asleep.delete(name);
      this.current = sleeping;
      sleeping.state = 'running';
      sleeping.root.style.display = 'contents';
      sleeping.data = data;
      sleeping.scene.wake?.(sleeping, data);
      this.engine.wake();
    } else {
      await this.start(scene, data, fade);
    }
    if (this.hash && typeof history !== 'undefined' && sceneFromHash() !== name) {
      history.pushState(null, '', `#/${name}`);
    }
    if (fade) await this.fadeTo(this.host, 1, fade);
    for (const handler of [...this.handlers]) handler(name);
  }

  private async start(scene: Scene<never>, data: unknown, fade: number): Promise<void> {
    const root = document.createElement('div');
    root.className = 'felt-scene';
    root.dataset.scene = scene.name;
    // No box of its own: the page's layout (a flex body, say) applies to the
    // scene's elements as if the wrapper were not there.
    root.style.display = 'contents';
    if (scene.html !== undefined) {
      root.innerHTML = typeof scene.html === 'function' ? await scene.html() : scene.html;
      this.host.appendChild(root);
    } else {
      // The page is the scene: adopt what is already there.
      while (this.host.firstChild) root.appendChild(this.host.firstChild);
      this.host.appendChild(root);
    }
    const ctx = new Running(this, scene as Scene<unknown>, root, data);
    this.current = ctx;
    this.starts++;
    if (scene.update) ctx.onFrame((delta, time) => scene.update!(delta, time, ctx as never));
    if (scene.fixedUpdate) {
      const off = this.engine.onFixedUpdate((step, sim) => scene.fixedUpdate!(step, sim, ctx as never));
      ctx.scope.add(off);
    }
    scene.init?.(ctx as never);
    await scene.load?.(ctx as never);
    if (ctx.ended) return;
    await scene.create(ctx as never);
    if (!ctx.ended) ctx.state = 'running';
  }

  private sleep(ctx: Running): void {
    ctx.state = 'asleep';
    ctx.root.style.display = 'none';
    ctx.scene.sleep?.(ctx);
    this.asleep.set(ctx.name, ctx);
  }

  private end(ctx: Running): void {
    if (ctx.state === 'ended') return;
    try {
      ctx.scene.shutdown?.(ctx);
    } finally {
      ctx.state = 'ended';
      ctx.scope.dispose();
      ctx.root.remove();
    }
  }

  private lifecycle(type: LifecycleEvent['type']): void {
    const ctx = this.current;
    if (!ctx || ctx.state !== 'running') return;
    if (type === 'suspend') ctx.scene.pause?.(ctx);
    if (type === 'resume') ctx.scene.resume?.(ctx);
  }

  /** Fades the host, since a scene's root has no box of its own to fade. */
  private fadeTo(element: HTMLElement, opacity: number, ms: number): Promise<void> {
    element.style.transition = `opacity ${ms}ms ease`;
    // Read before writing, so the transition has a start.
    void element.offsetWidth;
    element.style.opacity = String(opacity);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Ends every scene, running and asleep, and stops listening. */
  destroy(): void {
    if (this.current) this.end(this.current);
    for (const ctx of this.asleep.values()) this.end(ctx);
    this.asleep.clear();
    this.current = undefined;
    this.scope.dispose();
  }
}

function sceneFromHash(): string | undefined {
  const match = /^#\/([\w-]+)/.exec(location.hash);
  return match?.[1];
}
