import type { Board } from '../scene/board.js';
import { Sprite, type SpriteOptions } from '../scene/sprite.js';

// Paint on the felt itself: the words round a blackjack layout, the boxes
// bets go in, a craps table's numbers, the scrolls in a corner. Each mark is
// drawn once with Canvas 2D as a shape and filled with one colour of paint -
// worn a little by the nap of the cloth - and what comes back is an ordinary
// sprite: it sorts under the cards, costs one instance a frame, and can be
// moved, faded or removed.

/** The paints a casino layout is printed in. Any CSS colour will do as well. */
export const FELT_INKS = {
  white: '#f3efe2',
  cream: '#e9dcb4',
  yellow: '#f2c230',
  gold: '#d4a93c',
  red: '#d2302c',
  black: '#141414',
  blue: '#2a63b8',
  green: '#2f8f4e',
} as const;

export type FeltInk = keyof typeof FELT_INKS;

export interface FeltPaintOptions extends Omit<SpriteOptions, 'width' | 'height' | 'tint'> {
  /**
   * The paint: one of `FELT_INKS` by name, or any CSS colour. Default white.
   * An image, an SVG document or a drawing given no colour keeps its own.
   */
  color?: FeltInk | (string & {});
  /** 0-1: how worn by the nap of the cloth it is. Default 0.25. */
  wear?: number;
}

/** Words. One line, or several split by `\n`, or one bent round a circle. */
export interface TextMark {
  text: string;
  font?: string;
  /** In board units. Default 14. */
  size?: number;
  weight?: string | number;
  /** Extra room between letters, in ems. Default 0. */
  spacing?: number;
  /** Between lines, in ems. Default 1.25. */
  lineHeight?: number;
  /**
   * Bends the words round a circle of this radius: positive and they run
   * over the top of it, as round the far edge of a table; negative and
   * they run round its bottom, the right way up.
   */
  arc?: number;
  /** Outlined letters, a line this wide, rather than solid ones. */
  stroke?: number;
}

/** SVG path data - one path or several - drawn from a viewBox. */
export interface PathMark {
  path: string | readonly string[];
  /** `[width, height]` or `[minX, minY, width, height]`, as in SVG. */
  viewBox: readonly number[];
  /** Its size on the board. Default the viewBox's; one alone keeps its shape. */
  width?: number;
  height?: number;
  /** Draw it as a line this wide (board units) rather than filling it. */
  stroke?: number;
}

/** A plain outline: a box (rounded with `radius`), an ellipse or a line. */
export interface ShapeMark {
  shape: 'rect' | 'ellipse' | 'line';
  width: number;
  /** Not for a line, which runs `width` across. */
  height?: number;
  radius?: number;
  /** The line's width, board units. Default 1.5. 0 fills the shape. */
  stroke?: number;
  dash?: readonly number[];
}

/** A picture - a loaded SVG, an image - whose shape is its opaque part. */
export interface ImageMark {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Names it in the atlas, so marks of one image share one picture. */
  key?: string;
}

/** Anything else: draw it in board units. In its own colours, or its shape in `color`. */
export interface DrawMark {
  draw(pen: CanvasRenderingContext2D, width: number, height: number): void;
  width: number;
  height: number;
  key?: string;
}

export type Mark = TextMark | PathMark | ShapeMark | ImageMark | DrawMark;

/** The board sprite a mark of paint is. Under the cards unless given a depth. */
export class FeltPaint extends Sprite {}

/**
 * Paints a mark onto a board's felt.
 *
 *     paintFelt(board, { text: 'DEALER STANDS ON 17', arc: 300 }, { x: 240, y: 200, color: 'yellow' });
 *     paintFelt(board, { shape: 'rect', width: 80, height: 110, radius: 8 }, { x, y });
 *     paintFelt(board, { path: SCROLL, viewBox: [64, 64], width: 40, stroke: 1.5 }, { color: 'gold' });
 */
export function paintFelt(board: Board, mark: Mark, options: FeltPaintOptions = {}): FeltPaint {
  const { color, wear = 0.25, ...place } = options;
  const ink = color === undefined ? ('image' in mark || 'draw' in mark ? undefined : FELT_INKS.white)
    : (FELT_INKS as Record<string, string>)[color] ?? color;
  const sprite = new FeltPaint(board, undefined, { depth: -1, ...place }, true);
  const font = 'text' in mark ? fontOf(mark) : undefined;
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  const make = () => {
    const shape = layout(mark);
    const pad = 2;
    const width = shape.width + pad * 2;
    const height = shape.height + pad * 2;
    // Never larger than a page of the atlas: a mark the size of the table is
    // painted a little softer rather than not at all.
    const ratio = Math.min(board.pixelRatio, (board.atlas.size - 8) / Math.max(width, height));
    const key = `felt:${keyOf(mark)}:${ink}:${wear}:${ratio}:${font && fonts ? fonts.check(font) : ''}`;
    const region = board.atlas.obtain(key, Math.ceil(width * ratio), Math.ceil(height * ratio),
      (pen, w, h) => fill(pen as CanvasRenderingContext2D, w, h, ink, wear, (mask) => {
        mask.scale(ratio, ratio);
        mask.translate(pad, pad);
        shape.draw(mask);
      }));
    const old = sprite.region;
    sprite.region = region;
    sprite.setDisplaySize(width, height);
    // Words are placed by the middle of their line, wherever it bends.
    if (shape.anchor && place.originX === undefined && place.originY === undefined) {
      sprite.setOrigin((pad + shape.anchor.x) / width, (pad + shape.anchor.y) / height);
    }
    board.atlas.release(old);
  };
  make();
  // Words in a font still loading are measured and painted again once it is
  // in: the fallback's letters are a different width.
  if (font && fonts && !fonts.check(font)) {
    void fonts.load(font).then(() => { if (!sprite.isDestroyed) make(); }, () => {});
  }
  return sprite;
}

/** An SVG's markup as an image, for an `{ image }` mark. */
export async function loadSvg(markup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Paints a whole SVG document, once it has loaded: in its own colours, or
 * all in `color` if one is given.
 */
export async function paintFeltSvg(board: Board, markup: string,
  mark: { width: number; height: number }, options: FeltPaintOptions = {}): Promise<FeltPaint> {
  const image = await loadSvg(markup);
  return paintFelt(board, { image, ...mark, key: `svg-${hashOf(markup)}` }, options);
}

// --- shapes --------------------------------------------------------------

interface Shape {
  width: number;
  height: number;
  /** The point its x, y names, from its top-left, if not its middle. */
  anchor?: { x: number; y: number };
  /** Draws it, opaque, in board units, from its top-left. */
  draw(pen: CanvasRenderingContext2D): void;
}

function fontOf(mark: TextMark): string {
  return `${mark.weight ?? 'normal'} ${mark.size ?? 14}px ${mark.font ?? 'serif'}`;
}

let measurePen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | undefined;

function layout(mark: Mark): Shape {
  if ('text' in mark) return words(mark);
  if ('path' in mark) {
    const [minX, minY, vw, vh] = mark.viewBox.length >= 4 ? mark.viewBox : [0, 0, ...mark.viewBox];
    const sx = (mark.width ?? (mark.height ? (mark.height * vw) / vh : vw)) / vw;
    const sy = (mark.height ?? vh * sx) / vh;
    const paths = typeof mark.path === 'string' ? [mark.path] : mark.path;
    return {
      width: vw * sx,
      height: vh * sy,
      draw(pen) {
        pen.scale(sx, sy);
        pen.translate(-minX, -minY);
        for (const d of paths) {
          const path = new Path2D(d);
          if (mark.stroke) {
            pen.lineWidth = mark.stroke / Math.min(sx, sy);
            pen.lineCap = 'round';
            pen.lineJoin = 'round';
            pen.stroke(path);
          } else {
            pen.fill(path);
          }
        }
      },
    };
  }
  if ('shape' in mark) {
    const stroke = mark.stroke ?? 1.5;
    const height = mark.shape === 'line' ? stroke : mark.height ?? mark.width;
    return {
      width: mark.width,
      height,
      draw(pen) {
        const inset = stroke / 2;
        pen.lineWidth = stroke;
        pen.lineCap = 'round';
        pen.setLineDash(mark.dash ? [...mark.dash] : []);
        pen.beginPath();
        if (mark.shape === 'line') {
          pen.moveTo(inset, inset);
          pen.lineTo(mark.width - inset, inset);
        } else if (mark.shape === 'ellipse') {
          pen.ellipse(mark.width / 2, height / 2, mark.width / 2 - inset, height / 2 - inset, 0, 0, Math.PI * 2);
        } else {
          pen.roundRect(inset, inset, mark.width - stroke, height - stroke, mark.radius ?? 0);
        }
        if (stroke) pen.stroke(); else pen.fill();
      },
    };
  }
  if ('image' in mark) {
    return { width: mark.width, height: mark.height, draw: (pen) => pen.drawImage(mark.image, 0, 0, mark.width, mark.height) };
  }
  return { width: mark.width, height: mark.height, draw: (pen) => mark.draw(pen, mark.width, mark.height) };
}

/** Letters laid out one by one, along lines or round a circle. */
function words(mark: TextMark): Shape {
  const size = mark.size ?? 14;
  const font = fontOf(mark);
  measurePen ??= scratch(1, 1).getContext('2d') as CanvasRenderingContext2D;
  measurePen.font = font;
  const gap = (mark.spacing ?? 0) * size;
  const advance = (ch: string) => measurePen!.measureText(ch).width;
  const half = size * 0.62;
  interface Glyph { ch: string; x: number; y: number; angle: number; w: number }
  const glyphs: Glyph[] = [];

  if (mark.arc) {
    const line = mark.text.replace(/\n/g, ' ');
    const r = Math.abs(mark.arc);
    const widths = [...line].map(advance);
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
    let s = -total / 2;
    [...line].forEach((ch, i) => {
      const theta = (s + widths[i] / 2) / r;
      s += widths[i] + gap;
      glyphs.push(mark.arc! > 0
        ? { ch, x: r * Math.sin(theta), y: r - r * Math.cos(theta), angle: theta, w: widths[i] }
        : { ch, x: r * Math.sin(theta), y: -r + r * Math.cos(theta), angle: -theta, w: widths[i] });
    });
  } else {
    const step = (mark.lineHeight ?? 1.25) * size;
    const lines = mark.text.split('\n');
    lines.forEach((line, row) => {
      const widths = [...line].map(advance);
      const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
      let x = -total / 2;
      [...line].forEach((ch, i) => {
        glyphs.push({ ch, x: x + widths[i] / 2, y: (row - (lines.length - 1) / 2) * step, angle: 0, w: widths[i] });
        x += widths[i] + gap;
      });
    });
  }

  // The box round every letter's own box, however it is turned.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const g of glyphs) {
    const c = Math.cos(g.angle); const s = Math.sin(g.angle);
    for (const [dx, dy] of [[-g.w / 2, -half], [g.w / 2, -half], [-g.w / 2, half], [g.w / 2, half]]) {
      const px = g.x + dx * c - dy * s;
      const py = g.y + dx * s + dy * c;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  if (!glyphs.length) { minX = minY = 0; maxX = maxY = 1; }
  return {
    width: maxX - minX,
    height: maxY - minY,
    anchor: { x: -minX, y: -minY },
    draw(pen) {
      pen.font = font;
      pen.lineWidth = mark.stroke ?? 0;
      pen.lineJoin = 'round';
      pen.textAlign = 'center';
      pen.textBaseline = 'middle';
      for (const g of glyphs) {
        pen.save();
        pen.translate(g.x - minX, g.y - minY);
        pen.rotate(g.angle);
        if (mark.stroke) pen.strokeText(g.ch, 0, 0); else pen.fillText(g.ch, 0, 0);
        pen.restore();
      }
    },
  };
}

// --- paint ---------------------------------------------------------------

function scratch(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}

/**
 * Draws the shape, fills it with the ink (or keeps its own colours), and
 * wears it: a scatter of specks of felt showing through, always the same
 * for one size so a repaint matches.
 */
function fill(pen: CanvasRenderingContext2D, w: number, h: number, ink: string | undefined, wear: number,
  draw: (mask: CanvasRenderingContext2D) => void): void {
  const out = scratch(w, h);
  const o = out.getContext('2d') as CanvasRenderingContext2D;
  o.fillStyle = o.strokeStyle = '#000';
  draw(o);
  o.setTransform(1, 0, 0, 1, 0, 0);
  if (ink) {
    o.globalCompositeOperation = 'source-in';
    o.fillStyle = ink;
    o.fillRect(0, 0, w, h);
  }
  if (wear > 0) {
    o.globalCompositeOperation = 'destination-out';
    o.fillStyle = '#000';
    let seed = 7;
    const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0, n = (w * h) / 6; i < n; i++) {
      o.globalAlpha = next() * wear;
      o.fillRect(next() * w, next() * h, 1, 1);
    }
  }
  pen.drawImage(out, 0, 0);
}

// --- keys ----------------------------------------------------------------

let anonymous = 0;
const serials = new WeakMap<object, number>();

/** What a mark is, as text, for its atlas key. Pictures and painters by identity. */
function keyOf(mark: Mark): string {
  if ('image' in mark || 'draw' in mark) {
    if (mark.key) return mark.key;
    const id = 'image' in mark ? mark.image as object : mark.draw;
    if (!serials.has(id)) serials.set(id, ++anonymous);
    return `${'image' in mark ? 'image' : 'draw'}-${serials.get(id)}-${mark.width}x${mark.height}`;
  }
  return hashOf(JSON.stringify(mark));
}

function hashOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(36)}-${text.length}`;
}
