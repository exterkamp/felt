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
  /** How much speed a bounce keeps, 0-1. Default 0.55. */
  bounce?: number;
  /** Half the card's size, for meeting the walls. Default 30 by 42. */
  half?: { x: number; y: number };
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
}

const DT = 1 / 120;
const MAX_SECONDS = 6;

/**
 * Where a flick goes, step by step: pure, and the same every time for the
 * same start. `flickCard` plays this; a game can also use it to know where a
 * card will stop before it does.
 */
export function simulateFlick(
  start: { x: number; y: number; angle: number },
  velocity: { x: number; y: number },
  options: FlickOptions = {},
): FlickPath {
  const friction = options.friction ?? 1500;
  const spinFriction = options.spinFriction ?? 1100;
  const gravity = options.gravity ?? 2600;
  const bounce = options.bounce ?? 0.55;
  const half = options.half ?? { x: 30, y: 42 };
  const speed = Math.hypot(velocity.x, velocity.y);
  const grip = options.grip ?? { x: 0, y: 0 };

  let { x, y, angle } = start;
  let z = 0;
  let vx = velocity.x;
  let vy = velocity.y;
  // Up off the felt, for anything flicked hard.
  let vz = Math.max(0, speed - (options.hopFrom ?? 700)) * (options.hop ?? 0.3);
  // Held by a corner and pulled, it turns: grip crossed with velocity.
  let spin = (grip.x * vy - grip.y * vx) * (options.spin ?? 0.018);
  let tumble = 0;
  let bounces = 0;
  let airborne = 0;
  const steps: FlickStep[] = [{ t: 0, x, y, z, angle, tilt: 0, turn: 0 }];

  let t = 0;
  while (t < MAX_SECONDS) {
    t += DT;
    const inAir = z > 0 || vz > 0;
    if (inAir) {
      airborne += DT;
      vz -= gravity * DT;
      z += vz * DT;
      tumble += DT;
      if (z <= 0) {
        // Down: a little bounce if it came down hard, else it stays down
        // and the felt takes some of its speed.
        z = 0;
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
      const s = spinFriction * DT;
      spin = Math.abs(spin) <= s ? 0 : spin - Math.sign(spin) * s;
    }
    x += vx * DT;
    y += vy * DT;
    angle += spin * DT;

    const b = options.bounds;
    if (b) {
      if (x - half.x < b.left && vx < 0) { x = b.left + half.x; vx = -vx * bounce; spin *= -0.6; bounces++; }
      if (x + half.x > b.right && vx > 0) { x = b.right - half.x; vx = -vx * bounce; spin *= -0.6; bounces++; }
      if (y - half.y < b.top && vy < 0) { y = b.top + half.y; vy = -vy * bounce; spin *= -0.6; bounces++; }
      if (y + half.y > b.bottom && vy > 0) { y = b.bottom - half.y; vy = -vy * bounce; spin *= -0.6; bounces++; }
    }

    // In the air it rocks a little about its own axes, and lies flat again
    // as it comes down.
    const rock = z > 0 ? Math.min(1, z / 30) : 0;
    const tilt = 0.25 * rock * Math.sin(tumble * 9);
    const turn = 0.35 * rock * Math.sin(tumble * 7 + 1);
    steps.push({ t, x, y, z, angle, tilt, turn });
    if (z === 0 && vz === 0 && vx === 0 && vy === 0 && spin === 0) break;
  }
  return { steps, duration: t * 1000, bounces, airborne: airborne * 1000 };
}

/**
 * Lets a card go at a velocity (board units a second) and plays where it
 * goes. Resolves when it comes to rest - or when something else takes it
 * over, like being picked up again.
 */
export function flickCard(
  host: TweenHost,
  sprite: { x: number; y: number; angle: number; setPosition?(x: number, y: number): unknown },
  velocity: { x: number; y: number },
  options: FlickOptions = {},
): Promise<void> {
  let path: FlickPath = { steps: [], duration: 0, bounces: 0, airborne: 0 };
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
      path = simulateFlick({ x: card.x, y: card.y, angle: card.angle }, velocity, options);
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
    complete: () => options.onRest?.(),
  };
  return animatorOf(host).play(sprite, spec);
}
