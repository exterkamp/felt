import type { Region } from '../gl/atlas.js';
import { animatorOf } from '../scene/animator.js';
import type { Board } from '../scene/board.js';
import type { Node } from '../scene/node.js';
import { Sprite } from '../scene/sprite.js';
import type { Place } from '../core/stack.js';
import type { Zone } from './table.js';

// Lighting cards and places up: what is selected, where it may go, a hint,
// a refusal.
//
// A highlight is a sprite - a glow, an outline or both, painted once in
// white per size and shape into the atlas and tinted to its style, so every
// selected card on the table and every legal target share one or two
// pictures. Each frame, before drawing, every highlight is put exactly where
// its card is *shown*: its pose with every running offset on it (a throw's
// arc, a flip's roll, the pick-up's lift and swivel, its extra perspective),
// so a highlight rides a flying, tilting, lifted card without anything
// telling it to. It is drawn half a step of depth under its card: its own
// card covers its middle, the cards above it in a pile or a fan cover it as
// they cover the card, and its rim lies over only what is beneath.
//
// A zone's highlight sits on its top card the same way, or on the empty
// place where the next card would land.

/** What a highlight looks like. */
export interface HighlightLook {
  /** 0xrrggbb or a CSS colour. */
  color: number | string;
  /** A soft glow round the card, a crisp outline, or both. Default 'glow'. */
  shape?: 'glow' | 'outline' | 'both';
  /** How far the glow reaches past the card's edge, board units. Default 9. */
  spread?: number;
  /** How bright, 0-1. Default 1. */
  strength?: number;
  /** Milliseconds per pulse, or 0 for steady. Default 0. */
  pulse?: number;
}

/** The looks every board knows by name. `define` adds more, or changes these. */
export const HIGHLIGHT_STYLES: Readonly<Record<string, HighlightLook>> = {
  /** What the player has picked: warm gold, steady. */
  selected: { color: 0xffd166, shape: 'both', spread: 9 },
  /** Where it may go: a cool outline and a faint glow. */
  target: { color: 0x7fd8ff, shape: 'both', spread: 7, strength: 0.85 },
  /** A suggestion: green, breathing. */
  hint: { color: 0x7dff9a, shape: 'both', spread: 11, pulse: 900 },
  /** Turned down: red, flashed. */
  refused: { color: 0xff4040, shape: 'both', spread: 11 },
};

/** A style by name, or a look of its own. */
export type HighlightStyle = string | HighlightLook;

export interface HighlightOptions {
  /** A name to clear it by along with others: `highlights.clear('hint')`. */
  group?: string;
  /** Gone after this many ms, faded out. Default: until removed. */
  for?: number;
  /** Fade in and out over this many ms. Default 120. */
  fade?: number;
}

/** What a highlight is on: a card (any node), a zone, or a fixed place. */
export type HighlightTarget = Node | Zone | Place;

/** One highlight on the board. */
export interface Highlight {
  readonly target: HighlightTarget;
  readonly look: Readonly<HighlightLook>;
  readonly group: string | undefined;
  /** Whether it has been removed (it may still be fading out). */
  readonly removed: boolean;
  /** Fades it out and takes it off. */
  remove(): void;
}

/** The colour as 0xrrggbb, from a number or any CSS colour. */
function toRgb(color: number | string): number {
  if (typeof color === 'number') return color & 0xffffff;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return Number.parseInt(h, 16);
  }
  if (typeof document === 'undefined') return 0xffffff;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = color;
  const css = probe.fillStyle;
  if (css.startsWith('#')) return Number.parseInt(css.slice(1, 7), 16);
  const [r = 255, g = 255, b = 255] = css.match(/[\d.]+/g)?.map(Number) ?? [];
  return (r << 16) | (g << 8) | b;
}

const isZone = (target: HighlightTarget): target is Zone =>
  typeof (target as Zone).next === 'function' && Array.isArray((target as Zone).list);
const isNode = (target: HighlightTarget): target is Node =>
  typeof (target as Node).writeInstance === 'function';

/**
 * A sprite drawn with its card's extra perspective, so the highlight on a
 * card tipped up in the hand is foreshortened exactly as the card is.
 */
class HighlightSprite extends Sprite {
  lens = 0;
  override writeInstance(out: Float32Array, o: number): boolean {
    if (!super.writeInstance(out, o)) return false;
    out[o + 29] = this.lens;
    return true;
  }
}

interface Live extends Highlight {
  target: HighlightTarget;
  look: HighlightLook;
  group: string | undefined;
  removed: boolean;
  sprites: HighlightSprite[];
  /** The size its pictures were painted for. */
  size: string;
  /** Faded in/out, 0-1, and a pulse's dip, 0-1: multiplied into its alpha. */
  level: number;
  wave: number;
  fade: number;
}

/** A corner radius for something that is not a card, which knows its own. */
const radiusFor = (width: number) => Math.max(2, width * 0.1);

/**
 * The highlights on one board: a board service, `Highlights.of(board)`,
 * gone with the board.
 */
export class Highlights {
  private readonly live = new Set<Live>();
  private readonly looks = new Map<string, HighlightLook>(Object.entries(HIGHLIGHT_STYLES));
  /** Each target's running flash, so a second flash restarts it rather than stacking. */
  private readonly flashes = new Map<HighlightTarget, Live>();

  private constructor(readonly board: Board) {
    board.beforeRender(() => this.follow());
    board.on('destroy', () => { this.live.clear(); this.flashes.clear(); });
  }

  /** The board's highlights. One each. */
  static of(board: Board): Highlights {
    let highlights = board.services.get('highlights') as Highlights | undefined;
    if (!highlights) {
      highlights = new Highlights(board);
      board.services.set('highlights', highlights);
    }
    return highlights;
  }

  /** Names a look - a game's own colour - or changes one of the built-in ones. */
  define(name: string, look: HighlightLook): this {
    this.looks.set(name, look);
    return this;
  }

  /** A look by name (or the look itself). */
  look(style: HighlightStyle): HighlightLook {
    if (typeof style !== 'string') return style;
    const look = this.looks.get(style);
    if (!look) throw new Error(`no highlight style called ${style}`);
    return look;
  }

  /** Every highlight showing (not removed), optionally of one group. */
  list(group?: string): Highlight[] {
    return [...this.live].filter((h) => !h.removed && (group === undefined || h.group === group));
  }

  /**
   * Lights a card (or any node), a zone, or a fixed place on the felt. A
   * zone's highlight is on its top card, or its empty place - whichever it
   * has at the time, every frame.
   */
  add(target: HighlightTarget, style: HighlightStyle = 'selected', options: HighlightOptions = {}): Highlight {
    const look = this.look(style);
    const h: Live = {
      target, look, group: options.group, removed: false, sprites: [], size: '',
      level: 0, wave: 1, fade: options.fade ?? 120,
      remove: () => this.remove(h),
    };
    this.live.add(h);
    const animator = animatorOf(this.board);
    void animator.play(h, {
      channel: 'level', policy: 'interrupt', duration: h.fade, ease: 'Quad.easeOut',
      update: (t) => { h.level = t; this.board.touch(); },
      complete: () => { h.level = 1; },
    });
    if (look.pulse) this.pulse(h);
    if (options.for !== undefined) {
      void animator.play(h, { channel: 'life', duration: options.for, complete: () => this.remove(h) });
    }
    this.follow();
    return h;
  }

  /** Shorthand: `add(card, style)`. */
  card(card: Node, style: HighlightStyle = 'selected', options?: HighlightOptions): Highlight {
    return this.add(card, style, options);
  }

  /** Shorthand: `add(zone, style)`. */
  zone(zone: Zone, style: HighlightStyle = 'target', options?: HighlightOptions): Highlight {
    return this.add(zone, style, options);
  }

  /**
   * A brief flash - 'refused' by default - on a card, zone or place: up at
   * once, then fading over `ms`. A second flash on the same target while one
   * runs starts it again rather than adding another.
   */
  flash(target: HighlightTarget, style: HighlightStyle = 'refused', ms = 520): Promise<void> {
    const running = this.flashes.get(target);
    if (running) this.drop(running);
    const look = this.look(style);
    const h: Live = {
      target, look, group: 'flash', removed: false, sprites: [], size: '', level: 0, wave: 1, fade: 0,
      remove: () => this.remove(h),
    };
    this.live.add(h);
    this.flashes.set(target, h);
    this.follow();
    return animatorOf(this.board).play(h, {
      channel: 'level', policy: 'interrupt', duration: ms,
      // Two quick beats and a fade: read as "no", not as "here".
      update: (t) => {
        const beat = t < 0.5 ? Math.abs(Math.cos(t * Math.PI * 2)) : 1;
        h.level = Math.min(1, (1 - t) * 1.6) * (0.35 + 0.65 * beat);
        this.board.touch();
      },
      complete: () => { if (this.flashes.get(target) === h) this.flashes.delete(target); this.drop(h); },
    });
  }

  /** Fades a highlight out and takes it off. */
  remove(highlight: Highlight): void {
    const h = highlight as Live;
    if (h.removed || !this.live.has(h)) return;
    h.removed = true;
    const animator = animatorOf(this.board);
    animator.stop(h, 'life');
    const from = h.level;
    if (h.fade <= 0 || from <= 0) { this.drop(h); return; }
    void animator.play(h, {
      channel: 'level', policy: 'interrupt', duration: h.fade * from,
      update: (t) => { h.level = from * (1 - t); this.board.touch(); },
      complete: () => this.drop(h),
    });
  }

  /** Removes every highlight, or every one of a group. */
  clear(group?: string): void {
    for (const h of this.list(group)) this.remove(h);
  }

  /** Off the board at once, no fade. */
  private drop(h: Live): void {
    h.removed = true;
    animatorOf(this.board).stop(h);
    for (const s of h.sprites) s.destroy();
    h.sprites = [];
    this.live.delete(h);
    if (this.flashes.get(h.target) === h) this.flashes.delete(h.target);
    this.board.touch();
  }

  /** A pulse, one breath at a time, on the board's clock, until it is removed. */
  private pulse(h: Live): void {
    const period = h.look.pulse ?? 0;
    if (!period || !this.live.has(h)) return;
    void animatorOf(this.board).play(h, {
      channel: 'pulse', policy: 'ignore', duration: period,
      update: (t) => { h.wave = 0.45 + 0.55 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2)); this.board.touch(); },
      complete: () => { if (!h.removed) this.pulse(h); },
    });
  }

  // --- drawing --------------------------------------------------------------

  /** The pictures for a size and look: shared by every highlight that size and shape. */
  private regions(width: number, height: number, radius: number, look: HighlightLook):
    { region: Region; w: number; h: number }[] {
    const board = this.board;
    const ratio = board.pixelRatio;
    const spread = look.spread ?? 9;
    const shape = look.shape ?? 'glow';
    const out: { region: Region; w: number; h: number }[] = [];
    const w = width + spread * 2;
    const h = height + spread * 2;
    if (shape === 'glow' || shape === 'both') {
      const key = `felt-highlight-glow-${width}x${height}r${radius}-${spread}@${ratio}`;
      const region = board.atlas.obtain(key, Math.ceil(w * ratio), Math.ceil(h * ratio), (pen) => {
        const p = pen as CanvasRenderingContext2D;
        p.scale(ratio, ratio);
        // A white rounded rect, blurred out past the card's edge by its own
        // shadow, then the card's own shape cut back out: only the halo is
        // left, so nothing of it tints the card or shows past its corners.
        p.save();
        p.translate(-10000, 0);
        p.shadowColor = 'rgba(255, 255, 255, 1)';
        p.shadowBlur = spread * ratio * 0.9;
        p.shadowOffsetX = 10000 * ratio;
        p.fillStyle = '#fff';
        p.beginPath();
        p.roundRect(spread - 1, spread - 1, width + 2, height + 2, radius + 1);
        p.fill();
        p.fill();
        p.restore();
        p.globalCompositeOperation = 'destination-out';
        p.beginPath();
        p.roundRect(spread, spread, width, height, radius);
        p.fill();
      });
      out.push({ region, w, h });
    }
    if (shape === 'outline' || shape === 'both') {
      const key = `felt-highlight-outline-${width}x${height}r${radius}@${ratio}`;
      const ow = width + 8;
      const oh = height + 8;
      const region = board.atlas.obtain(key, Math.ceil(ow * ratio), Math.ceil(oh * ratio), (pen) => {
        const p = pen as CanvasRenderingContext2D;
        p.scale(ratio, ratio);
        p.strokeStyle = '#fff';
        p.lineWidth = 2.25;
        p.beginPath();
        p.roundRect(2.25, 2.25, ow - 4.5, oh - 4.5, radius + 2);
        p.stroke();
      });
      out.push({ region, w: ow, h: oh });
    }
    return out;
  }

  /** The node a target is drawn on this frame, if it is on one. */
  private anchorOf(target: HighlightTarget): Node | undefined {
    if (isNode(target)) return target;
    if (isZone(target)) return target.top;
    return undefined;
  }

  /** Every highlight to where its target is shown. Run before every frame. */
  private follow(): void {
    for (const h of this.live) this.place(h);
  }

  private place(h: Live): void {
    const target = h.target;
    if (isNode(target) && target.isDestroyed) { this.drop(h); return; }
    const anchor = this.anchorOf(target);
    let width: number;
    let height: number;
    if (anchor) {
      width = anchor.width;
      height = anchor.height;
    } else if (isZone(target)) {
      ({ width, height } = target.table.cardSize());
    } else {
      ({ width, height } = { width: 60, height: 84 });
    }
    const radius = (anchor as { metrics?: { radius: number } } | undefined)?.metrics?.radius ?? radiusFor(width);
    const size = `${width}x${height}r${radius}`;
    if (size !== h.size) {
      for (const s of h.sprites) s.destroy();
      h.sprites = this.regions(width, height, radius, h.look).map(({ region, w, h: ht }) =>
        new HighlightSprite(this.board, region, { width: w, height: ht, tint: toRgb(h.look.color) }, true));
      h.size = size;
    }
    const alpha = (h.look.strength ?? 1) * h.level * h.wave;
    if (anchor) {
      const shown = anchor.visible && anchor.alpha > 0 && (anchor as { revealed?: boolean }).revealed !== false;
      const p = anchor.shown;
      for (const s of h.sprites) {
        s.visible = shown;
        s.x = p.x; s.y = p.y; s.z = p.z;
        s.angle = p.angle; s.tilt = p.tilt; s.turn = p.turn; s.bow = p.bow;
        s.scaleX = p.scaleX; s.scaleY = p.scaleY;
        s.lens = p.lens;
        s.alpha = alpha * anchor.alpha;
        // Just under its card: over everything the card is over, under
        // everything that is over the card.
        s.depth = anchor.depth - 0.5;
      }
      return;
    }
    const place: Place = isZone(target) ? target.next() : target as Place;
    const depth = isZone(target) ? target.base - 0.5 : 0.5;
    for (const s of h.sprites) {
      s.visible = true;
      s.x = place.x; s.y = place.y; s.z = 0;
      s.angle = place.angle ?? 0; s.tilt = 0; s.turn = 0; s.bow = 0;
      s.scaleX = 1; s.scaleY = 1; s.lens = 0;
      s.alpha = alpha;
      s.depth = depth;
    }
  }
}

/** The board's highlights: `Highlights.of(board)`. */
export function highlights(board: Board): Highlights {
  return Highlights.of(board);
}
