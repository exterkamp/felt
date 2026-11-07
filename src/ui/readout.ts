import type { Dispose } from '../runtime/disposables.js';
import { Sprite, SpriteHost } from '../scene/sprite.js';
import type { Tweens } from '../scene/tweens.js';
import { NumberFormat, formatNumber, parseColor } from './format.js';
import {
  Glyph, GlyphCache, GlyphHost, GlyphStyle, LineLayout, alignOffset, glyphsOf, layoutLine, lineHeightOf,
} from './glyphs.js';
import { prefersReducedMotion } from './motion.js';

// A readout: a number or a short label that lives at a place on the board -
// a score, "Stock 24", a turn clock, a pile's name, a chip total.
//
// It is a row of sprites on the board, so it moves and scales with the board
// when the page is resized, sorts with the cards (under them at a low depth,
// over them at a high one), lands in `board.snapshot()`, and costs one
// instance a character in the same draw call as the cards. The characters
// are glyphs from the board's glyph cache (see glyphs.ts), so changing the
// value paints nothing: a score bumped sixty times a second costs exactly
// what a still one does.

/** What a readout needs of its board. A `Board` is one. */
export interface ReadoutHost extends SpriteHost, GlyphHost {
  readonly services: Map<string, unknown>;
  readonly tweens: Tweens;
}

export interface ReadoutOptions extends GlyphStyle {
  /** Where its anchor is, in board units. */
  x?: number;
  y?: number;
  /** Draw order against the cards: low for under them, high for over. Default 0. */
  depth?: number;
  alpha?: number;
  /** The first value: a number (formatted) or text (shown as is). Default 0. */
  value?: number | string;
  /**
   * How a number is written: a function (`formatClock`, say) or the options
   * of `formatNumber`. Default `formatNumber` with no options: `12,345`.
   */
  format?: ((value: number) => string) | NumberFormat;
  /** The ink, tinted onto white glyphs: a CSS colour or 0xrrggbb. Default white. */
  color?: string | number;
  /** Which end of the line its x is. Default `'center'`. */
  align?: 'left' | 'center' | 'right';
  /** Which edge of the line its y is. Default `'middle'`. */
  valign?: 'top' | 'middle' | 'bottom';
  /** Every digit the width of the widest, so the line does not shimmy as it counts. Default true. */
  tabular?: boolean;
  /** Extra room between characters, board units. Default 0. */
  letterSpacing?: number;
  /**
   * Milliseconds a new number counts up (or down) to itself, eased, instead
   * of jumping. 0 (default) jumps. Off under reduced motion.
   */
  countUp?: number;
  /**
   * A "pop" when the text changes: `true` for a scale of 1.25 and back, or the
   * peak scale. Off under reduced motion. Default false.
   */
  pop?: boolean | number;
  /** Override the system's reduced-motion setting, for tests and options screens. */
  reducedMotion?: boolean;
  /**
   * Put each glyph's edge on a pixel of the canvas, so a readout at rest is
   * as sharp as its glyphs were painted. Default true. (Not while it pops.)
   */
  snap?: boolean;
}

interface Slot {
  sprite: Sprite;
  glyph?: Glyph;
}

/**
 * A line of text on the board that changes cheaply. Make one with
 * `readout(board, options)`.
 *
 *     const score = readout(board, { x: 460, y: 20, align: 'right', size: 22, color: '#ffd166', pop: true });
 *     score.set(score.value as number + 15);
 */
export class Readout {
  private readonly cache: GlyphCache;
  private readonly style: GlyphStyle;
  private readonly slots: Slot[] = [];
  private readonly formatter: (value: number) => string;
  private readonly offReflow: Dispose;
  private readonly counter = { shown: 0 };
  private readonly popper = { scale: 1 };
  private _value: number | string;
  private _text = '';
  private lineWidth = 0;
  private layout: LineLayout = { places: [], width: 0 };
  private _x: number;
  private _y: number;
  private _depth: number;
  private _alpha: number;
  private _visible = true;
  private _scale = 1;
  private tint: number;
  private destroyed = false;
  readonly align: 'left' | 'center' | 'right';
  readonly valign: 'top' | 'middle' | 'bottom';
  readonly tabular: boolean;
  readonly letterSpacing: number;
  /** See `ReadoutOptions.countUp`. */
  countUp: number;
  /** The peak scale of a pop; 1 for none. */
  popScale: number;
  /** See `ReadoutOptions.reducedMotion`. */
  reducedMotion?: boolean;
  snap: boolean;

  constructor(readonly host: ReadoutHost, options: ReadoutOptions = {}) {
    this.cache = glyphsOf(host);
    this.style = {
      font: options.font, size: options.size ?? 16, weight: options.weight,
      stroke: options.stroke, strokeWidth: options.strokeWidth,
    };
    const format = options.format;
    this.formatter = typeof format === 'function' ? format : (v) => formatNumber(v, format);
    this._x = options.x ?? 0;
    this._y = options.y ?? 0;
    this._depth = options.depth ?? 0;
    this._alpha = options.alpha ?? 1;
    this.tint = parseColor(options.color);
    this.align = options.align ?? 'center';
    this.valign = options.valign ?? 'middle';
    this.tabular = options.tabular ?? true;
    this.letterSpacing = options.letterSpacing ?? 0;
    this.countUp = options.countUp ?? 0;
    this.popScale = options.pop === true ? 1.25 : typeof options.pop === 'number' ? options.pop : 1;
    this.reducedMotion = options.reducedMotion;
    this.snap = options.snap ?? true;
    this._value = options.value ?? 0;
    if (typeof this._value === 'number') this.counter.shown = this._value;
    // A face that arrives after the first paint: measured and painted again.
    this.offReflow = this.cache.onReflow(this.style, () => this.render(this._text, true));
    this.render(this.textOf(this._value));
  }

  /** The value it was last set to (a count-up may still be on its way there). */
  get value(): number | string { return this._value; }
  set value(v: number | string) { this.set(v); }

  /** The text on the board right now. */
  get text(): string { return this._text; }

  /** The text a value is written as. */
  textOf(value: number | string): string {
    return typeof value === 'number' ? this.formatter(value) : value;
  }

  /**
   * Shows a new value. A number counts up to it if `countUp` is set (pass
   * `{ animate: false }` to jump), and the line pops if it changed and `pop`
   * is set. Answers itself.
   */
  set(value: number | string, options: { animate?: boolean; pop?: boolean } = {}): this {
    if (this.destroyed) return this;
    const before = this.textOf(this._value);
    this._value = value;
    const motion = !this.reduced && options.animate !== false;
    this.host.tweens.killTweensOf(this.counter);
    if (typeof value === 'number' && motion && this.countUp > 0 && this.textOf(this.counter.shown) !== this.textOf(value)) {
      this.host.tweens.add({
        targets: this.counter, shown: value, duration: this.countUp, ease: 'Cubic.easeOut',
        onUpdate: () => this.render(this.textOf(this.counter.shown)),
      });
    } else {
      if (typeof value === 'number') this.counter.shown = value;
      this.render(this.textOf(value));
    }
    if ((options.pop ?? true) && motion && this.textOf(value) !== before) this.pop();
    return this;
  }

  /** Pops the line now: up to `popScale` and back. Nothing under reduced motion. */
  pop(peak = this.popScale): this {
    if (this.destroyed || peak === 1 || this.reduced) return this;
    const tweens = this.host.tweens;
    tweens.killTweensOf(this.popper);
    this.popper.scale = 1;
    tweens.add({
      targets: this.popper, scale: peak, duration: 90, yoyo: true, ease: 'Quad.easeOut',
      onUpdate: () => this.place(), onComplete: () => this.place(),
    });
    return this;
  }

  get x(): number { return this._x; }
  set x(v: number) { this._x = v; this.place(); }
  get y(): number { return this._y; }
  set y(v: number) { this._y = v; this.place(); }
  setPosition(x: number, y: number): this { this._x = x; this._y = y; this.place(); return this; }
  /** Scales the whole line about its anchor. */
  get scale(): number { return this._scale; }
  set scale(v: number) { this._scale = v; this.place(); }
  get depth(): number { return this._depth; }
  set depth(v: number) { this._depth = v; for (const s of this.slots) s.sprite.depth = v; }
  get alpha(): number { return this._alpha; }
  set alpha(v: number) { this._alpha = v; for (const s of this.slots) s.sprite.alpha = v; }
  get visible(): boolean { return this._visible; }
  set visible(v: boolean) { this._visible = v; this.render(this._text, true); }
  /** Its ink, as 0xrrggbb. Set with a CSS colour or a number. Repaints nothing. */
  get color(): number { return this.tint; }
  set color(v: string | number) {
    this.tint = parseColor(v);
    for (const s of this.slots) s.sprite.tint = this.tint;
  }

  /** The line's box on the board, as drawn at rest (a pop excluded), in board units. */
  get bounds(): { x: number; y: number; width: number; height: number } {
    const s = this._scale;
    const width = this.lineWidth * s;
    const height = lineHeightOf(this.style) * s;
    const top = this._y + this.verticalOffset() * s - height / 2;
    return { x: this._x + alignOffset(width, this.align), y: top, width, height };
  }

  /** Sprites drawing it: one per visible character. */
  get sprites(): readonly Sprite[] {
    return this.slots.filter((s) => s.glyph && s.sprite.visible).map((s) => s.sprite);
  }

  get isDestroyed(): boolean { return this.destroyed; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.offReflow();
    this.host.tweens.killTweensOf(this.counter);
    this.host.tweens.killTweensOf(this.popper);
    for (const slot of this.slots) {
      this.cache.unuse(slot.glyph);
      slot.sprite.destroy();
    }
    this.slots.length = 0;
  }

  private get reduced(): boolean {
    return this.reducedMotion ?? prefersReducedMotion();
  }

  /** Points every slot at the glyph its character needs. `force` re-gets every glyph (a face arrived). */
  private render(text: string, force = false): void {
    if (this.destroyed || (text === this._text && !force)) return;
    this._text = text;
    const style = this.style;
    const layout = layoutLine(text, (c) => this.cache.advance(style, c), {
      tabular: this.tabular, digitAdvance: this.tabular ? this.cache.digitAdvance(style) : 0,
      letterSpacing: this.letterSpacing,
    });
    this.layout = layout;
    this.lineWidth = layout.width;
    const places = layout.places;
    while (this.slots.length < places.length) {
      this.slots.push({ sprite: new Sprite(this.host, undefined, {
        depth: this._depth, alpha: this._alpha, tint: this.tint, width: 0, height: 0,
      }) });
    }
    this.slots.forEach((slot, i) => {
      const char = places[i]?.char;
      if (char === undefined || !char.trim() || !this._visible) {
        this.cache.unuse(slot.glyph);
        slot.glyph = undefined;
        slot.sprite.visible = false;
        return;
      }
      if (force || slot.glyph?.char !== char) {
        // Taken before the old one is let go, so a glyph moving from one slot
        // to the next is never released and revived in between.
        const glyph = this.cache.use(style, char);
        this.cache.unuse(slot.glyph);
        slot.glyph = glyph;
        slot.sprite.region = glyph.region;
        slot.sprite.setDisplaySize(glyph.width, glyph.height);
      }
      slot.sprite.visible = true;
    });
    this.place();
  }

  private verticalOffset(): number {
    const half = lineHeightOf(this.style) / 2;
    return this.valign === 'top' ? half : this.valign === 'bottom' ? -half : 0;
  }

  /** Puts every sprite where its character goes. */
  private place(): void {
    if (this.destroyed) return;
    const s = this._scale * this.popper.scale;
    const layout = this.layout;
    const start = alignOffset(layout.width, this.align);
    const ratio = this.host.pixelRatio;
    const snap = this.snap && s === 1;
    const cy = this._y + this.verticalOffset() * s;
    layout.places.forEach((place, i) => {
      const slot = this.slots[i];
      if (!slot?.glyph) return;
      let x = this._x + (start + place.x) * s;
      let y = cy;
      if (snap) {
        // The glyph's left and top edges on a canvas pixel: painted 1:1, drawn 1:1.
        const { width, height } = slot.glyph;
        x = Math.round((x - width / 2) * ratio) / ratio + width / 2;
        y = Math.round((y - height / 2) * ratio) / ratio + height / 2;
      }
      slot.sprite.x = x;
      slot.sprite.y = y;
      slot.sprite.scale = s;
    });
  }
}

/** A readout on a board. See `Readout`. */
export function readout(board: ReadoutHost, options: ReadoutOptions = {}): Readout {
  return new Readout(board, options);
}
