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
