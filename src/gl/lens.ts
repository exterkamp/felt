// The camera, as arithmetic.
//
// Board units are the only units: x right, y down, from the top-left of the
// board, and z out of the table towards the viewer. The camera looks straight
// down at the table from `distance` units above it, so anything lying on the
// table (z = 0) is drawn at exactly its own size in board units whatever the
// lens - a flat card game never sees the camera at all, and a card lifted,
// tipped or bent gets real perspective for free.
//
// The point the camera sits over is the *vanishing point*, and there is a
// choice to make about it. A camera over the middle of the board is the true
// picture, and a card tipped near the edge then leans off-axis. A camera over
// each card is what Phaser's meshes did - every bent card was projected
// around its own centre - and it is what a card game usually wants: a card
// tipped in the corner looks exactly like the same card tipped in the middle.
// `localLens` picks between them; the shader and these functions agree.
//
// This file is the only place that projection is written down in TypeScript,
// and the vertex shader is the only other. Picking a card under a finger and
// asking where a tuck box's deck has risen to both come through here, so the
// answer is the same one the screen gives.

export interface Lens {
  /** Distance from the camera to the table, in board units. Infinity is flat. */
  distance: number;
}

/** How far back a camera with this vertical field of view sits over a board. */
export function lensDistance(fovDegrees: number, boardHeight: number): number {
  if (!(fovDegrees > 0)) return Infinity;
  return boardHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
}

/**
 * Where a point in the world lands on the board, seen through the lens.
 *
 * `cx, cy` is the vanishing point. A point on the table lands on itself.
 */
export function project(
  x: number, y: number, z: number, cx: number, cy: number, distance: number,
): { x: number; y: number; w: number } {
  const w = Number.isFinite(distance) ? 1 - z / distance : 1;
  return { x: cx + (x - cx) / w, y: cy + (y - cy) / w, w };
}

export type Vec3 = [number, number, number];
/** A 3x3 rotation, row-major. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * A card's orientation: turned about its own long axis, then tipped about its
 * width, then turned in the plane of the table.
 *
 * In that order because that is how a hand moves a card - flip it over in the
 * fingers, tip it towards you, then put it down at an angle - and the shader
 * builds exactly the same matrix.
 */
export function cardRotation(angleRad: number, tilt: number, turn: number): Mat3 {
  const [ca, sa] = [Math.cos(angleRad), Math.sin(angleRad)];
  const [ct, st] = [Math.cos(tilt), Math.sin(tilt)];
  const [cy, sy] = [Math.cos(turn), Math.sin(turn)];
  // Rz(angle) * Rx(tilt) * Ry(turn)
  const ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rx: Mat3 = [1, 0, 0, 0, ct, -st, 0, st, ct];
  const rz: Mat3 = [ca, -sa, 0, sa, ca, 0, 0, 0, 1];
  return mul3(rz, mul3(rx, ry));
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** The inverse of a rotation, which is its transpose. */
export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/**
 * Where a point on the board, seen through the lens, meets a plane - in the
 * plane's own coordinates.
 *
 * The plane is a card: centred at `origin`, oriented by `rotation`, and its
 * local x and y are what come back. Undefined when the card is edge-on to the
 * ray and there is nothing to hit.
 */
export function unprojectOntoPlane(
  sx: number, sy: number, origin: Vec3, rotation: Mat3,
  cx: number, cy: number, distance: number,
): { x: number; y: number } | undefined {
  // A ray from the camera through the point on the table at (sx, sy).
  const flat = !Number.isFinite(distance);
  const from: Vec3 = flat ? [sx, sy, 1e6] : [cx, cy, distance];
  const dir: Vec3 = flat ? [0, 0, -1] : [sx - cx, sy - cy, -distance];
  const normal = apply3(rotation, [0, 0, 1]);
  const facing = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
  if (Math.abs(facing) < 1e-9) return undefined;
  const t = ((origin[0] - from[0]) * normal[0] + (origin[1] - from[1]) * normal[1]
    + (origin[2] - from[2]) * normal[2]) / facing;
  const hit: Vec3 = [from[0] + dir[0] * t - origin[0], from[1] + dir[1] * t - origin[1],
    from[2] + dir[2] * t - origin[2]];
  const local = apply3(transpose3(rotation), hit);
  return { x: local[0], y: local[1] };
}
