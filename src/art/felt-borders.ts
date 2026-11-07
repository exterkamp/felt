import type { Board } from '../scene/board.js';
import { type FeltPaint, type FeltPaintOptions, type PathMark, paintFelt } from './felt-paint.js';

// Running borders for the felt: the classic bands of ornament - Greek key,
// Vitruvian scroll, rope, bead and reel and the rest - generated as path data
// rather than copied from anyone's drawing, so they need no artwork and carry
// no licence. Each is a repeat fitted a whole number of times to the length
// asked for, as a stroked PathMark for `paintFelt`.

/** The border patterns, by name. */
export const BORDER_PATTERNS = [
  'greek-key', 'running-dog', 'rope', 'bead-and-reel', 'dentil', 'chevron', 'scallop', 'interlace', 'guilloche',
] as const;
export type BorderPattern = (typeof BORDER_PATTERNS)[number];

export interface BorderOptions {
  /** Its length along the band, in board units. */
  length: number;
  /** Its depth across the band. Default 16. */
  height?: number;
  /** Its line width. Default 1.4. */
  stroke?: number;
}

/** A repeat, drawn in a `w` x `h` box at `x`. */
type Unit = (x: number, w: number, h: number) => string;
interface Pattern {
  /** A repeat's natural width, as a fraction of the band's height. */
  aspect: number;
  unit: Unit;
  /** Each repeat carries on from where the last ended: one line the band's length. */
  joined?: boolean;
  /** How far a repeat reaches past its box at either end, as a fraction of the height. */
  overhang?: number;
  /** Lines the length of the band: its rails. */
  rails?: (length: number, h: number) => string[];
}

const n = (v: number) => +v.toFixed(2);
const rails = (...at: number[]) => (length: number, h: number) => at.map((y) => `M0 ${n(y * h)}H${n(length)}`);
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0`;

const PATTERNS: Record<BorderPattern, Pattern> = {
  // One line winding into every key and back out without crossing itself.
  'greek-key': {
    aspect: 10 / 12,
    joined: true,
    rails: rails(0, 1),
    unit(x, w, h) {
      const X = (g: number) => n(x + (g / 10) * w);
      const Y = (g: number) => n((g / 12) * h);
      return `M${X(0)} ${Y(10)}V${Y(2)}H${X(8)}V${Y(8)}H${X(4)}V${Y(6)}H${X(6)}V${Y(4)}H${X(2)}V${Y(10)}H${X(10)}`;
    },
  },
  // The Vitruvian scroll: waves rising off the line and breaking forward
  // into a curl.
  'running-dog': {
    aspect: 1.2,
    rails: rails(0.94),
    unit(x, w, h) {
      const cx = x + w * 0.56;
      const cy = h * 0.47;
      // From the foot of the wave on the line, round and in.
      const fx = x - cx;
      const fy = h * 0.94 - cy;
      const start = Math.atan2(fy, fx);
      const r0 = Math.hypot(fx, fy);
      const turn = Math.PI * 3.1;
      let d = '';
      for (let a = 0; a <= turn; a += 0.1) {
        const r = r0 * Math.exp(-a / 3.1);
        d += `${d ? 'L' : 'M'}${n(cx + r * Math.cos(start + a))} ${n(cy + r * Math.sin(start + a))}`;
      }
      return d;
    },
  },
  // Twisted strands between two rails.
  rope: {
    aspect: 0.8,
    rails: rails(0, 1),
    unit(x, w, h) {
      return `M${n(x)} ${n(h)}C${n(x + w * 0.1)} ${n(h * 0.3)} ${n(x + w * 0.6)} 0 ${n(x + w)} 0`;
    },
  },
  // Beads, then reels on their sides.
  'bead-and-reel': {
    aspect: 1.5,
    unit(x, w, h) {
      return [ellipse(x + w * 0.3, h / 2, h * 0.32, h * 0.32), ellipse(x + w * 0.78, h / 2, w * 0.13, h * 0.16)].join('');
    },
  },
  // A rail over a row of square-cut teeth.
  dentil: {
    aspect: 0.8,
    rails: rails(0),
    unit(x, w, h) {
      return `M${n(x + w * 0.15)} ${n(h * 0.25)}H${n(x + w * 0.85)}V${n(h)}H${n(x + w * 0.15)}Z`;
    },
  },
  // Two zigzags, one inside the other.
  chevron: {
    aspect: 1,
    rails: rails(0, 1),
    unit(x, w, h) {
      return [0.1, 0.5].map((y) => `M${n(x)} ${n(h * (y + 0.4))}L${n(x + w / 2)} ${n(h * y)}L${n(x + w)} ${n(h * (y + 0.4))}`).join('');
    },
  },
  // Shells along the edge, a pearl in each.
  scallop: {
    aspect: 1.6,
    rails: rails(1),
    unit(x, w, h) {
      const r = w / 2;
      const ry = h * 0.85;
      return `M${n(x)} ${n(h)}A${n(r)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(h)}`
        + `M${n(x + w * 0.2)} ${n(h)}A${n(r * 0.6)} ${n(ry * 0.6)} 0 0 1 ${n(x + w * 0.8)} ${n(h)}`
        + ellipse(x + w / 2, h * 0.78, h * 0.08, h * 0.08);
    },
  },
  // A chain of rings, each through the next.
  interlace: {
    aspect: 0.62,
    overhang: 0.46 - 0.31,
    unit(x, w, h) {
      return ellipse(x + w / 2, h / 2, h * 0.46, h * 0.46);
    },
  },
  // Guilloché: four strands of one wave a quarter out of step, woven.
  guilloche: {
    aspect: 2,
    unit(x, w, h) {
      return [0, 1, 2, 3].map((k) => {
        let d = '';
        for (let s = 0; s <= 24; s++) {
          const px = x + (s / 24) * w;
          const py = h / 2 + h * 0.42 * Math.sin((s / 24) * Math.PI * 2 + (k * Math.PI) / 2);
          d += `${d ? 'L' : 'M'}${n(px)} ${n(py)}`;
        }
        return d;
      }).join('');
    },
  },
};

/**
 * A running border `length` long: a whole number of repeats of a pattern,
 * stretched a little to fit, as a stroked mark to paint. It runs along x,
 * its outside edge at the top.
 *
 *     paintFelt(board, border('greek-key', { length: 420 }), { x: 240, y: 20, color: 'gold' });
 */
export function border(pattern: BorderPattern, options: BorderOptions): PathMark {
  const { length, height = 16, stroke = 1.4 } = options;
  const p = PATTERNS[pattern];
  const over = (p.overhang ?? 0) * height;
  const run = Math.max(length - over * 2, height * p.aspect);
  const count = Math.max(1, Math.round(run / (height * p.aspect)));
  const w = run / count;
  let units = Array.from({ length: count }, (_, i) => p.unit(over + i * w, w, height));
  if (p.joined) units = [units.map((d, i) => (i ? `L${d.slice(1)}` : d)).join('')];
  // Strokes can run a little past the box; the viewBox leaves them room.
  const m = stroke;
  return {
    path: [...(p.rails?.(length, height) ?? []), ...units],
    viewBox: [-m, -m, length + 2 * m, height + 2 * m],
    width: length + 2 * m,
    height: height + 2 * m,
    stroke,
  };
}

export interface FrameOptions extends Omit<FeltPaintOptions, 'x' | 'y' | 'angle'> {
  /** The frame's middle. */
  x: number;
  y: number;
  /** Its outside size. */
  width: number;
  height: number;
  /** The band's depth. Default 16. */
  depth?: number;
  stroke?: number;
  /** What fills the corners: a square with a diamond in it, or nothing. Default 'block'. */
  corner?: 'block' | 'none';
}

/**
 * Paints a border round a rectangle: a band down each side, outside edge
 * outwards, and a block in each corner where they meet.
 *
 *     paintFeltFrame(board, 'greek-key', { x: 240, y: 360, width: 464, height: 704, color: 'gold' });
 */
export function paintFeltFrame(board: Board, pattern: BorderPattern, options: FrameOptions): FeltPaint[] {
  const { x, y, width, height, depth: band = 16, stroke = 1.4, corner = 'block', ...paint } = options;
  const marks: FeltPaint[] = [];
  const half = band / 2;
  const gap = corner === 'block' ? band + stroke * 2 : 0;
  const sides = [
    { length: width - gap * 2, x, y: y - height / 2 + half, angle: 0 },
    { length: height - gap * 2, x: x + width / 2 - half, y, angle: 90 },
    { length: width - gap * 2, x, y: y + height / 2 - half, angle: 180 },
    { length: height - gap * 2, x: x - width / 2 + half, y, angle: 270 },
  ];
  for (const side of sides) {
    if (side.length <= 0) continue;
    marks.push(paintFelt(board, border(pattern, { length: side.length, height: band, stroke }),
      { ...paint, x: side.x, y: side.y, angle: side.angle }));
  }
  if (corner === 'block') {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const at = { ...paint, x: x + sx * (width / 2 - half), y: y + sy * (height / 2 - half) };
      marks.push(paintFelt(board, { shape: 'rect', width: band, height: band, stroke }, at));
      marks.push(paintFelt(board, { shape: 'rect', width: band * 0.42, height: band * 0.42, stroke: 0 },
        { ...at, angle: 45 }));
    }
  }
  return marks;
}
