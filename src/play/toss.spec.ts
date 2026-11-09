import { describe, expect, it } from 'vitest';
import { apply3, cardRotation } from '../gl/lens.js';
import { planToss, tossPose } from './toss.js';

// A toss is judged by its rotation, not its angles: angle, tilt and turn are
// only how a rotation about an arbitrary axis gets drawn, and several sets
// of them draw the same thing.
const normal = (p: { angle: number; tilt: number; turn: number }) =>
  apply3(cardRotation((p.angle * Math.PI) / 180, p.tilt, p.turn), [0, 0, 1]);
const across = (p: { angle: number; tilt: number; turn: number }) =>
  apply3(cardRotation((p.angle * Math.PI) / 180, p.tilt, p.turn), [1, 0, 0]);

describe('tossing a piece', () => {
  const from = { x: 100, y: 500, angle: 30 };
  const to = { x: 260, y: 200 };

  it('goes from where it was to where it was aimed, up and down on an arc', () => {
    const plan = planToss(from, to, { height: 80 });
    const start = tossPose(plan, 0);
    const middle = tossPose(plan, plan.flight / 2);
    const end = tossPose(plan, plan.flight + plan.settle);
    expect(start).toMatchObject({ x: 100, y: 500 });
    expect(start.z).toBeCloseTo(0);
    expect(middle.z).toBeCloseTo(80);
    expect(middle.x).toBeCloseTo(180);
    expect(end.x).toBeCloseTo(260);
    expect(end.y).toBeCloseTo(200);
    expect(end.z).toBe(0);
  });

  it('lands flat, the same side up, turned the way it was', () => {
    const plan = planToss(from, to, { turns: 3 });
    const end = tossPose(plan, plan.flight + plan.settle);
    const n = normal(end);
    expect(n[2]).toBeCloseTo(1);
    // Its picture square to where it started: its own x axis at 30 degrees.
    const x = across(end);
    expect(Math.atan2(x[1], x[0]) * (180 / Math.PI)).toBeCloseTo(30);
  });

  it('lands the other side up when asked to', () => {
    const plan = planToss(from, to, { turns: 2, flip: true });
    expect(normal(tossPose(plan, plan.flight + plan.settle))[2]).toBeCloseTo(-1);
  });

  it('goes over end over end along its path, whichever way that is', () => {
    for (const aim of [{ x: 400, y: 500 }, { x: 100, y: 100 }, { x: 0, y: 600 }, to]) {
      const plan = planToss(from, aim, { turns: 1, bounce: 0 });
      // A quarter of the way through one turn it is on its edge, facing
      // along the line of travel - not sideways across it.
      const n = normal(tossPose(plan, plan.flight / 4));
      const dx = aim.x - from.x;
      const dy = aim.y - from.y;
      const d = Math.hypot(dx, dy);
      expect(Math.abs(n[2])).toBeLessThan(1e-6);
      expect(Math.abs((n[0] * dx + n[1] * dy) / d)).toBeCloseTo(1);
    }
  });

  it('turns the whole way it was asked, and settles to the angle it was given', () => {
    const plan = planToss(from, to, { turns: 4, angle: 90 });
    expect(plan.over).toBeCloseTo(8 * Math.PI);
    const x = across(tossPose(plan, plan.flight + plan.settle));
    expect(Math.atan2(x[1], x[0]) * (180 / Math.PI)).toBeCloseTo(90);
  });

  it('spins more the longer it is in the air, at least once', () => {
    const near = planToss(from, { x: 110, y: 490 });
    const far = planToss(from, { x: 460, y: 20 });
    expect(Math.abs(near.over)).toBeGreaterThanOrEqual(2 * Math.PI);
    expect(Math.abs(far.over)).toBeGreaterThan(Math.abs(near.over));
  });
});
