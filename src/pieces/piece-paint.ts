import { CARD_INDEX_FONT, DISPLAY_FONT } from '../core/fonts.js';
import { seeded } from '../core/shuffle.js';
import type { Board } from '../scene/board.js';
import { type Denomination, chipLabel } from './chips.js';
import type { PegTrack } from './pegging.js';
import { PieceArt, type PieceLook } from './piece.js';

// What the pieces look like: Canvas 2D, once per look, into the atlas.
//
// Each function here answers a `PieceLook` - the counted region and the
// shape round it - for a key that says everything the picture depends on,
// so a hundred green chips are one green chip painted once.

type Pen = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

/** 0xrrggbb from a CSS hex colour. */
export function hexColor(css: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return 0x222222;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return Number.parseInt(hex, 16);
}

/** The colour darkened (k < 1) or lightened (k > 1), as 0xrrggbb. */
function shade(css: string, k: number): number {
  const n = hexColor(css);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1))));
  return (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
}

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** A ring sector, the shape an edge spot is. */
function sector(pen: Pen, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): void {
  pen.beginPath();
  pen.arc(cx, cy, r1, a0, a1);
  pen.arc(cx, cy, r0, a1, a0, true);
  pen.closePath();
}

/** Words fitted to a width, in a font that may still be loading. */
function fitText(pen: Pen, text: string, x: number, y: number, maxWidth: number, size: number,
  family: string, weight = '700'): void {
  let s = size;
  pen.font = `${weight} ${s}px ${family}`;
  const w = pen.measureText(text).width;
  if (w > maxWidth) { s *= maxWidth / w; pen.font = `${weight} ${s}px ${family}`; }
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  // Most faces sit a little high on 'middle'; a nudge centres the digits.
  pen.fillText(text, x, y + s * 0.04);
}

// --- chips -------------------------------------------------------------------

/** The face of a chip: edge spots, a ring, a cream inlay with its value. */
export function paintChip(pen: Pen, d: number, denom: Denomination): void {
  const r = d / 2;
  const c = r;
  // The body, a touch darker round the rim, where it curves away.
  const body = pen.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
  body.addColorStop(0, css(shade(denom.color, 1.08)));
  body.addColorStop(0.75, denom.color);
  body.addColorStop(1, css(shade(denom.color, 0.78)));
  pen.fillStyle = body;
  pen.beginPath();
  pen.arc(c, c, r, 0, TAU);
  pen.fill();
  // Six edge spots, each split by a hairline of the body colour.
  pen.fillStyle = denom.spot;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    const half = (TAU / 6) * 0.2;
    sector(pen, c, c, r * 0.74, r * 1.01, a - half, a + half);
    pen.fill();
  }
  pen.strokeStyle = denom.color;
  pen.lineWidth = Math.max(0.35, r * 0.035);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    pen.beginPath();
    pen.moveTo(c + Math.cos(a) * r * 0.74, c + Math.sin(a) * r * 0.74);
    pen.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    pen.stroke();
  }
  // A dashed ring inside the spots.
  pen.strokeStyle = denom.spot;
  pen.lineWidth = r * 0.045;
  pen.setLineDash([r * 0.09, r * 0.07]);
  pen.beginPath();
  pen.arc(c, c, r * 0.66, 0, TAU);
  pen.stroke();
  pen.setLineDash([]);
  // The inlay, and its value.
  pen.fillStyle = '#f6f1e3';
  pen.beginPath();
  pen.arc(c, c, r * 0.54, 0, TAU);
  pen.fill();
  pen.strokeStyle = denom.ink ?? denom.color;
  pen.lineWidth = r * 0.04;
  pen.beginPath();
  pen.arc(c, c, r * 0.47, 0, TAU);
  pen.stroke();
  pen.fillStyle = denom.ink ?? denom.color;
  const label = denom.label ?? chipLabel(denom.value);
  fitText(pen, label, c, c, r * 0.78, r * (label.length > 3 ? 0.5 : 0.6), CARD_INDEX_FONT);
}

/** A chip's look, painted once per denomination and size. */
export function chipLook(board: Board, denom: Denomination, diameter: number): PieceLook {
  const key = `chip:${denom.value}:${denom.color}:${denom.spot}:${denom.ink ?? ''}:${denom.label ?? ''}:${diameter}`;
  const face = PieceArt.of(board).region(key, diameter, diameter, (pen) => paintChip(pen, diameter, denom),
    `700 12px ${CARD_INDEX_FONT}`);
  return { face, width: diameter, height: diameter, edge: shade(denom.color, 0.45), edgeWidth: 0.7 };
}

// --- tokens ------------------------------------------------------------------

export interface TokenStyle {
  /** What it says: `D`, `SB`, `PASS`. Or nothing, for a plain player marker. */
  label?: string;
  /** Its body. Default white. */
  color?: string;
  /** The words, and a ring inside the rim. Default near black. */
  ink?: string;
  /** Width and height. Default 34 round; a label of three letters or more makes a pill. */
  width?: number;
  height?: number;
  /** Of the corners; half the height is a pill or a disc. */
  radius?: number;
  /** Words in this font. Default the display face. */
  font?: string;
}

/** A dealer button, a blind, a marker in a player's colour. */
export function paintToken(pen: Pen, w: number, h: number, style: Required<Omit<TokenStyle, 'label'>> & { label?: string }): void {
  const r = Math.min(style.radius, w / 2, h / 2);
  const shapePath = (inset: number) => {
    pen.beginPath();
    pen.roundRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
  };
  const body = pen.createLinearGradient(0, 0, w * 0.3, h);
  body.addColorStop(0, css(shade(style.color, 1.12)));
  body.addColorStop(1, css(shade(style.color, 0.85)));
  pen.fillStyle = body;
  shapePath(0);
  pen.fill();
  pen.strokeStyle = style.ink;
  pen.globalAlpha = 0.85;
  pen.lineWidth = Math.max(0.8, h * 0.04);
  shapePath(h * 0.1);
  pen.stroke();
  pen.globalAlpha = 1;
  if (style.label) {
    pen.fillStyle = style.ink;
    fitText(pen, style.label, w / 2, h / 2, w - h * 0.42, h * (style.label.length === 1 ? 0.56 : 0.4), style.font);
  }
}

export function tokenLook(board: Board, style: TokenStyle = {}): PieceLook {
  const label = style.label;
  const long = (label?.length ?? 0) >= 3;
  const height = style.height ?? 34;
  const width = style.width ?? (long ? Math.max(height, height * 0.42 * (label!.length + 1.4)) : height);
  const full = {
    label, color: style.color ?? '#f7f4ec', ink: style.ink ?? '#1b1b1b',
    width, height, radius: style.radius ?? height / 2, font: style.font ?? DISPLAY_FONT,
  };
  const key = `token:${label ?? ''}:${full.color}:${full.ink}:${width}x${height}:${full.radius}:${full.font}`;
  const face = PieceArt.of(board).region(key, width, height, (pen) => paintToken(pen, width, height, full),
    label ? `700 12px ${full.font}` : undefined);
  return { face, width, height, radius: full.radius, edge: shade(full.color, 0.5), edgeWidth: 0.7 };
}

// --- dice --------------------------------------------------------------------

export interface DieStyle {
  /** The body. Default ivory. */
  color?: string;
  /** The pips. Default near black. */
  pip?: string;
  /** The ace, if it is a different colour (Asian dice have a red one). Default the pips'. */
  ace?: string;
  /** Pips, or the numbers printed. Default pips. */
  faces?: 'pips' | 'numbers';
}

/** Ivory with black pips. */
export const IVORY_DICE: DieStyle = { color: '#f4efe2', pip: '#1d1d1d', ace: '#b8222b' };
/** The casino's: red, white pips. */
export const CASINO_DICE: DieStyle = { color: '#c3202a', pip: '#fbf7ee' };

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

/** One face of a die. */
export function paintDieFace(pen: Pen, s: number, face: number, style: DieStyle): void {
  const color = style.color ?? IVORY_DICE.color!;
  const body = pen.createRadialGradient(s * 0.4, s * 0.38, s * 0.1, s / 2, s / 2, s * 0.75);
  body.addColorStop(0, css(shade(color, 1.06)));
  body.addColorStop(1, css(shade(color, 0.82)));
  pen.fillStyle = body;
  pen.fillRect(0, 0, s, s);
  const pip = style.pip ?? IVORY_DICE.pip!;
  if (style.faces === 'numbers') {
    pen.fillStyle = pip;
    fitText(pen, String(face), s / 2, s / 2, s * 0.7, s * 0.62, CARD_INDEX_FONT);
    return;
  }
  const r = s * (face === 1 && style.ace ? 0.13 : 0.085);
  for (const [u, v] of PIPS[face] ?? []) {
    // Drilled: dark in the hole, with a rim of light on its lower edge.
    pen.fillStyle = face === 1 && style.ace ? style.ace : pip;
    pen.beginPath();
    pen.arc(u * s, v * s, r, 0, TAU);
    pen.fill();
    pen.strokeStyle = 'rgba(255,255,255,0.35)';
    pen.lineWidth = r * 0.25;
    pen.beginPath();
    pen.arc(u * s, v * s, r * 0.92, Math.PI * 0.15, Math.PI * 0.85);
    pen.stroke();
  }
}

export function dieFaceLook(board: Board, face: number, size: number, style: DieStyle = IVORY_DICE): PieceLook {
  const key = `die:${face}:${size}:${style.color ?? ''}:${style.pip ?? ''}:${style.ace ?? ''}:${style.faces ?? 'pips'}`;
  const region = PieceArt.of(board).region(key, size, size, (pen) => paintDieFace(pen, size, face, style),
    style.faces === 'numbers' ? `700 12px ${CARD_INDEX_FONT}` : undefined);
  return {
    face: region, width: size, height: size, radius: size * 0.16,
    edge: shade(style.color ?? IVORY_DICE.color!, 0.62), edgeWidth: Math.max(0.6, size * 0.025), shadow: 0,
  };
}

// --- the peg board -------------------------------------------------------------

/** A peg's head, from above. */
export function paintPeg(pen: Pen, d: number, color: string): void {
  const r = d / 2;
  const g = pen.createRadialGradient(r * 0.7, r * 0.65, r * 0.05, r, r, r);
  g.addColorStop(0, css(shade(color, 1.45)));
  g.addColorStop(0.45, color);
  g.addColorStop(1, css(shade(color, 0.6)));
  pen.fillStyle = g;
  pen.beginPath();
  pen.arc(r, r, r, 0, TAU);
  pen.fill();
}

export function pegLook(board: Board, color: string, diameter: number): PieceLook {
  const face = PieceArt.of(board).region(`peg:${color}:${diameter}`, diameter, diameter,
    (pen) => paintPeg(pen, diameter, color));
  return { face, width: diameter, height: diameter, edge: shade(color, 0.4), edgeWidth: 0.4 };
}

/** The board: wood, a stripe of each player's colour under their lane, the holes. */
export function paintPegBoard(pen: Pen, track: PegTrack, colors: readonly string[], wood: string): void {
  const { width: w, height: h } = track;
  const grain = pen.createLinearGradient(0, 0, 0, h);
  grain.addColorStop(0, css(shade(wood, 1.1)));
  grain.addColorStop(0.5, wood);
  grain.addColorStop(1, css(shade(wood, 0.8)));
  pen.fillStyle = grain;
  pen.fillRect(0, 0, w, h);
  // The grain: long faint streaks, the same on every board.
  const random = seeded(121);
  pen.lineWidth = 0.6;
  for (let i = 0; i < 26; i++) {
    const y = random() * h;
    pen.strokeStyle = `rgba(40, 20, 5, ${0.06 + random() * 0.08})`;
    pen.beginPath();
    pen.moveTo(0, y);
    pen.bezierCurveTo(w * 0.3, y + (random() - 0.5) * 6, w * 0.7, y + (random() - 0.5) * 6, w, y + (random() - 0.5) * 4);
    pen.stroke();
  }
  const cx = w / 2;
  const cy = h / 2;
  const pitch = Math.abs(track.hole(0, 2).x - track.hole(0, 1).x);
  for (let p = 0; p < track.players; p++) {
    const a = track.hole(p, 1);
    const b = track.hole(p, 61);
    const end = track.hole(p, 60);
    const left = track.hole(p, -1).x - pitch;
    pen.fillStyle = colors[p % colors.length];
    pen.globalAlpha = 0.22;
    pen.beginPath();
    pen.roundRect(cx + left, cy + a.y - pitch * 0.85, end.x - left + pitch * 0.9, b.y - a.y + pitch * 1.7, pitch * 0.85);
    pen.fill();
    pen.globalAlpha = 1;
  }
  for (const hole of track.holes()) {
    const big = hole.position === 121;
    const r = pitch * (big ? 0.36 : 0.24);
    const x = cx + hole.x;
    const y = cy + hole.y;
    pen.fillStyle = 'rgba(255, 236, 200, 0.28)';
    pen.beginPath();
    pen.arc(x, y + r * 0.35, r * 1.05, 0, TAU);
    pen.fill();
    pen.fillStyle = '#1a0d04';
    pen.beginPath();
    pen.arc(x, y, r, 0, TAU);
    pen.fill();
  }
  // Every thirtieth hole marked, along the top.
  pen.fillStyle = 'rgba(255, 240, 210, 0.7)';
  for (const n of [30, 60]) {
    const at = track.hole(0, n);
    fitText(pen, String(n), cx + at.x, cy + at.y - pitch * 1.25, 20, pitch * 0.95, CARD_INDEX_FONT, '600');
  }
  const back = track.hole(track.players - 1, 90);
  fitText(pen, '90', cx + back.x, cy + back.y + pitch * 1.25, 20, pitch * 0.95, CARD_INDEX_FONT, '600');
}

export function pegBoardLook(board: Board, track: PegTrack, colors: readonly string[], wood = '#9a6434'): PieceLook {
  const key = `pegboard:${track.players}:${track.width.toFixed(2)}x${track.height.toFixed(2)}:${colors.join(',')}:${wood}`;
  const face = PieceArt.of(board).region(key, track.width, track.height,
    (pen) => paintPegBoard(pen, track, colors, wood), `600 12px ${CARD_INDEX_FONT}`);
  return { face, width: track.width, height: track.height, radius: 8, edge: shade(wood, 0.45), edgeWidth: 0.9 };
}
