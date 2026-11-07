import type { Atlas, Region } from '../gl/atlas.js';
import type { Dispose } from '../runtime/disposables.js';

// Text that changes, without filling the atlas.
//
// `board.text('Score 1234')` rasterises the whole line into a region of its
// own, keyed by the string. A score that changes sixty times a second is
// then sixty new regions a second, every one dead the moment the next lands,
// until the atlas runs out and evicts - and a page added to the texture on
// the way is a reallocation of the whole thing on the GPU.
//
// A readout is instead made of glyphs: each character of a style is painted
// once, in white, into a region of its own, and a line is a row of sprites
// showing them. Changing "1234" to "1235" changes which region the last
// sprite shows; nothing is painted and nothing is allocated. The colour is
// the sprites' tint, so one set of glyphs serves every colour of a face. A
// score in one style costs at most the ten digits and its separators -
// around a dozen small regions, whatever it counts to.
//
// The price is kerning: glyphs are placed by their own advances, not as a
// shaped line. For numbers - which want tabular figures anyway - nothing is
// lost; for words ("Stock", a pile's label) it is barely visible at the
// sizes labels are, and a long static sentence still belongs in
// `board.text` or `paintFelt`.

/** How a readout's characters are drawn. Everything but `color` picks the glyphs. */
export interface GlyphStyle {
  /** A CSS font family. Default `BODY_FONT`'s first choice, falling back to sans-serif. */
  font?: string;
  /** In board units. Default 16. */
  size?: number;
  /** CSS weight. Default `'normal'`. */
  weight?: string;
  /** An outline round each glyph, painted in, untinted: `'#000'`. Default none. */
  stroke?: string;
  /** The outline's width, board units. Default `size / 8`. */
  strokeWidth?: number;
}

/** One painted character, shared by every sprite showing it. */
export interface Glyph {
  readonly key: string;
  readonly char: string;
  readonly region: Region;
  /** The region's size in board units: what a sprite shows it at. */
  readonly width: number;
  readonly height: number;
}

/** What a glyph cache needs of its board. */
export interface GlyphHost {
  readonly atlas: Atlas;
  readonly pixelRatio: number;
}

export interface GlyphCacheOptions {
  /** Width of `text` in `font`, in CSS px. Default: a canvas's measureText. */
  measure?: (font: string, text: string) => number;
  /** Where faces load from. Default `document.fonts`; `null` for none. */
  fonts?: Pick<FontFaceSet, 'check' | 'load'> | null;
}

const DEFAULT_FONT = '"Jost", "Helvetica Neue", Arial, sans-serif';

/** The CSS font a style draws in. */
export function cssFont(style: GlyphStyle): string {
  return `${style.weight ?? 'normal'} ${style.size ?? 16}px ${style.font ?? DEFAULT_FONT}`;
}

/** Room round a glyph for what overhangs its advance (italics, an outline). */
function padOf(style: GlyphStyle): number {
  const size = style.size ?? 16;
  return Math.ceil(size * 0.2 + (style.stroke ? strokeOf(style) : 0));
}

function strokeOf(style: GlyphStyle): number {
  return style.strokeWidth ?? (style.size ?? 16) / 8;
}

/** The height of a line of a style: the em box and some room, in board units. */
export function lineHeightOf(style: GlyphStyle): number {
  return Math.ceil((style.size ?? 16) * 1.3) + 2 * padOf(style);
}

const DIGITS = '0123456789';

/**
 * Every glyph a board's readouts show, painted once and counted.
 *
 * A board service: `glyphsOf(board)`. A glyph's region is obtained from the
 * atlas when its first sprite wants it and released when its last lets go;
 * a released one stays in the atlas, free to be revived, until the atlas
 * needs the room. So churn between a few values paints nothing, ever.
 */
export class GlyphCache {
  private readonly entries = new Map<string, { glyph: Glyph; uses: number }>();
  private readonly advances = new Map<string, Map<string, number>>();
  /** Bumped per font when its face arrives: glyphs painted before are in the fallback. */
  private readonly generations = new Map<string, number>();
  private readonly watched = new Set<string>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly measure: (font: string, text: string) => number;
  private readonly fonts: Pick<FontFaceSet, 'check' | 'load'> | null;
  private pen?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** Glyphs painted so far - each a region painted once. For anyone measuring. */
  painted = 0;

  constructor(readonly host: GlyphHost, options: GlyphCacheOptions = {}) {
    this.measure = options.measure ?? ((font, text) => this.measureWithCanvas(font, text));
    this.fonts = options.fonts !== undefined ? options.fonts
      : typeof document !== 'undefined' ? document.fonts ?? null : null;
  }

  /** Glyphs in use right now. */
  get size(): number {
    return this.entries.size;
  }

  /** The advance of a character, in board units. */
  advance(style: GlyphStyle, char: string): number {
    const font = cssFont(style);
    this.watch(font);
    let table = this.advances.get(font);
    if (!table) this.advances.set(font, (table = new Map()));
    let width = table.get(char);
    if (width === undefined) {
      width = this.measure(font, char);
      table.set(char, width);
    }
    return width;
  }

  /** The widest digit's advance: what every digit gets with tabular figures. */
  digitAdvance(style: GlyphStyle): number {
    let widest = 0;
    for (const digit of DIGITS) widest = Math.max(widest, this.advance(style, digit));
    return widest;
  }

  /** A glyph, counted. Painted if no sprite showed it before (or since it was let go). */
  use(style: GlyphStyle, char: string): Glyph {
    const font = cssFont(style);
    const key = this.keyOf(style, font, char);
    const entry = this.entries.get(key);
    if (entry) {
      entry.uses++;
      return entry.glyph;
    }
    const ratio = this.host.pixelRatio;
    const pad = padOf(style);
    const width = Math.ceil((this.advance(style, char) + 2 * pad) * ratio) / ratio;
    const height = Math.ceil(lineHeightOf(style) * ratio) / ratio;
    const stroke = style.stroke;
    const lineWidth = strokeOf(style) * 2;
    const wasPainted = this.host.atlas.has(key);
    const region = this.host.atlas.obtain(key, Math.round(width * ratio), Math.round(height * ratio), (pen) => {
      pen.scale(ratio, ratio);
      pen.font = font;
      pen.textAlign = 'center';
      pen.textBaseline = 'middle';
      if (stroke) {
        pen.lineJoin = 'round';
        pen.lineWidth = lineWidth;
        pen.strokeStyle = stroke;
        pen.strokeText(char, width / 2, height / 2);
      }
      // White, so the sprite's tint is its colour.
      pen.fillStyle = '#ffffff';
      pen.fillText(char, width / 2, height / 2);
    });
    if (!wasPainted) this.painted++;
    const glyph: Glyph = { key, char, region, width, height };
    this.entries.set(key, { glyph, uses: 1 });
    return glyph;
  }

  /** Lets go of one use. The last lets the atlas have the region back when it needs it. */
  unuse(glyph: Glyph | undefined): void {
    if (!glyph) return;
    const entry = this.entries.get(glyph.key);
    if (!entry || entry.glyph !== glyph) return;
    if (--entry.uses > 0) return;
    this.entries.delete(glyph.key);
    this.host.atlas.release(glyph.region);
  }

  /**
   * Calls back when a font's face arrives and every glyph and advance in it
   * changes: the readouts using it lay themselves out again.
   */
  onReflow(style: GlyphStyle, fn: () => void): Dispose {
    const font = cssFont(style);
    this.watch(font);
    let set = this.listeners.get(font);
    if (!set) this.listeners.set(font, (set = new Set()));
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  /**
   * The face for a font has arrived (or changed): forget its measurements,
   * paint its glyphs again under a new key, and tell its readouts.
   */
  reflow(font: string): void {
    this.generations.set(font, (this.generations.get(font) ?? 0) + 1);
    this.advances.delete(font);
    for (const fn of [...(this.listeners.get(font) ?? [])]) fn();
  }

  private keyOf(style: GlyphStyle, font: string, char: string): string {
    const stroke = style.stroke ? `${style.stroke}/${strokeOf(style)}` : '';
    return `glyph|${font}|${stroke}|${this.host.pixelRatio}|${this.generations.get(font) ?? 0}|${char}`;
  }

  /** Measured and painted again once a face still loading is in: the fallback is another width. */
  private watch(font: string): void {
    if (this.watched.has(font) || !this.fonts) return;
    this.watched.add(font);
    let ready = true;
    try { ready = this.fonts.check(font); } catch { /* not a font the set knows */ }
    if (ready) return;
    void this.fonts.load(font).then(() => this.reflow(font), () => {});
  }

  private measureWithCanvas(font: string, text: string): number {
    if (!this.pen) {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
      this.pen = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    }
    this.pen.font = font;
    return this.pen.measureText(text).width;
  }
}

/** The board's glyph cache, made on first use. */
export function glyphsOf(board: GlyphHost & { readonly services: Map<string, unknown> }): GlyphCache {
  let cache = board.services.get('felt:glyphs') as GlyphCache | undefined;
  if (!cache) board.services.set('felt:glyphs', (cache = new GlyphCache(board)));
  return cache;
}

/** A character placed on a line, by the middle of its advance. */
export interface GlyphPlace {
  readonly char: string;
  /** From the line's left edge to the middle of this character's advance. */
  readonly x: number;
}

export interface LineLayout {
  readonly places: GlyphPlace[];
  /** Advance of the whole line. */
  readonly width: number;
}

/**
 * Lays a line out by advances. With `tabular`, every digit gets the widest
 * digit's advance (centred in it), so `1111` and `8888` are one width and a
 * right-aligned score does not shimmy as it counts.
 */
export function layoutLine(text: string, advanceOf: (char: string) => number,
  options: { tabular?: boolean; digitAdvance?: number; letterSpacing?: number } = {}): LineLayout {
  const { tabular = false, letterSpacing = 0 } = options;
  const digit = options.digitAdvance ?? 0;
  const places: GlyphPlace[] = [];
  let pen = 0;
  const chars = [...text];
  chars.forEach((char, i) => {
    const advance = tabular && char >= '0' && char <= '9' ? digit : advanceOf(char);
    places.push({ char, x: pen + advance / 2 });
    pen += advance + (i < chars.length - 1 ? letterSpacing : 0);
  });
  return { places, width: pen };
}

/** Where a line of `width` starts, from its anchor. */
export function alignOffset(width: number, align: 'left' | 'center' | 'right'): number {
  return align === 'left' ? 0 : align === 'right' ? -width : -width / 2;
}
