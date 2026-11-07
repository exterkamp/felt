import type { Board } from '../scene/board.js';
import { BODY_FONT, DISPLAY_FONT } from '../core/fonts.js';
import { Announcer, Politeness, announcerOf } from './announce.js';
import { prefersReducedMotion } from './motion.js';
import { ToastPlace, ToastPolicy, ToastQueue, ToastState } from './toast-queue.js';

// Toasts: "Nice!", "+15", "No moves left", "Player 2's turn" - over the table
// for a moment, then gone.
//
// **Drawn in the DOM, not on the board.** A layer of elements pinned over the
// board's canvas, in board units, rather than sprites in the atlas:
//
// - *Cost.* A toast is a new string nearly every time. On the board each one
//   is a fresh atlas region (or a dozen glyph sprites, kerning lost, for a
//   sentence) for two seconds and then a dead one; in the DOM it is a text
//   node, and the atlas never knows.
// - *Crispness.* The canvas is drawn at its own size and then scaled by CSS
//   to fit the page, so anything on it is resampled once; text in the layer
//   over it is laid out by the browser at the size it is shown, hinted and
//   subpixel-positioned, at any zoom.
// - *Styling and motion.* Banners want padding, a rounded box, wrapping and
//   a shadow - free in CSS - and their motion is opacity and a transform,
//   which the compositor does without the board drawing a frame.
// - *Accessibility.* The words are real text (the page's zoom and font
//   settings apply), and are said through the page's live region (see
//   announce.ts) rather than by the toast element itself, so they are read
//   once, coalesced with everything else the game says.
//
// What it gives up: a toast is not in `board.snapshot()`, and it is always
// over the cards, never between them. Text that has to sit *in* the scene
// - under a card, in the snapshot - is a `Readout`.
//
// **Lined up with the board.** The layer is the board's size in board units,
// scaled by the same factor `fit()` showed the canvas at and placed on it,
// and it follows every resize, every fit and a rebuilt canvas - so a float
// at (240, 380) rises off whatever is at (240, 380) on the felt. Its time is
// the board's frame clock: it pauses with the page, and a scene that ends
// takes its board's toasts with it.

export interface ToastOptions {
  /** Where: a banner at the top (default), in the middle, or at the bottom. */
  place?: 'top' | 'center' | 'bottom';
  /** Milliseconds fully shown. Default by its length (`durationFor`); Infinity until dismissed. */
  duration?: number;
  /** Jumps the queue, and pushes the oldest off if its place is full. */
  urgent?: boolean;
  /** Two toasts with one key are one, counted. Default the text. */
  key?: string;
  /**
   * Also say it to assistive technology: `true` (polite), a politeness, or
   * the words to say instead (`'Your score is 120'` for a "+15"). Default
   * true for banners.
   */
  announce?: boolean | Politeness | string;
  /** A colour scheme: `'info'` (default), `'good'`, `'bad'`. Or style `.felt-toast--…` yourself. */
  tone?: 'info' | 'good' | 'bad';
  /** A tap sends it away. Default true. */
  dismissible?: boolean;
  /** Extra class names on the element. */
  className?: string;
}

export interface FloatOptions {
  /** Milliseconds it takes to rise and fade. Default 900. */
  duration?: number;
  /** How far it rises, board units. Default 48. */
  rise?: number;
  /** Its colour. Default '#ffd166'. */
  color?: string;
  /** Its size, board units. Default 22. */
  size?: number;
  /** As for banners; default false: a "+10" is usually said by the score. */
  announce?: boolean | Politeness | string;
  className?: string;
}

/** A toast asked for. */
export interface ToastHandle {
  readonly id: number;
  readonly text: string;
  /** Its element, once it is on screen. */
  readonly element: HTMLElement | undefined;
  /** Where it has got to: queued, entering, shown, leaving, gone. */
  readonly phase: ToastState['phase'];
  /** Resolves when it has gone (or was dropped). */
  readonly done: Promise<void>;
  dismiss(): void;
}

export interface ToasterOptions extends ToastPolicy {
  /** Override the system's reduced-motion setting. */
  reducedMotion?: boolean;
  /** Where announcements go. Default the board's engine's announcer. */
  announcer?: Announcer;
}

const TONES: Record<string, { bg: string; fg: string; edge: string }> = {
  info: { bg: 'rgba(8, 26, 19, 0.9)', fg: '#fdfdfd', edge: '#cfead0' },
  good: { bg: 'rgba(16, 64, 40, 0.94)', fg: '#ffe9a8', edge: '#ffd166' },
  bad: { bg: 'rgba(72, 18, 18, 0.94)', fg: '#ffe2e2', edge: '#ff8a8a' },
};

interface Entry {
  state: ToastState;
  element?: HTMLElement;
  float?: { x: number; y: number; rise: number };
  options: ToastOptions & FloatOptions;
  resolve: () => void;
  counted: number;
}

/** A board's toasts. Get it with `toastsOf(board)`. */
export class Toaster {
  readonly queue: ToastQueue;
  /** The box over the canvas, exactly where the canvas is shown. */
  readonly overlay: HTMLElement;
  /** Inside it, the board's own size in board units, scaled to the canvas: what toasts are placed in. */
  readonly layer: HTMLElement;
  private readonly stacks: Record<Exclude<ToastPlace, 'float'>, HTMLElement>;
  private readonly entries = new Map<number, Entry>();
  private readonly resize?: ResizeObserver;
  private observed?: HTMLCanvasElement;
  private ticking = false;
  private destroyed = false;
  private readonly unlisten: (() => void)[] = [];
  reducedMotion?: boolean;
  readonly announcer: Announcer;

  constructor(readonly board: Board, options: ToasterOptions = {}) {
    this.queue = new ToastQueue(options);
    this.reducedMotion = options.reducedMotion;
    this.announcer = options.announcer ?? announcerOf(board.engine);
    const overlay = document.createElement('div');
    overlay.className = 'felt-toasts';
    // Said through the live region instead, once and coalesced.
    overlay.setAttribute('aria-hidden', 'true');
    // The outer box is the canvas's, as shown; the layer inside is the board's,
    // in board units, scaled down (or up) to it. Clipped, so the layer's own
    // unscaled box never makes the page scroll.
    Object.assign(overlay.style, {
      position: 'absolute', left: '0', top: '0', width: '0', height: '0',
      pointerEvents: 'none', overflow: 'hidden', zIndex: '5',
    } as Partial<CSSStyleDeclaration>);
    const layer = document.createElement('div');
    layer.className = 'felt-toasts__board';
    Object.assign(layer.style, {
      position: 'absolute', left: '0', top: '0', width: `${board.width}px`, height: `${board.height}px`,
      transformOrigin: '0 0', font: `600 18px/1.25 ${BODY_FONT}`,
    } as Partial<CSSStyleDeclaration>);
    overlay.appendChild(layer);
    this.layer = layer;
    const stack = (place: string, css: Partial<CSSStyleDeclaration>) => {
      const el = document.createElement('div');
      el.className = `felt-toasts__${place}`;
      Object.assign(el.style, {
        position: 'absolute', left: '0', right: '0', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '8px', padding: '0 16px', ...css,
      } as Partial<CSSStyleDeclaration>);
      layer.appendChild(el);
      return el;
    };
    this.stacks = {
      top: stack('top', { top: '14px' }),
      center: stack('center', { top: '50%', transform: 'translateY(-50%)' }),
      bottom: stack('bottom', { bottom: '14px', flexDirection: 'column-reverse' }),
    };
    board.canvas.after(overlay);
    this.overlay = overlay;

    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.align());
      this.resize.observe(board.parent);
      this.observe(board.canvas);
    }
    const onResize = () => this.align();
    window.addEventListener('resize', onResize);
    this.unlisten.push(() => window.removeEventListener('resize', onResize));
    // A lost context brings a new canvas: sit on that one.
    const onRebuilt = () => {
      board.canvas.after(this.overlay);
      this.observe(board.canvas);
      this.align();
    };
    board.on('rebuilt', onRebuilt);
    this.unlisten.push(() => board.off('rebuilt', onRebuilt));
    board.once('destroy', () => this.destroy());
    this.align();
  }

  /** A banner. Answers a handle to dismiss it or wait for it. */
  show(text: string, options: ToastOptions = {}): ToastHandle {
    const place = options.place ?? 'top';
    const state = this.queue.push({
      text, place, duration: options.duration, urgent: options.urgent, key: options.key,
    });
    const handle = this.track(state, options);
    this.speak(text, options.announce ?? true);
    return handle;
  }

  /** Text rising off a point on the board - a "+10" off a card. */
  float(text: string, x: number, y: number, options: FloatOptions = {}): ToastHandle {
    const duration = options.duration ?? 900;
    // The whole rise is its entering phase; it is never "shown" still.
    const state = this.queue.push({ text, place: 'float', duration: 0, coalesce: false });
    const entry = this.track(state, options);
    this.entries.get(state.id)!.float = { x, y, rise: options.rise ?? 48 };
    state.duration = Math.max(0, duration - this.queue.enter - this.queue.exit);
    this.speak(text, options.announce ?? false);
    return entry;
  }

  /** Sends every toast off. */
  dismissAll(): void {
    this.queue.clear();
    this.wake();
  }

  /** The toasts asked for and not yet gone. */
  get active(): readonly ToastState[] {
    return this.queue.all;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resize?.disconnect();
    for (const off of this.unlisten) off();
    for (const entry of this.entries.values()) entry.resolve();
    this.entries.clear();
    this.overlay.remove();
    this.board.services.delete('felt:toasts');
  }

  /** Puts the layer exactly over the canvas, at the scale the canvas is shown. */
  align(): void {
    if (this.destroyed) return;
    const canvas = this.board.canvas;
    const scale = canvas.offsetWidth / this.board.width;
    if (!(scale > 0)) return;
    const style = this.overlay.style;
    style.left = `${canvas.offsetLeft}px`;
    style.top = `${canvas.offsetTop}px`;
    style.width = `${canvas.offsetWidth}px`;
    style.height = `${canvas.offsetHeight}px`;
    this.layer.style.transform = `scale(${scale})`;
  }

  private observe(canvas: HTMLCanvasElement): void {
    if (!this.resize || this.observed === canvas) return;
    if (this.observed) this.resize.unobserve(this.observed);
    this.resize.observe(canvas);
    this.observed = canvas;
  }

  private speak(text: string, announce: boolean | Politeness | string): void {
    if (announce === false) return;
    const politeness: Politeness = announce === 'assertive' ? 'assertive' : 'polite';
    const words = typeof announce === 'string' && announce !== 'polite' && announce !== 'assertive' ? announce : text;
    this.announcer.announce(words, { politeness });
  }

  private track(state: ToastState, options: ToastOptions & FloatOptions): ToastHandle {
    let entry = this.entries.get(state.id);
    if (!entry) {
      let resolve!: () => void;
      const done = new Promise<void>((r) => { resolve = r; });
      entry = { state, options, resolve, counted: 0 };
      (entry as Entry & { done: Promise<void> }).done = done;
      this.entries.set(state.id, entry);
    }
    const e = entry as Entry & { done: Promise<void> };
    this.wake();
    const queue = this.queue;
    const wake = () => this.wake();
    return {
      id: state.id,
      text: state.text,
      get element() { return e.element; },
      get phase() { return e.state.phase; },
      done: e.done,
      dismiss() { queue.dismiss(state.id); wake(); },
    };
  }

  /** Runs the toasts on the board's clock while any are about. */
  private wake(): void {
    if (this.ticking || this.destroyed) return;
    this.ticking = true;
    this.board.tweens.tick((ms) => {
      if (this.destroyed) return (this.ticking = false);
      this.queue.step(ms);
      this.render();
      if (!this.queue.busy) this.ticking = false;
      return this.ticking;
    });
    this.render();
  }

  private get reduced(): boolean {
    return this.reducedMotion ?? prefersReducedMotion();
  }

  /** Makes, moves and fades each toast's element from where its state has got to. */
  private render(): void {
    const live = new Set(this.queue.all.map((t) => t.id));
    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      entry.element?.remove();
      entry.resolve();
      this.entries.delete(id);
    }
    const reduced = this.reduced;
    for (const state of this.queue.all) {
      const entry = this.entries.get(state.id);
      if (!entry || state.phase === 'queued') continue;
      const el = entry.element ?? (entry.element = this.make(entry));
      if (entry.counted !== state.count) {
        entry.counted = state.count;
        const count = el.querySelector<HTMLElement>('.felt-toast__count');
        if (count) count.textContent = state.count > 1 ? `×${state.count}` : '';
      }
      const t = this.queue.progress(state);
      if (entry.float) {
        // One rise through all three phases; it fades over its last third.
        const total = this.queue.enter + state.duration + this.queue.exit;
        const elapsed = state.phase === 'entering' ? state.age
          : state.phase === 'shown' ? this.queue.enter + state.age
            : this.queue.enter + state.duration + state.age;
        const k = Math.min(1, elapsed / Math.max(1, total));
        const lift = reduced ? 0 : entry.float.rise * (1 - (1 - k) ** 2);
        const pop = reduced ? 1 : k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : k < 0.3 ? 1.1 - ((k - 0.15) / 0.15) * 0.1 : 1;
        el.style.opacity = String(k < 0.66 ? 1 : 1 - (k - 0.66) / 0.34);
        el.style.transform = `translate(-50%, -50%) translateY(${-lift}px) scale(${pop})`;
        continue;
      }
      const shown = state.phase === 'entering' ? easeOut(t) : state.phase === 'leaving' ? 1 - easeIn(t) : 1;
      const from = state.place === 'bottom' ? 16 : state.place === 'top' ? -16 : 0;
      el.style.opacity = String(shown);
      el.style.transform = reduced ? 'none'
        : state.place === 'center' ? `scale(${0.85 + 0.15 * shown})` : `translateY(${from * (1 - shown)}px)`;
    }
  }

  private make(entry: Entry): HTMLElement {
    const { state, options } = entry;
    const el = document.createElement('div');
    el.dataset.toast = String(state.id);
    if (entry.float) {
      el.className = `felt-float ${options.className ?? ''}`.trim();
      Object.assign(el.style, {
        position: 'absolute', left: `${entry.float.x}px`, top: `${entry.float.y}px`,
        font: `700 ${options.size ?? 22}px/1 ${DISPLAY_FONT}`, color: options.color ?? '#ffd166',
        whiteSpace: 'nowrap', textShadow: '0 1px 0 #000, 0 0 6px rgba(0,0,0,0.6)', willChange: 'transform, opacity',
      } as Partial<CSSStyleDeclaration>);
      el.textContent = state.text;
      this.layer.appendChild(el);
      return el;
    }
    const tone = TONES[options.tone ?? 'info'] ?? TONES.info;
    el.className = `felt-toast felt-toast--${state.place} felt-toast--${options.tone ?? 'info'} ${options.className ?? ''}`.trim();
    Object.assign(el.style, {
      maxWidth: '86%', boxSizing: 'border-box', padding: state.place === 'center' ? '14px 26px' : '9px 18px',
      borderRadius: '10px', background: tone.bg, color: tone.fg, border: `1.5px solid ${tone.edge}`,
      boxShadow: '0 6px 20px rgba(0,0,0,0.45)', textAlign: 'center',
      font: state.place === 'center' ? `700 26px/1.2 ${DISPLAY_FONT}` : undefined,
      letterSpacing: state.place === 'center' ? '0.04em' : undefined,
      pointerEvents: options.dismissible === false ? 'none' : 'auto', cursor: 'pointer', willChange: 'transform, opacity',
    } as Partial<CSSStyleDeclaration>);
    const words = document.createElement('span');
    words.textContent = state.text;
    const count = document.createElement('span');
    count.className = 'felt-toast__count';
    Object.assign(count.style, { marginLeft: '0.4em', opacity: '0.75', fontSize: '0.8em' });
    el.append(words, count);
    if (options.dismissible !== false) {
      el.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        this.queue.dismiss(state.id);
        this.wake();
      });
    }
    // In arrival order within its place, the oldest at the edge.
    this.stacks[state.place as Exclude<ToastPlace, 'float'>].appendChild(el);
    return el;
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 2;

/** The board's toasts, made (with their layer over the canvas) on first use. */
export function toastsOf(board: Board, options: ToasterOptions = {}): Toaster {
  let toaster = board.services.get('felt:toasts') as Toaster | undefined;
  if (!toaster) board.services.set('felt:toasts', (toaster = new Toaster(board, options)));
  return toaster;
}
