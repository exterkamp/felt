import { animatorOf } from '../scene/animator.js';
import { type Mat3, mul3 } from '../gl/lens.js';
import { axisRotation, cardPose } from '../pieces/dice.js';
import type { TweenHost } from './flight.js';
import { popCard } from './flight.js';

// Tossing: a chip or a coin sent spinning end over end at a spot.
//
// The thumb flip: the near edge kicked up, the piece goes over and over in
// the air about the line across its path, and comes down flat where it was
// aimed, on a little bounce and a wobble as it settles. A throw (`throwCard`)
// is aimed too, but slides; a flick (`flickCard`) is not aimed at all. This
// is the one for a piece put somewhere with a flourish: a Stuck chip into
// the middle, a coin tossed into the pot.
//
// The tumble is about an axis in the table's plane, across the direction of
// travel - whichever way that is - so it reads as end over end from any
// throw, not only one along the piece's own width or length. A rotation about
// an arbitrary axis is not one of the three a piece is posed by, so each
// moment's rotation is built as a matrix and taken apart again into angle,
// tilt and turn (`cardPose`), which draws the same picture.
//
// It always lands flat: the spin is a whole number of half turns, so the
// piece comes down the same side up, or the other side up when asked.

export interface TossOptions {
  /** How high the arc goes, in board units. Default from the distance: 24 to 120. */
  height?: number;
  /** Milliseconds in the air. Default from the distance: 320 to 650. */
  duration?: number;
  /**
   * Whole turns end over end. Default from the time in the air, about six a
   * second, at least one.
   */
  turns?: number;
  /** Lands the other side up: half a turn more. Default false. */
  flip?: boolean;
  /** Which way it goes over: 1 the near edge up and over, -1 the far edge. Default 1. */
  direction?: 1 | -1;
  /** The angle it settles at, in degrees. Default the angle it has now. */
  angle?: number;
  /**
   * Turning in the plane as it goes, in degrees over the whole toss - a toss
   * is rarely dead straight off the thumb. Default 0.
   */
  twirl?: number;
  /** The settling bounce, as a share of the arc's height. Default 0.12; 0 for none. */
  bounce?: number;
  /** Glint as it turns towards the light, 0-1. Default 0.6. */
  shine?: number;
  delay?: number;
  /** Called once it is down and still. */
  onRest?: () => void;
}

/** What a toss moves: a Piece is one; so is a plain object in a test. */
export interface Tossable {
  x: number;
  y: number;
  angle: number;
  setFaceUp?(faceUp: boolean): unknown;
  readonly card?: { faceUp: boolean };
}

/** One moment of a toss. Angles in degrees for `angle`, radians for tilt and turn. */
export interface TossPose {
  x: number;
  y: number;
  z: number;
  angle: number;
  tilt: number;
  turn: number;
  /** How far it has gone over, in radians, end over end. */
  over: number;
}

/** The parts of a toss, once its defaults are filled in. */
export interface TossPlan {
  from: { x: number; y: number; angle: number };
  to: { x: number; y: number; angle: number };
  height: number;
  /** In the air, ms. */
  flight: number;
  /** Bouncing and settling after it is down, ms. */
  settle: number;
  /** Radians end over end, in all: a whole number of half turns. */
  over: number;
  /** The axis it goes over about, in the plane, unit length. */
  axis: [number, number, number];
  twirl: number;
  bounce: number;
}

/** Most of a toss's shape comes from how far it is going. */
export function planToss(
  from: { x: number; y: number; angle: number },
  to: { x: number; y: number },
  options: TossOptions = {},
): TossPlan {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const height = options.height ?? Math.min(120, Math.max(24, 18 + distance * 0.3));
  const flight = options.duration ?? Math.min(650, Math.max(320, 260 + distance * 0.9));
  const turns = Math.max(0, Math.round(options.turns ?? Math.max(1, (flight / 1000) * 6)));
  const halves = turns * 2 + (options.flip ? 1 : 0);
  // Across the line of travel: z x d. Turning about it by a positive angle
  // lifts the trailing edge - the one the thumb kicked - and carries it over
  // the top. Tossed nowhere, it goes over about its own width.
  const axis: [number, number, number] = distance > 1e-6 ? [-dy / distance, dx / distance, 0] : [1, 0, 0];
  const bounce = options.bounce ?? 0.12;
  return {
    from: { ...from },
    to: { x: to.x, y: to.y, angle: options.angle ?? from.angle },
    height,
    flight,
    settle: bounce > 0 ? Math.max(140, flight * 0.4) : 0,
    over: (options.direction ?? 1) * halves * Math.PI,
    axis,
    twirl: options.twirl ?? 0,
    bounce,
  };
}

const rz = (t: number): Mat3 => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];

/**
 * Where a toss has the piece `ms` after it starts: pure, so a test - or a
 * game wanting to know when it lands - can ask.
 */
export function tossPose(plan: TossPlan, ms: number): TossPose {
  const { from, to } = plan;
  const total = plan.flight + plan.settle;
  const time = Math.max(0, Math.min(total, ms));
  // In the air it moves at one speed across the table, as anything thrown
  // does, and up and down on a parabola.
  const s = plan.flight > 0 ? Math.min(1, time / plan.flight) : 1;
  const x = from.x + (to.x - from.x) * s;
  const y = from.y + (to.y - from.y) * s;
  // The settle's angle - the piece's own, in the plane - runs to the end so
  // a twirl does not stop dead on landing.
  const k = total > 0 ? time / total : 1;
  const plane = from.angle + plan.twirl * Math.min(1, s * 1.1) + (to.angle - from.angle) * (1 - (1 - k) ** 2);
  let z = 4 * plan.height * s * (1 - s);
  let over = plan.over * s;
  let rock = 0;
  if (time > plan.flight && plan.settle > 0) {
    // Down. One small hop, then a wobble that dies away, the way a coin
    // rings on a table, flat at the end.
    const u = (time - plan.flight) / plan.settle;
    const hop = 0.45;
    if (u < hop) {
      const h = u / hop;
      z = 4 * plan.height * plan.bounce * h * (1 - h);
    } else {
      z = 0;
    }
    over = plan.over;
    rock = 0.22 * Math.sin(u * Math.PI * 5) * (1 - u) ** 2;
  }
  const rotation = mul3(axisRotation(plan.axis, over + rock), rz((plane * Math.PI) / 180));
  const pose = cardPose(rotation);
  return { x, y, z, angle: (pose.angle * 180) / Math.PI, tilt: pose.tilt, turn: pose.turn, over };
}

/**
 * Tosses a piece at a spot: over and over in the air, down flat, a bounce
 * and a wobble. Resolves when it is still - or when something else takes it
 * over, like a finger catching it, which leaves it where it was caught.
 */
export function tossPiece(host: TweenHost, piece: Tossable, to: { x: number; y: number }, options: TossOptions = {}): Promise<void> {
  let plan: TossPlan | undefined;
  let landed = false;
  const glint = options.shine ?? 0.6;
  const spec = {
    channel: 'move',
    // Takes over from anything moving it, and a throw or a flick after it
    // takes over from this.
    policy: 'interrupt' as const,
    priority: 1,
    duration: 1,
    delay: options.delay ?? 0,
    ease: 'Linear',
    start: () => {
      // From wherever it is when it actually goes, not when it was asked.
      plan = planToss({ x: piece.x, y: piece.y, angle: piece.angle }, to, options);
      spec.duration = Math.max(1, plan.flight + plan.settle);
    },
    update: (t: number, offset: { z: number; tilt: number; turn: number; shine?: number }) => {
      if (!plan) return;
      const ms = t * (plan.flight + plan.settle);
      const pose = tossPose(plan, ms);
      piece.x = pose.x;
      piece.y = pose.y;
      piece.angle = pose.angle;
      offset.z = pose.z;
      offset.tilt = pose.tilt;
      offset.turn = pose.turn;
      // The face catches the light as it turns past it: brightest edge-on to
      // the eye and gone again as it comes flat.
      offset.shine = glint * Math.abs(Math.sin(pose.over)) * (ms < plan.flight ? 1 : 0);
      if (!landed && ms >= plan.flight) {
        landed = true;
        void popCard(host, piece, 0.04);
      }
    },
    complete: () => {
      if (!plan) return;
      // The last half turn, if there was one, comes off with the offset, and
      // the piece's own side takes it over: the same picture.
      piece.x = plan.to.x;
      piece.y = plan.to.y;
      piece.angle = plan.to.angle;
      if (options.flip && piece.setFaceUp && piece.card) piece.setFaceUp(!piece.card.faceUp);
      options.onRest?.();
    },
  };
  return animatorOf(host).play(piece, spec);
}
