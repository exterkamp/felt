import { Atlas } from '../gl/atlas.js';
import { lensDistance } from '../gl/lens.js';
import { LightOptions, Lighting } from '../gl/lighting.js';
import { DrawItem, Renderer } from '../gl/renderer.js';
import { Engine, EngineMember, engine as pageEngine } from '../runtime/engine.js';
import type { LifecycleEvent } from '../runtime/lifecycle.js';
import { PickUp, PickUpOptions } from './pick-up.js';
import { Node } from './node.js';
import { Sprite, SpriteOptions } from './sprite.js';
import { Tweens } from './tweens.js';

// The board: one canvas, one camera, one list of things on it.
//
// What Phaser's Game, Scene, root Container and Scale manager did between
// them, and only what a card table needs of them.
//
// **Sharp by construction.** The canvas is `size x pixelRatio` and every
// picture is rasterised at that ratio, so every coordinate a game writes is
// in logical units and only the density goes up - which phaser-card-engine
// needed `createBoard` and `boardRoot` and a scaled container to get, and
// then lost depth sorting to the container.
//
// **Asleep when nothing moves.** A frame is drawn when something changed - a
// card moved, a tween is running, a picture landed in the atlas - and not
// otherwise. A turn-based game sitting on a decision costs no GPU time at
// all, which on a phone is the difference that matters.

export interface BoardOptions {
  parent: string | HTMLElement;
  /** The board's size in logical units - the numbers your game thinks in. */
  width: number;
  height: number;
  /** The felt. A CSS color or 0xrrggbb. */
  backgroundColor?: string | number;
  /** Let the page show through where nothing is drawn. */
  transparent?: boolean;
  /** Defaults to the device's own ratio, which is what you want. */
  pixelRatio?: number;
  /**
   * The lens, in degrees of vertical view. 0 is a flat orthographic board,
   * where nothing lifted or tipped gets any perspective. Default 45.
   */
  fov?: number;
  /**
   * Where perspective is seen from: over each card (`'local'`, the default,
   * so a card tipped in a corner looks like one tipped in the middle) or over
   * the middle of the board (`'board'`, the true picture).
   */
  lens?: 'local' | 'board';
  /**
   * Whether a card waits to be drawn until its deck's sheets are finished -
   * every face painted, with its fonts, pips and portraits. Default true: no
   * card ever appears half-painted and then fills in. A card restyled to a
   * look not yet ready goes on showing the old one until it is. False draws
   * every card at once, with whatever art has arrived.
   */
  waitForArt?: boolean;
  /**
   * The engine whose loop, clock and lifecycle it runs on, and whose art
   * it shares. Default: the page's (`engine()`).
   */
  engine?: Engine;
  /**
   * What a dragged node does: lifts off the felt (its shadow falling further
   * out) and swivels with the motion of the drag, settling when it stops and
   * dropping back when let go. By default, whenever the board has
   * perspective (fov above 0, now or after `setFov`); `true` or options to
   * always, `false` for never.
   */
  pickUp?: boolean | 'auto' | PickUpOptions;
  /**
   * Lights the board: cards shade by their tilt, show their stock's sheen,
   * and cast their shadows away from the light. Off by default - an unlit
   * board draws exactly as it always has. `true` for `DEFAULT_LIGHT`; turn it
   * on or change it later with `board.lighting.set(...)`.
   */
  light?: boolean | LightOptions;
}

/**
 * How long a lost context is given to come back, while the page is showing,
 * before the board stops waiting and makes a new canvas. Browsers may never
 * send `webglcontextrestored`; a page out of the back/forward cache may have
 * lost its context while it was in there.
 */
export const CONTEXT_RESTORE_WAIT_MS = 1000;

export interface BoardPointer {
  /** In board units. */
  x: number;
  y: number;
  /** Where this press started. */
  downX: number;
  downY: number;
  id: number;
  /** The topmost interactive node under the press, if any. */
  node?: Node;
  /** How far it has moved since it went down. */
  distance: number;
  /**
   * How fast it is moving, in board units a second, over the last tenth of
   * a second. At `pointerup`/`dragend`, the speed it was let go at - zero if
   * it had stopped first, so a card set down is not a card flung.
   */
  velocity: { x: number; y: number };
  event: PointerEvent;
  /**
   * In a `dragstart` handler: this node is not to be dragged after all (a
   * card under the top of a pile). It is not picked up, and no `drag` or
   * `dragend` follow.
   */
  refuse?(): void;
}

type Handler = (...args: any[]) => void;

function cssToRgba(color: string | number | undefined): [number, number, number, number] {
  if (color === undefined) return [0, 0, 0, 1];
  if (typeof color === 'number') {
    return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, 1];
  }
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = color;
  const css = probe.fillStyle;
  if (css.startsWith('#')) {
    const n = Number.parseInt(css.slice(1, 7), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const parts = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
}

/** How long a pointer's motion is remembered for its velocity, ms. */
const VELOCITY_WINDOW_MS = 100;

/**
 * Adds a sample to a pointer's trail and answers its velocity over the last
 * `VELOCITY_WINDOW_MS`. Between two events alone it is noise - pointer events
 * come in bursts - and an old sample would keep a stopped finger moving.
 */
export function trackVelocity(trail: { t: number; x: number; y: number }[], t: number, x: number, y: number):
  { x: number; y: number } {
  const last = trail[trail.length - 1];
  // The same place again (an up where the last move was): time passes, the
  // finger does not move.
  if (!last || last.t !== t || last.x !== x || last.y !== y) trail.push({ t, x, y });
  while (trail.length > 2 && t - trail[0].t > VELOCITY_WINDOW_MS) trail.shift();
  const first = trail[0];
  const span = t - first.t;
  if (span <= 0 || t - first.t > VELOCITY_WINDOW_MS * 2) return { x: 0, y: 0 };
  return { x: ((x - first.x) / span) * 1000, y: ((y - first.y) / span) * 1000 };
}

export class Board implements EngineMember {
  /** The canvas it draws into. A new one if the old one's context died. */
  get canvas(): HTMLCanvasElement { return this._canvas; }
  /** The renderer on that canvas. Replaced along with it. */
  get renderer(): Renderer { return this._renderer; }
  private _canvas: HTMLCanvasElement;
  private _renderer: Renderer;
  private readonly transparent: boolean;
  /** Whose loop it runs on. */
  readonly engine: Engine;
  /** Lifts and swivels whatever is being dragged; undefined if turned off. */
  readonly pickUp?: PickUp;
  /** Whether it lifts on a flat board too, because it was asked for outright. */
  private pickUpAlways = false;
  private unlistenCanvas: () => void = () => {};
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  /** Times a dead context was replaced with a new canvas. */
  rebuilds = 0;
  /** Times the page came back and the board drew itself again unasked. */
  resumes = 0;
  readonly parent: HTMLElement;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly atlas: Atlas;
  readonly tweens = new Tweens();
  /** Camera to table, in units. Infinity on a flat board. */
  distance: number;
  localLens: boolean;
  readonly vanishX: number;
  readonly vanishY: number;
  /** The light on the board, off until `set`. See `BoardOptions.light`. */
  readonly lighting = new Lighting(() => this.touch());
  /** Anything the art layer wants to hang off the board. */
  readonly services = new Map<string, unknown>();
  /** See `BoardOptions.waitForArt`. */
  readonly waitForArt: boolean;
  /** When the board was made, by `performance.now()`: loading is timed from here. */
  readonly createdAt = performance.now();

  private readonly items: Node[] = [];
  private sorted = true;
  private rendering = false;
  private dirty = true;
  private time = 0;
  private awake = 0;
  private destroyedFlag = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly pointers = new Map<number, BoardPointer & { dragging?: Node; trail?: { t: number; x: number; y: number }[] }>();
  private background: [number, number, number, number];
  private readonly resizeObserver?: ResizeObserver;
  private readonly cleanup: (() => void)[] = [];
  /** Frames drawn so far. */
  frames = 0;
  /** Times the GPU took the context away. Each was rebuilt from. */
  contextLosses = 0;
  /** Milliseconds the last frame's work took: update, tweens, painting, drawing. */
  frameWork = 0;
  /** Run before every frame is drawn - work batched up to happen once a frame. */
  private readonly beforeFrame: (() => void)[] = [];

  constructor(options: BoardOptions) {
    const parent = typeof options.parent === 'string'
      ? document.getElementById(options.parent) ?? document.querySelector(options.parent)
      : options.parent;
    if (!parent) throw new Error(`felt: no element ${String(options.parent)}`);
    this.parent = parent as HTMLElement;
    this.width = options.width;
    this.height = options.height;
    this.pixelRatio = options.pixelRatio ?? window.devicePixelRatio ?? 1;
    this.distance = lensDistance(options.fov ?? 45, options.height);
    this.localLens = (options.lens ?? 'local') === 'local';
    this.waitForArt = options.waitForArt ?? true;
    this.vanishX = options.width / 2;
    this.vanishY = options.height / 2;
    this.background = options.transparent ? [0, 0, 0, 0] : cssToRgba(options.backgroundColor);
    if (options.light) this.lighting.set(options.light === true ? {} : options.light);

    this.transparent = options.transparent ?? false;
    const canvas = this.makeCanvas();
    this._canvas = canvas;
    this.parent.appendChild(canvas);

    this.atlas = new Atlas(2048);
    this.atlas.onChange = () => this.touch();
    this._renderer = new Renderer(canvas, this.atlas, { transparent: this.transparent });
    this.tweens.onWake = () => this.wake();

    this.engine = options.engine ?? pageEngine();
    this.cleanup.push(this.engine.add(this));
    // Unless turned off, there is a pick-up; by default it only lifts while
    // the board has perspective, which `setFov` can change at any time.
    const pickUp = options.pickUp ?? 'auto';
    if (pickUp !== false) {
      this.pickUp = new PickUp(this.engine, typeof pickUp === 'object' ? pickUp : {});
      this.pickUpAlways = pickUp === true || typeof pickUp === 'object';
      this.cleanup.push(() => this.pickUp!.clear());
    }

    this.fit();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.parent);
    }
    this.unlistenCanvas = this.listen(canvas);
    this.wake();
  }

  private makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(this.width * this.pixelRatio);
    canvas.height = Math.round(this.height * this.pixelRatio);
    // The canvas handles its own gestures; without this a drag on a phone is
    // also a page scroll and the card sits still while the page slides.
    canvas.style.touchAction = 'none';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.userSelect = 'none';
    return canvas;
  }

  // --- the page's lifecycle ------------------------------------------------

  /**
   * A board asleep is the worst case for a page coming back: nothing is
   * moving, so nothing would draw, and the browser may have thrown the
   * canvas's pixels away while it was hidden, frozen or cached. So coming
   * back always draws, after checking the GPU is still there.
   */
  lifecycle(event: LifecycleEvent): void {
    if (this.destroyedFlag) return;
    if (event.type === 'resume') {
      // The engine drops the time it was away and wakes; the board makes
      // sure that frame draws, and draws onto a live context.
      this.resumes++;
      this.fit();
      if (this.renderer.lost) this.armWatchdog();
      this.dirty = true;
      this.wake();
      return;
    }
    if (event.type === 'pixelratio') {
      this.fit();
      this.touch();
    }
  }

  /** Waits for a lost context to come back, and if it does not, replaces it. */
  private armWatchdog(): void {
    if (this.watchdog !== undefined || this.destroyedFlag) return;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (this.destroyedFlag || !this.renderer.lost) return;
      // Hidden, the browser will not give it back anyway; try again on return.
      if (this.engine.suspended) return;
      this.rebuild();
    }, CONTEXT_RESTORE_WAIT_MS);
  }

  /**
   * A new canvas and a new context in place of the dead ones. Everything on
   * the GPU is made again: the renderer's objects here, meshes on their next
   * draw (they see a new generation), and every atlas picture from how it was
   * painted - the only place those pixels can come from.
   */
  private rebuild(): void {
    const old = this._canvas;
    const fresh = this.makeCanvas();
    fresh.style.width = old.style.width;
    fresh.style.height = old.style.height;
    let renderer: Renderer;
    try {
      renderer = new Renderer(fresh, this.atlas, {
        transparent: this.transparent, generation: this._renderer.generation,
      });
    } catch {
      // No WebGL2 to be had right now (the GPU process is still coming
      // back); wait and try again.
      this.armWatchdog();
      return;
    }
    this.unlistenCanvas();
    old.replaceWith(fresh);
    this._canvas = fresh;
    this._renderer = renderer;
    this.unlistenCanvas = this.listen(fresh);
    this.rebuilds++;
    this.atlas.repaintAll();
    this.emit('rebuilt');
    this.dirty = true;
    this.wake();
  }

  /** Whether the board has perspective: anything lifted or tipped is seen in depth. */
  get is3d(): boolean {
    return Number.isFinite(this.distance);
  }

  /**
   * Changes the lens: 0 for a flat board, or the vertical view in degrees.
   * Flat, picked-up cards stay on the felt and flicks stay in 2D.
   */
  setFov(fov: number): this {
    this.distance = lensDistance(fov, this.height);
    this.touch();
    return this;
  }

  /** Changes the colour of the felt. */
  setBackground(color: string | number): this {
    this.background = cssToRgba(color);
    this.touch();
    return this;
  }

  // --- fitting -------------------------------------------------------------

  /**
   * Fits the canvas inside its parent, keeping its proportions.
   *
   * The backing store does not change - it is the board at its pixel ratio -
   * only the size it is shown at, the way Phaser's Scale.FIT did it.
   */
  fit(): void {
    const box = this.parent.getBoundingClientRect();
    const style = getComputedStyle(this.parent);
    const pad = (a: string, b: string) => Number.parseFloat(a) + Number.parseFloat(b);
    const availW = box.width - pad(style.paddingLeft, style.paddingRight);
    let availH = box.height - pad(style.paddingTop, style.paddingBottom);
    if (!(availH > 0)) availH = Infinity;
    const scale = Math.min(availW / this.width, availH / this.height);
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    this.canvas.style.width = `${Math.floor(this.width * scale)}px`;
    this.canvas.style.height = `${Math.floor(this.height * scale)}px`;
  }

  // --- the list ------------------------------------------------------------

  /** Called by a node's setters. Schedules a frame. */
  touch(): void {
    // Anything touched while a frame is being drawn - a face painted in the
    // pre-pass - is in this frame already; asking for another would draw it twice.
    if (this.rendering) return;
    // Already owed a frame: every setter of every card calls this, and four
    // of them on four thousand cards a frame was sixteen thousand wakes.
    if (this.dirty) return;
    this.dirty = true;
    this.wake();
  }

  /** Called when a depth changes. */
  resort(): void {
    this.sorted = false;
    this.touch();
  }

  attach(node: Node): void {
    this.items.push(node);
    this.resort();
  }

  detach(item: Node): void {
    const at = this.items.indexOf(item);
    if (at >= 0) this.items.splice(at, 1);
    this.tweens.killTweensOf(item);
    this.touch();
  }

  /** Everything on the board, back to front. */
  get children(): readonly Node[] {
    this.sort();
    return this.items;
  }

  /** Every node of a kind, back to front. */
  nodes<T extends Node>(kind?: abstract new (...args: any[]) => T): T[] {
    this.sort();
    return this.items.filter((item): item is T =>
      item instanceof Node && (!kind || item instanceof kind));
  }

  private sort(): void {
    if (this.sorted) return;
    this.items.sort((a, b) => a.depth - b.depth || a.serial - b.serial);
    this.sorted = true;
  }

  // --- pictures ------------------------------------------------------------

  /** A sprite showing an atlas region. */
  image(region: Parameters<Atlas['release']>[0], options: SpriteOptions = {}): Sprite {
    return new Sprite(this, region, options);
  }

  /**
   * A sprite of something drawn with Canvas 2D, at this board's density.
   *
   * `paint` draws in board units, with the origin at the top-left of a box
   * `width` by `height`. Pass a `key` to share one picture between sprites.
   */
  graphic(width: number, height: number,
    paint: (pen: CanvasRenderingContext2D, width: number, height: number) => void,
    options: SpriteOptions & { key?: string } = {}): Sprite {
    const key = options.key ?? `graphic-${graphicSerial++}`;
    const ratio = this.pixelRatio;
    const region = this.atlas.obtain(`${key}@${ratio}`, width * ratio, height * ratio, (pen) => {
      pen.scale(ratio, ratio);
      paint(pen as CanvasRenderingContext2D, width, height);
    });
    return new Sprite(this, region, { width, height, ...options }, true);
  }

  /** A line of text as a sprite, measured and rasterised at this density. */
  text(text: string, style: TextStyle = {}, options: SpriteOptions = {}): Sprite {
    const size = style.size ?? 12;
    const font = `${style.weight ?? 'normal'} ${size}px ${style.font ?? 'sans-serif'}`;
    const measure = measurer();
    measure.font = font;
    const metrics = measure.measureText(text);
    const pad = Math.ceil(size * 0.25);
    const width = Math.ceil(metrics.width) + pad * 2;
    const height = Math.ceil(size * 1.3) + pad;
    const color = style.color ?? '#ffffff';
    return this.graphic(width, height, (pen, w, h) => {
      pen.font = font;
      pen.fillStyle = color;
      pen.textBaseline = 'middle';
      pen.textAlign = 'center';
      pen.fillText(text, w / 2, h / 2);
    }, { key: `text-${font}-${color}-${text}`, ...options });
  }

  // --- input ---------------------------------------------------------------

  /** A point on the page, in board units. */
  toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.width,
      y: ((clientY - rect.top) / rect.height) * this.height,
    };
  }

  /** The topmost interactive node under a point, if any. */
  pick(x: number, y: number, accept?: (node: Node) => boolean): Node | undefined {
    this.sort();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (!(item.interactive || item.draggable)) continue;
      if (accept && !accept(item)) continue;
      if (item.hitTest(x, y)) return item;
    }
    return undefined;
  }

  /** Every node under a point, front first, interactive or not. */
  nodesAt(x: number, y: number): Node[] {
    this.sort();
    const out: Node[] = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item instanceof Node && item.hitTest(x, y)) out.push(item);
    }
    return out;
  }

  private listen(canvas: HTMLCanvasElement): () => void {
    const down = (event: PointerEvent) => {
      const at = this.toBoard(event.clientX, event.clientY);
      const node = this.pick(at.x, at.y);
      const pointer: BoardPointer & { dragging?: Node; trail?: { t: number; x: number; y: number }[] } = {
        x: at.x, y: at.y, downX: at.x, downY: at.y, id: event.pointerId,
        node, distance: 0, velocity: { x: 0, y: 0 }, event, dragging: undefined as Node | undefined,
        trail: [{ t: event.timeStamp, x: at.x, y: at.y }],
        refuse: () => { pointer.dragging = undefined; },
      };
      this.pointers.set(event.pointerId, pointer);
      try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic */ }
      event.preventDefault();
      this.emit('pointerdown', pointer);
      if (node?.draggable) {
        pointer.dragging = node;
        this.emit('dragstart', pointer, node);
        // Still the game's to drag once it has had its say: up it comes.
        if (pointer.dragging && this.pickUp && (this.pickUpAlways || this.is3d)) this.pickUp.lift(node);
      }
    };
    const move = (event: PointerEvent) => {
      const at = this.toBoard(event.clientX, event.clientY);
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) {
        this.emit('pointermove', { x: at.x, y: at.y, downX: at.x, downY: at.y,
          id: event.pointerId, distance: 0, velocity: { x: 0, y: 0 }, event });
        return;
      }
      pointer.x = at.x;
      pointer.y = at.y;
      pointer.event = event;
      pointer.distance = Math.hypot(at.x - pointer.downX, at.y - pointer.downY);
      pointer.velocity = trackVelocity(pointer.trail!, event.timeStamp, at.x, at.y);
      this.emit('pointermove', pointer);
      if (pointer.dragging) this.emit('drag', pointer, pointer.dragging);
    };
    const up = (event: PointerEvent) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      const at = this.toBoard(event.clientX, event.clientY);
      pointer.x = at.x;
      pointer.y = at.y;
      pointer.event = event;
      pointer.velocity = trackVelocity(pointer.trail!, event.timeStamp, at.x, at.y);
      this.pointers.delete(event.pointerId);
      if (pointer.dragging) {
        this.emit('dragend', pointer, pointer.dragging);
        this.pickUp?.drop(pointer.dragging);
      }
      this.emit('pointerup', pointer);
      // A tap: down and up without wandering. What a button is, on a table.
      if (pointer.distance < 8 && event.type === 'pointerup') this.emit('tap', pointer);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // The GPU can take the context away at any time - a backgrounded tab, too
    // many WebGL pages open, a driver reset - and every texture and buffer
    // goes with it. preventDefault says we will rebuild; `restored` does: the
    // renderer makes its objects again and the atlas repaints every picture
    // from how it was painted, because the GPU held the only copy.
    const lost = (event: Event) => {
      if (this.destroyedFlag) return;
      event.preventDefault();
      this.contextLosses++;
      if (!this.engine.suspended) this.armWatchdog();
    };
    const restored = () => {
      if (this.destroyedFlag) return;
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
      this.renderer.restore();
      this.atlas.repaintAll();
      this.touch();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }

  /** Registers work to run once before each drawn frame. */
  beforeRender(run: () => void): void {
    this.beforeFrame.push(run);
  }

  // --- events --------------------------------------------------------------

  on(event: 'update', handler: (time: number, delta: number) => void): this;
  on(event: 'pointerdown' | 'pointermove' | 'pointerup' | 'tap', handler: (pointer: BoardPointer) => void): this;
  on(event: 'dragstart' | 'drag' | 'dragend', handler: (pointer: BoardPointer, node: Node) => void): this;
  on(event: string, handler: Handler): this;
  on(event: string, handler: Handler): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    if (event === 'update') this.wake();
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  once(event: string, handler: Handler): this {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(...args);
  }

  // --- the loop ------------------------------------------------------------

  /**
   * Keeps the board drawing every frame until the returned function is
   * called. For anything animating outside the tweens.
   */
  keepAwake(): () => void {
    this.awake++;
    this.wake();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.awake--;
    };
  }

  /** Milliseconds since the board started, as the loop sees it. */
  get now(): number {
    return this.time;
  }

  get isDestroyed(): boolean {
    return this.destroyedFlag;
  }

  private wake(): void {
    if (this.destroyedFlag) return;
    this.engine.wake();
  }

  /** One frame, run by the engine's loop. Answers whether it wants another. */
  frame(delta: number): boolean {
    if (this.destroyedFlag) return false;
    const started = performance.now();
    this.time += delta;

    const updating = (this.handlers.get('update')?.size ?? 0) > 0;
    if (updating) this.emit('update', this.time, delta);
    const tweening = this.tweens.update(delta);
    // Before the dirty check, so that what this paints lands in this frame
    // rather than asking for another one.
    for (const run of this.beforeFrame) run();

    if (this.dirty) {
      this.dirty = false;
      this.drawFrame();
    }
    this.frameWork = performance.now() - started;
    return updating || tweening || this.awake > 0 || this.dirty;
  }

  /** Draws now, whatever the loop thinks. */
  render(): void {
    for (const run of this.beforeFrame) run();
    this.drawFrame();
  }

  /**
   * The drawing half of a frame, after the before-frame work. The loop runs
   * that work itself, first, so it ran twice a frame when this did it too:
   * double the warming budget, and every owed repaint checked twice.
   */
  private drawFrame(): void {
    this.sort();
    this.rendering = true;
    try {
      // One pass, front to back: what is about to be shown is prepared, and a
      // card buried under an identical one casts no shadow (Node.covered).
      let above: Node | undefined;
      for (let i = this.items.length - 1; i >= 0; i--) {
        const item = this.items[i];
        if (!item.visible) continue;
        item.prepare();
        item.covered = above !== undefined && item.sameFootprint(above);
        item.occluded = item.covered && above!.opaqueBody();
        above = item;
      }
      this.draw();
    } finally {
      this.rendering = false;
    }
  }

  private draw(): void {
    this.renderer.frame(this.items as DrawItem[], {
      width: this.width,
      height: this.height,
      distance: this.distance,
      vanishX: this.vanishX,
      vanishY: this.vanishY,
      local: this.localLens,
    }, this.background, this.lighting.on ? this.lighting.uniforms(this.width, this.height) : undefined);
    this.frames++;
    this.emit('render');
  }

  /**
   * The board as a PNG data URL, drawn fresh. The drawing buffer is not kept
   * between frames, so this renders and reads in the same breath.
   */
  snapshot(type = 'image/png'): string {
    return this.snapshotCanvas().toDataURL(type);
  }

  /**
   * The board copied into a 2D canvas, drawn fresh. Much cheaper than
   * `snapshot` when taken often - the copy stays on the GPU side of things
   * and the PNG encode, which is the slow part, happens only if asked for.
   */
  snapshotCanvas(into?: HTMLCanvasElement): HTMLCanvasElement {
    this.render();
    const out = into ?? document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    out.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return out;
  }

  destroy(): void {
    if (this.destroyedFlag) return;
    this.destroyedFlag = true;
    this.resizeObserver?.disconnect();
    clearTimeout(this.watchdog);
    this.unlistenCanvas();
    for (const fn of this.cleanup) fn();
    this.emit('destroy');
    this.handlers.clear();
    this.renderer.destroy();
    this.canvas.remove();
  }
}

export interface TextStyle {
  font?: string;
  size?: number;
  color?: string;
  weight?: string;
}

let graphicSerial = 0;
let probe: CanvasRenderingContext2D | undefined;
function measurer(): CanvasRenderingContext2D {
  probe ??= document.createElement('canvas').getContext('2d')!;
  return probe;
}

/** Makes a board. The name phaser-card-engine used. */
export function createBoard(options: BoardOptions): Board {
  return new Board(options);
}
