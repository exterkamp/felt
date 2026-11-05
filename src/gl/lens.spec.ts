import { describe, expect, it } from 'vitest';
import { cardRotation, lensDistance, project, unprojectOntoPlane } from './lens.js';

describe('the lens', () => {
  // The promise that lets a flat game ignore the camera entirely.
  it('draws anything on the table at exactly its own size', () => {
    const d = lensDistance(45, 640);
    for (const [x, y] of [[0, 0], [480, 640], [37, 512]]) {
      const at = project(x, y, 0, 240, 320, d);
      expect(at.x).toBeCloseTo(x);
      expect(at.y).toBeCloseTo(y);
    }
  });

  it('makes a lifted card bigger, and a flat board does not', () => {
    const d = lensDistance(45, 640);
    expect(project(100, 0, 50, 0, 0, d).x).toBeGreaterThan(100);
    expect(project(100, 0, 50, 0, 0, Infinity).x).toBe(100);
  });

  it('is flat at a field of view of nought', () => {
    expect(lensDistance(0, 640)).toBe(Infinity);
  });

  // Picking a card under a finger goes back through the same lens.
  it('finds the point on a card that a point on the screen is over', () => {
    const d = lensDistance(45, 640);
    const rotation = cardRotation(0.4, 0.5, 0.3);
    const origin: [number, number, number] = [200, 300, 20];
    // A point on the card, projected to the screen, and back again.
    const local = [12, -30, 0];
    const world = [
      origin[0] + rotation[0] * local[0] + rotation[1] * local[1],
      origin[1] + rotation[3] * local[0] + rotation[4] * local[1],
      origin[2] + rotation[6] * local[0] + rotation[7] * local[1],
    ];
    const screen = project(world[0], world[1], world[2], 200, 300, d);
    const back = unprojectOntoPlane(screen.x, screen.y, origin, rotation, 200, 300, d);
    expect(back?.x).toBeCloseTo(12);
    expect(back?.y).toBeCloseTo(-30);
  });

  it('turns a flat card in the plane, clockwise on a y-down board', () => {
    const r = cardRotation(Math.PI / 2, 0, 0);
    // The card's right edge points down the board after a quarter turn.
    expect(r[3]).toBeCloseTo(1);
  });
});
