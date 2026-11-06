import { describe, expect, it } from 'vitest';
import { trackVelocity } from '../scene/board.js';
import { Tweens } from '../scene/tweens.js';
import { flickCard, simulateFlick } from './flick.js';

describe('the speed a finger lets go at', () => {
  it('is how far it went over the last tenth of a second', () => {
    const trail = [{ t: 0, x: 0, y: 0 }];
    for (let t = 16; t <= 160; t += 16) trackVelocity(trail, t, t * 2, 0);   // 2 units a ms
    const v = trackVelocity(trail, 176, 352, 0);
    expect(v.x).toBeCloseTo(2000, -1);
    expect(v.y).toBe(0);
  });

  it('is nothing if it stopped before letting go', () => {
    const trail = [{ t: 0, x: 0, y: 0 }];
    for (let t = 16; t <= 160; t += 16) trackVelocity(trail, t, t * 2, 0);
    expect(trackVelocity(trail, 400, 320, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('a flick', () => {
  const start = { x: 0, y: 0, angle: 0 };

  it('slides and stops where friction says, on the felt the whole way, if gentle', () => {
    const path = simulateFlick(start, { x: 600, y: 0 }, { friction: 1500 });
    const end = path.steps[path.steps.length - 1];
    // v² / 2a
    expect(end.x).toBeCloseTo((600 * 600) / (2 * 1500), -1);
    expect(path.airborne).toBe(0);
    expect(path.steps.every((s) => s.z === 0)).toBe(true);
    expect(path.duration).toBeCloseTo(400, -2);
  });

  it('goes further on ice', () => {
    const felt = simulateFlick(start, { x: 600, y: 0 }, { friction: 1500 });
    const ice = simulateFlick(start, { x: 600, y: 0 }, { friction: 350 });
    expect(ice.steps.at(-1)!.x).toBeGreaterThan(felt.steps.at(-1)!.x * 3);
  });

  it('hops off the felt when flicked hard, and comes down', () => {
    const path = simulateFlick(start, { x: 0, y: -1800 });
    expect(path.airborne).toBeGreaterThan(50);
    expect(Math.max(...path.steps.map((s) => s.z))).toBeGreaterThan(5);
    expect(path.steps.at(-1)!.z).toBe(0);
    expect(path.steps.every((s) => s.z >= 0)).toBe(true);
  });

  it('held by its corner, it spins - the other way for the other corner', () => {
    const right = simulateFlick(start, { x: 0, y: -900 }, { grip: { x: 25, y: 30 } });
    const left = simulateFlick(start, { x: 0, y: -900 }, { grip: { x: -25, y: 30 } });
    const centre = simulateFlick(start, { x: 0, y: -900 });
    expect(Math.abs(right.steps.at(-1)!.angle)).toBeGreaterThan(20);
    expect(Math.sign(right.steps.at(-1)!.angle)).toBe(-Math.sign(left.steps.at(-1)!.angle));
    expect(centre.steps.at(-1)!.angle).toBe(0);
  });

  it('bounces off the walls and stays on the table', () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 600 };
    const path = simulateFlick({ x: 200, y: 300, angle: 0 }, { x: 2500, y: -1700 }, { bounds });
    expect(path.bounces).toBeGreaterThan(0);
    for (const s of path.steps) {
      expect(s.x).toBeGreaterThanOrEqual(30 - 1e-6);
      expect(s.x).toBeLessThanOrEqual(370 + 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(42 - 1e-6);
      expect(s.y).toBeLessThanOrEqual(558 + 1e-6);
    }
  });

  it('is the same flick every time', () => {
    const a = simulateFlick(start, { x: 1234, y: -987 }, { grip: { x: 10, y: -20 } });
    const b = simulateFlick(start, { x: 1234, y: -987 }, { grip: { x: 10, y: -20 } });
    expect(b).toEqual(a);
  });

  it('played on a card, leaves it where the path ends, flat on the table', async () => {
    const host = { tweens: new Tweens() };
    const card = { x: 50, y: 50, angle: 0, z: 0, tilt: 0, turn: 0, scaleX: 1, scaleY: 1 };
    const expected = simulateFlick({ x: 50, y: 50, angle: 0 }, { x: 900, y: 400 }, { grip: { x: 5, y: 5 } });
    let rested = false;
    const done = flickCard(host, card, { x: 900, y: 400 }, { grip: { x: 5, y: 5 }, onRest: () => { rested = true; } });
    for (let i = 0; i < 400; i++) host.tweens.update(16);
    await done;
    const end = expected.steps.at(-1)!;
    expect(card.x).toBeCloseTo(end.x, 6);
    expect(card.y).toBeCloseTo(end.y, 6);
    expect(card.angle).toBeCloseTo(end.angle, 6);
    expect(card.z).toBe(0);
    expect(rested).toBe(true);
  });
});

describe('meeting a wall', () => {
  const bounds = { left: 0, top: 0, right: 400, bottom: 600 };
  const endOf = (p: ReturnType<typeof simulateFlick>) => p.steps[p.steps.length - 1];
  const nearHalfTurns = (r: number) => Math.abs(r / Math.PI - Math.round(r / Math.PI)) < 1e-9;

  it('in 2D, square on, it bounces straight back and hardly turns', () => {
    const p = simulateFlick({ x: 200, y: 300, angle: 0 }, { x: 1600, y: 0 }, { bounds, mode: '2d', friction: 400 });
    expect(p.bounces).toBeGreaterThan(0);
    expect(Math.abs(endOf(p).angle)).toBeLessThan(1);
    expect(endOf(p).x).toBeLessThan(370);
  });

  it('in 2D, corner first, the corner sets it spinning and it deflects', () => {
    const p = simulateFlick({ x: 200, y: 300, angle: 30 }, { x: 1600, y: 0 }, { bounds, mode: '2d', friction: 400 });
    expect(p.bounces).toBeGreaterThan(0);
    expect(Math.abs(endOf(p).angle - 30)).toBeGreaterThan(20);
    expect(Math.abs(endOf(p).y - 300)).toBeGreaterThan(5);
  });

  it('in 2D, it never leaves the felt and never turns over', () => {
    const p = simulateFlick({ x: 200, y: 300, angle: 10 }, { x: 2600, y: -1900 }, { bounds, mode: '2d' });
    expect(p.steps.every((s) => s.z === 0 && s.tilt === 0 && s.turn === 0)).toBe(true);
    expect(p.flipped).toBe(false);
  });

  it('in 3D, a wall knocks it up and over, end over end, and it lands flat', () => {
    const p = simulateFlick({ x: 200, y: 300, angle: 0 }, { x: 0, y: -1300 }, { bounds, mode: '3d' });
    expect(p.bounces).toBeGreaterThan(0);
    expect(p.tiltFlips).toBeGreaterThan(0);          // the top wall's line is the card's width
    expect(p.turnFlips).toBe(0);
    expect(Math.max(...p.steps.map((s) => s.z))).toBeGreaterThan(10);
    const end = endOf(p);
    expect(end.z).toBe(0);
    expect(nearHalfTurns(end.tilt)).toBe(true);
    expect(nearHalfTurns(end.turn)).toBe(true);
    // Turned over somewhere in between: edge on to the camera at some point.
    expect(p.steps.some((s) => Math.abs(Math.cos(s.tilt)) < 0.2)).toBe(true);
  });

  it('in 3D, a side wall turns it over about its length', () => {
    const p = simulateFlick({ x: 200, y: 300, angle: 0 }, { x: 1300, y: 0 }, { bounds, mode: '3d' });
    expect(p.turnFlips).toBeGreaterThan(0);
    expect(p.tiltFlips).toBe(0);
  });

  it('turned over, the card itself is the other side up afterwards, and nothing jumps', async () => {
    const host = { tweens: new Tweens(), distance: 800 };
    const card = {
      x: 200, y: 300, angle: 0, z: 0, tilt: 0, turn: 0, scaleX: 1, scaleY: 1,
      card: { faceUp: true },
      setFaceUp(up: boolean) { this.card.faceUp = up; },
    };
    const v = { x: 1300, y: 0 };
    const p = simulateFlick({ x: 200, y: 300, angle: 0 }, v, { bounds, mode: '3d' });
    const done = flickCard(host, card, v, { bounds });
    for (let i = 0; i < 600; i++) host.tweens.update(16);
    await done;
    expect(card.card.faceUp).toBe(!p.flipped);
    expect(card.turn).toBe(0);
    expect(card.tilt).toBe(0);
    expect(card.z).toBe(0);
  });

  it('on a flat board, flickCard flicks in 2D', async () => {
    const host = { tweens: new Tweens(), distance: Infinity };
    const card = { x: 200, y: 300, angle: 0, z: 0, tilt: 0, turn: 0, scaleX: 1, scaleY: 1 };
    let highest = 0;
    const done = flickCard(host, card, { x: 2400, y: -300 }, { bounds });
    for (let i = 0; i < 600; i++) { host.tweens.update(16); highest = Math.max(highest, card.z); }
    await done;
    expect(highest).toBe(0);
  });
});
