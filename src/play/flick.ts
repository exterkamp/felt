import { Canned, animatorOf } from '../scene/animator.js';
import type { TweenHost } from './flight.js';
import { popCard } from './flight.js';

// Flicking: a card let go while moving keeps moving.
//
// A throw (`throwCard`) is aimed: it knows where it lands and flies there.
// A flick is not - the hand decides how hard and which way, and the table
// decides the rest. Released fast, the card hops off the felt, sails a
// little, comes down and skids to a stop; released slowly, it slides. Held
// off-centre, it spins as it goes, the way a card flicked by its corner
// does. With walls, it bounces off the table's edge.
//
// The whole path is worked out first, in fixed steps, so a flick is the same
// flick every time (and in a test), and then played through the animator on
// the card's `move` channel - so picking the card up again mid-skid cuts it
// off where it is, like catching it.

export interface FlickOptions {
  /**
   * How it meets the walls and the table. '3d': a hard flick hops off the
   * felt, and a wall knocks the card up into the air, tumbling end over end
   * to land flat - the other side up after an odd number of half turns.
   * '2d': it stays on the felt; a wall deflects it and sets it spinning in
   * the table's plane. Default: '3d' on a board with perspective, else '2d'.
   */
  mode?: '2d' | '3d';
  /**
   * How fast it slows on the felt, in board units a second, each second.
   * Default 1500; ice is about 350.
   */
  friction?: number;
  /** How fast it slows its spin on the felt, degrees a second each second. Default 1100. */
  spinFriction?: number;
  /**
   * Where it was held, from its centre, in board units: held off-centre it
   * spins. Default the centre: no spin.
   */
  grip?: { x: number; y: number };
  /** Spin, in degrees a second, for each unit of grip times speed. Default 0.018. */
  spin?: number;
  /** Speed at which it starts to leave the felt, units a second. Default 700. */
  hopFrom?: number;
  /** Upward speed per unit of speed above `hopFrom`. Default 0.3. */
  hop?: number;
  /** Units a second squared, towards the felt. Default 2600. */
  gravity?: number;
  /** The table's edges, to bounce off. Default none: it slides wherever it is sent. */
  bounds?: { left: number; top: number; right: number; bottom: number };
  /** How much of its speed into a wall it keeps, 0-1. Default 0.55. */
  bounce?: number;
  /** Half the card's size, for meeting the walls. Default 30 by 42. */
  half?: { x: number; y: number };
  /**
   * In 3D, how far up a wall knocks it, per unit of its speed into the wall.
   * Default 0.32.
   */
  kick?: number;
  /** Called once, when it comes to rest. */
  onRest?: () => void;
}

/** One moment of a flick. */
export interface FlickStep {
  t: number;
  x: number; y: number; z: number; angle: number;
  tilt: number; turn: number;
}

export interface FlickPath {
  steps: FlickStep[];
  /** Milliseconds from release to rest. */
  duration: number;
  /** Times it hit a wall. */
  bounces: number;
  /** How long it was off the felt, in ms. */
  airborne: number;
  /** Half turns end over end about its length (`turn`), from walls. */
  turnFlips: number;
  /** Half turns end over end about its width (`tilt`), from walls. */
  tiltFlips: number;
  /**
   * Whether it lands the other side up. A half turn of tilt is the other
   * side up and upside down - the same picture as the other side up and
   * turned 180 degrees in the plane, which is `turnedRound`.
   */
  flipped: boolean;
  turnedRound: boolean;
}

const DT = 1 / 120;
const MAX_SECONDS = 6;
const DEG = 180 / Math.PI;

/**
 * Where a flick goes, step by step: pure, and the same every time for the
 * same start. `flickCard` plays this; a game can also use it to know where a
 * card will stop before it does.
 *
 * The card is a rectangle with mass and a moment of inertia, so a wall
 * meets the corner that reaches it first: hit square on, it bounces back
 * almost without turning; hit corner first, the impulse at the corner sets
 * it spinning, and it leaves the wall at an angle that depends on how it was
 * turned - the 2D part, in both modes. In 3D the wall also knocks it up off
 * the felt, end over end about the wall's line.
 */
export function simulateFlick(
  start: { x: number; y: number; angle: number },
  velocity: { x: number; y: number },
  options: FlickOptions = {},
): FlickPath {
  const mode = options.mode ?? '3d';
  const friction = options.friction ?? 1500;
  const spinFriction = options.spinFriction ?? 1100;
  const gravity = options.gravity ?? 2600;
  const restitution = options.bounce ?? 0.55;
  const half = options.half ?? { x: 30, y: 42 };
  const kick = options.kick ?? 0.32;
  const speed = Math.hypot(velocity.x, velocity.y);
  const grip = options.grip ?? { x: 0, y: 0 };
  // A uniform card: moment of inertia per unit mass about its centre.
  const inertia = ((2 * half.x) ** 2 + (2 * half.y) ** 2) / 12;

  let { x, y, angle } = start;
  let z = 0;
  let vx = velocity.x;
  let vy = velocity.y;
  // Up off the felt, for anything flicked hard - in 3D.
  let vz = mode === '3d' ? Math.max(0, speed - (options.hopFrom ?? 700)) * (options.hop ?? 0.3) : 0;
  // Held by a corner and pulled, it turns: grip crossed with velocity.
  let spin = (grip.x * vy - grip.y * vx) * (options.spin ?? 0.018);   // degrees a second
  let tumble = 0;
  let bounces = 0;
  let airborne = 0;
  // End over end: how far round it is, and how far round it is going by the
  // time it lands, so it always comes down flat.
  const flipped = { turn: 0, tilt: 0 };   // radians, each axis on its own
  let flipAxis: 'turn' | 'tilt' = 'turn';
  let flipTo = 0;
  let flipRate = 0;
  const halves = { turn: 0, tilt: 0 };
  const steps: FlickStep[] = [{ t: 0, x, y, z, angle, tilt: 0, turn: 0 }];

  /** Seconds until it is back on the felt, from height z going up at vz. */
  const timeToLand = (h: number, up: number) => (up + Math.sqrt(up * up + 2 * gravity * h)) / gravity;

  /**
   * Meets one wall: the corner furthest through it is pushed back out, and
   * if that corner is moving into the wall, an impulse there - with the
   * card's inertia - bounces and spins it.
   */
  const wall = (nx: number, ny: number, limit: number) => {
    const a = angle / DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // The corner deepest into the wall (the wall's normal points into the table).
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => {
      const lx = sx * half.x;
      const ly = sy * half.y;
      const cx = lx * c - ly * s;
      const cy = lx * s + ly * c;
      return { cx, cy, depth: (x + cx) * nx + (y + cy) * ny - limit };
    });
    const deepest = Math.min(...corners.map((k) => k.depth));
    if (deepest >= 0) return;
    // An edge meeting the wall flat meets it with both corners, and pushes
    // at its middle: no turn from a square hit.
    const touching = corners.filter((k) => k.depth < deepest + 0.5);
    const rx = touching.reduce((a, k) => a + k.cx, 0) / touching.length;
    const ry = touching.reduce((a, k) => a + k.cy, 0) / touching.length;
    x -= nx * deepest;
    y -= ny * deepest;
    const w = spin / DEG;
    // The corner's own velocity: the card's, plus its spin about the centre.
    const pvx = vx - w * ry;
    const pvy = vy + w * rx;
    const into = pvx * nx + pvy * ny;
    if (into >= 0) return;
    const rn = rx * ny - ry * nx;
    const j = (-(1 + restitution) * into) / (1 + (rn * rn) / inertia);
    vx += j * nx;
    vy += j * ny;
    spin += ((rn * j) / inertia) * DEG;
    // A little grip along the wall, too, which is what makes a glancing
    // corner hit spin rather than slide.
    const tx = -ny;
    const ty = nx;
    const along = (vx - (spin / DEG) * ry) * tx + (vy + (spin / DEG) * rx) * ty;
    const scrub = Math.max(-0.25 * j, Math.min(0.25 * j, -along * 0.35));
    vx += scrub * tx;
    vy += scrub * ty;
    spin += (((rx * ty - ry * tx) * scrub) / inertia) * DEG;
    bounces++;

    if (mode !== '3d') return;
    // Knocked up off the felt, and over: about whichever of its own axes
    // lies most along the wall.
    const hit = -into;
    // Up to about fifty units: harder than that and it would leave the
    // table rather than bounce on it.
    vz = Math.max(vz, Math.min(520, hit * kick));
    // Already going over from an earlier wall: that tumble finishes first.
    if (vz < 120 || flipRate !== 0) return;
    const tangentLocalX = Math.abs(tx * c + ty * s);   // the wall's line, in the card's frame
    flipAxis = tangentLocalX > Math.SQRT1_2 ? 'tilt' : 'turn';
    const count = hit > 1400 ? 2 : 1;
    halves[flipAxis] += count;
    // Over the way it was thrown into the wall: its top goes away from it.
    const way = flipAxis === 'tilt' ? Math.sign(ny || 1) : -Math.sign(nx || 1);
    flipTo = flipped[flipAxis] + way * count * Math.PI;
    flipRate = (flipTo - flipped[flipAxis]) / timeToLand(z, vz);
  };

  let t = 0;
  while (t < MAX_SECONDS) {
    t += DT;
    const inAir = z > 0 || vz > 0;
    if (inAir) {
      airborne += DT;
      vz -= gravity * DT;
      z += vz * DT;
      tumble += DT;
      if (flipRate) {
        let f = flipped[flipAxis] + flipRate * DT;
        if ((flipRate > 0 && f > flipTo) || (flipRate < 0 && f < flipTo)) f = flipTo;
        flipped[flipAxis] = f;
      }
      if (z <= 0) {
        // Down - flat, whatever it was doing in the air - with a little
        // bounce if it came down hard; the felt takes some of its speed.
        z = 0;
        if (flipRate) flipped[flipAxis] = flipTo;
        flipRate = 0;
        vz = vz < -260 ? -vz * 0.22 : 0;
        vx *= 0.82;
        vy *= 0.82;
      }
    } else {
      // Skidding: friction against its motion, until it stops.
      const v = Math.hypot(vx, vy);
      const slow = friction * DT;
      if (v <= slow) {
        vx = 0;
        vy = 0;
      } else {
        vx -= (vx / v) * slow;
        vy -= (vy / v) * slow;
      }
      const sf = spinFriction * DT;
      spin = Math.abs(spin) <= sf ? 0 : spin - Math.sign(spin) * sf;
    }
    x += vx * DT;
    y += vy * DT;
    angle += spin * DT;

    const b = options.bounds;
    if (b) {
      wall(1, 0, b.left);
      wall(-1, 0, -b.right);
      wall(0, 1, b.top);
      wall(0, -1, -b.bottom);
    }

    // In the air it rocks a little about its own axes - unless a wall has it
    // tumbling, which is the whole of its motion - and lies flat as it lands.
    const rock = z > 0 && flipRate === 0 ? Math.min(1, z / 30) : 0;
    let tilt = 0.25 * rock * Math.sin(tumble * 9);
    let turn = 0.35 * rock * Math.sin(tumble * 7 + 1);
    tilt += flipped.tilt;
    turn += flipped.turn;
    steps.push({ t, x, y, z, angle, tilt, turn });
    if (z === 0 && vz === 0 && vx === 0 && vy === 0 && spin === 0) break;
  }
  return {
    steps, duration: t * 1000, bounces, airborne: airborne * 1000,
    turnFlips: halves.turn, tiltFlips: halves.tilt,
    // Half a turn about each axis together is half a turn in the plane.
    flipped: (halves.turn + halves.tilt) % 2 === 1,
    turnedRound: halves.tilt % 2 === 1,
  };
}

/**
 * Lets a card go at a velocity (board units a second) and plays where it
 * goes. Resolves when it comes to rest - or when something else takes it
 * over, like being picked up again.
 */
export function flickCard(
  host: TweenHost,
  sprite: {
    x: number; y: number; angle: number;
    setFaceUp?(faceUp: boolean): unknown; readonly card?: { faceUp: boolean };
  },
  velocity: { x: number; y: number },
  options: FlickOptions = {},
): Promise<void> {
  // 3D where the board has perspective to show it in.
  const distance = (host as { distance?: number }).distance;
  const mode = options.mode ?? (distance === undefined || Number.isFinite(distance) ? '3d' : '2d');
  let path: FlickPath = {
    steps: [], duration: 0, bounces: 0, airborne: 0, turnFlips: 0, tiltFlips: 0, flipped: false, turnedRound: false,
  };
  let landed = false;
  const card = sprite as { x: number; y: number; angle: number };
  const spec: Canned = {
    channel: 'move',
    // A new flick, or a throw, takes over from this one; and this one takes
    // over from anything already moving it.
    policy: 'interrupt',
    priority: 1,
    // Not known until it starts: the path is worked out from where the card
    // is then. The animator reads the duration as it goes.
    duration: 1,
    ease: 'Linear',
    start: () => {
      path = simulateFlick({ x: card.x, y: card.y, angle: card.angle }, velocity, { ...options, mode });
      spec.duration = Math.max(1, path.duration);
    },
    update: (t, offset) => {
      const steps = path.steps;
      if (steps.length < 2) return;
      const at = t * (steps.length - 1);
      const i = Math.min(steps.length - 2, Math.floor(at));
      const f = at - i;
      const a = steps[i];
      const b = steps[i + 1];
      const mix = (p: number, q: number) => p + (q - p) * f;
      card.x = mix(a.x, b.x);
      card.y = mix(a.y, b.y);
      card.angle = mix(a.angle, b.angle);
      offset.z = mix(a.z, b.z);
      offset.tilt = mix(a.tilt, b.tilt);
      offset.turn = mix(a.turn, b.turn);
      // The first time it comes down from a real hop, it lands like a card.
      if (!landed && path.airborne > 120 && a.z > 0 && b.z === 0) {
        landed = true;
        void popCard(host, sprite, 0.035);
      }
    },
    // The tumble's last half turn comes off with the offset; the card's own
    // side and angle take it over, which is the same picture.
    complete: () => {
      if (path.turnedRound) card.angle += 180;
      if (path.flipped && sprite.setFaceUp && sprite.card) sprite.setFaceUp(!sprite.card.faceUp);
      options.onRest?.();
    },
  };
  return animatorOf(host).play(sprite, spec);
}
