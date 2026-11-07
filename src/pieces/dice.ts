import { Mat3, Vec3, apply3, mul3 } from '../gl/lens.js';
import { seeded } from '../core/shuffle.js';

// Dice, as numbers.
//
// A roll is decided before anything moves: by a value the game already has
// (from its server, its Simulation's Rng, a replay) or from a seed. The
// tumble is worked out *backwards* from that result - the die's resting
// orientation is the one with the rolled face up, and every moment of the
// tumble is that orientation with a decreasing amount of roll still to come
// - so it cannot land on anything else, and two screens shown the same roll
// show the same number whatever their frame rates.

/** Which way each face points on a die lying with 1 up, and 2 facing the top of the board. */
const NORMALS: Record<number, Vec3> = {
  1: [0, 0, 1], 6: [0, 0, -1],
  2: [0, -1, 0], 5: [0, 1, 0],
  3: [1, 0, 0], 4: [-1, 0, 0],
};

const rx = (t: number): Mat3 => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const ry = (t: number): Mat3 => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const rz = (t: number): Mat3 => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** The turn that brings face `f` to the top, its top edge to the top of the board. */
const UPRIGHT: Record<number, Mat3> = {
  1: rx(0), 6: rx(Math.PI), 2: rx(-Math.PI / 2), 5: rx(Math.PI / 2), 3: ry(-Math.PI / 2), 4: ry(Math.PI / 2),
};

/** The faces of a d6. */
export const DIE_FACES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Face `f`'s own frame on the die - its picture's x and y and its outward
 * normal, as columns - so the face drawn as a flat card sits on the cube.
 */
export function faceFrame(face: number): Mat3 {
  return transpose(UPRIGHT[face]);
}

/** Lying flat with `face` up, turned `yaw` radians in the plane of the table. */
export function dieOrientation(face: number, yaw = 0): Mat3 {
  if (!UPRIGHT[face]) throw new Error(`felt dice: no face ${face} on a d6`);
  return mul3(rz(yaw), UPRIGHT[face]);
}

/** The face pointing most nearly up, for a die in this orientation. */
export function topFace(rotation: Mat3): number {
  let best = 1;
  let bestZ = -Infinity;
  for (const face of DIE_FACES) {
    const z = apply3(rotation, NORMALS[face])[2];
    if (z > bestZ) { bestZ = z; best = face; }
  }
  return best;
}

/** Which way a face points, for a die in this orientation. */
export function faceNormal(rotation: Mat3, face: number): Vec3 {
  return apply3(rotation, NORMALS[face]);
}

/**
 * A rotation as the three angles a card is posed by - `angle` (radians, in
 * the plane), `tilt` and `turn` - so that `cardRotation(angle, tilt, turn)`
 * is it again. How a die's face, which is drawn as a card, is set on the cube.
 */
export function cardPose(m: Mat3): { angle: number; tilt: number; turn: number } {
  // M = Rz(a) Rx(t) Ry(u): row 2 is (-cos t sin u, sin t, cos t cos u),
  // column 1 is (-sin a cos t, cos a cos t, sin t).
  const tilt = Math.asin(Math.max(-1, Math.min(1, m[7])));
  const ct = Math.cos(tilt);
  if (Math.abs(ct) < 1e-9) {
    // Edge-on to the table: the turn and the angle are the same axis, give it all to the angle.
    return { angle: Math.atan2(m[3], m[0]), tilt, turn: 0 };
  }
  return { angle: Math.atan2(-m[1], m[4]), tilt, turn: Math.atan2(-m[6], m[8]) };
}

/** A rotation of `angle` radians about an axis through the origin (any length). */
export function axisRotation(axis: Vec3, angle: number): Mat3 {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const [x, y, z] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/**
 * Rolls `count` dice of `sides` from a seed: the same seed, the same roll,
 * everywhere. A game with a Simulation passes its `rng.next` instead.
 */
export function rollDice(seed: number | (() => number), count = 1, sides = 6): number[] {
  const random = typeof seed === 'function' ? seed : seeded(seed);
  return Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
}

/** One moment of a tumble. */
export interface DiePose {
  x: number;
  y: number;
  /** Height of the die's centre above the felt. A die at rest: half its size. */
  z: number;
  rotation: Mat3;
}

export interface TumbleOptions {
  /** Where it starts: the hand it leaves. */
  from: { x: number; y: number };
  /** Where it comes to rest. */
  to: { x: number; y: number };
  /** The face it lands on. Decided already: this only shows it. */
  face: number;
  /** Its edge, in board units. Default 34. */
  size?: number;
  /** Picks the tumble (not the result): its spin, its bounces, its last angle. */
  seed?: number;
  /** The angle it settles at, in degrees. Default a little off square, from the seed. */
  yaw?: number;
  /** How it starts. Default a die lying flat with 1 up. */
  start?: Mat3;
  /** Milliseconds. Default from the distance. */
  duration?: number;
  /** How high the first bounce goes, board units. Default from the distance. */
  height?: number;
}

export interface Tumble {
  duration: number;
  /** Where the die is at `t`, 0-1 of the duration. At 1, exactly at rest on its face. */
  at(t: number): DiePose;
}

const easeOut = (t: number, p = 3) => 1 - (1 - t) ** p;

/**
 * A die thrown from one place to another, landing on a given face.
 *
 * It travels fast and slows, bounces a few times lower each time, and rolls
 * over in the direction it is going with a little twist about the others.
 * The orientation at every moment is the resting one with some of the roll
 * still to come, so whatever the seed, `at(1)` is lying on `face`; the
 * height is always enough to keep its lowest corner on or above the felt.
 */
export function dieTumble(options: TumbleOptions): Tumble {
  const size = options.size ?? 34;
  const random = seeded(options.seed ?? 1);
  const { from, to } = options;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const heading = distance > 1e-6 ? Math.atan2(dy, dx) : random() * Math.PI * 2;
  const dir: Vec3 = [Math.cos(heading), Math.sin(heading), 0];
  const duration = options.duration ?? Math.min(1500, 700 + distance * 1.6);
  const yaw = options.yaw !== undefined ? (options.yaw * Math.PI) / 180 : (random() - 0.5) * 0.6;
  const rest = dieOrientation(options.face, yaw);
  // Rolling forward is a turn about the line across the way it goes; a
  // die rolls on its edges, so about a quarter turn for each edge it goes
  // over, and a little over a whole number of them.
  const rollAxis: Vec3 = [-dir[1], dir[0], 0];
  const roll = Math.max(1.5, distance / (size * 0.62)) * (Math.PI / 2) * (0.85 + random() * 0.3);
  // And it twists: about the way it goes, and about the up axis.
  const twist = (random() - 0.5) * Math.PI * 1.4;
  const spin = (random() - 0.5) * Math.PI * 2.2;
  const height = options.height ?? Math.min(70, 18 + distance * 0.18);
  // Three bounces, each lower and shorter, then it rolls the rest of the way.
  const hops = [0.34, 0.22, 0.14].map((len, i) => ({ len, h: height * [1, 0.42, 0.16][i] }));
  let s = 0;
  const bounces = hops.map((hop) => { const b = { start: s, ...hop }; s += hop.len; return b; });
  const start = options.start;

  const at = (t: number): DiePose => {
    const k = Math.max(0, Math.min(1, t));
    const e = easeOut(k, 2.2);
    const left = 1 - easeOut(k, 2.6);
    let rotation = mul3(axisRotation(rollAxis, -roll * left),
      mul3(axisRotation(dir, twist * left * left), mul3(rz(spin * left), rest)));
    // A die handed a starting orientation leaves the hand from it.
    if (start && k < 0.12) rotation = blend(start, rotation, k / 0.12);
    let hop = 0;
    for (const b of bounces) {
      if (k >= b.start && k < b.start + b.len) hop = b.h * Math.sin(Math.PI * (k - b.start) / b.len);
    }
    // It is thrown from the hand: the first hop starts in the air.
    if (k < bounces[0].len / 2) hop = height;
    // Its lowest corner on the felt, however it is turned.
    const reach = (size / 2) * (Math.abs(rotation[6]) + Math.abs(rotation[7]) + Math.abs(rotation[8]));
    return {
      x: from.x + dx * e,
      y: from.y + dy * e,
      z: reach + hop,
      rotation: k >= 1 ? rest : rotation,
    };
  };
  return { duration, at };
}

/**
 * Between two orientations, near enough: mixed and squared up again. For
 * the first moment of a throw only, where it is invisible that this is not
 * a true slerp.
 */
function blend(a: Mat3, b: Mat3, t: number): Mat3 {
  const m = a.map((v, i) => v + (b[i] - v) * t) as Mat3;
  return orthonormal(m);
}

/** Gram-Schmidt on the columns. */
function orthonormal(m: Mat3): Mat3 {
  const col = (i: number): Vec3 => [m[i], m[3 + i], m[6 + i]];
  const norm = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const x = norm(col(0));
  let y = col(1);
  const d = dot(x, y);
  y = norm([y[0] - d * x[0], y[1] - d * x[1], y[2] - d * x[2]]);
  const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}
