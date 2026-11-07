import { describe, expect, it } from 'vitest';
import { cardRotation } from '../gl/lens.js';
import {
  CASINO_CHIPS, ChipSet, chipLabel, chipStackLayout, colorUp, exactChips, makeChange, payFrom, stackValue,
} from './chips.js';
import {
  DIE_FACES, axisRotation, cardPose, dieOrientation, dieTumble, faceFrame, faceNormal, rollDice, topFace,
} from './dice.js';
import { PEG_GAME, pegScore, pegTrack, scorePegs, startPegs } from './pegging.js';

const casino = CASINO_CHIPS.map((d) => d.value);
const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('making change', () => {
  it('makes an amount in the fewest casino chips', () => {
    expect(makeChange(137, casino)).toEqual([100, 25, 5, 5, 1, 1]);
    expect(makeChange(2600, casino)).toEqual([1000, 1000, 500, 100]);
    expect(makeChange(0, casino)).toEqual([]);
  });

  it('is not fooled by a set greedy gets wrong', () => {
    expect(makeChange(6, [1, 3, 4])).toEqual([3, 3]);
  });

  it('refuses what the set cannot make', () => {
    expect(() => makeChange(7, [5, 25])).toThrow();
    expect(() => makeChange(-5, casino)).toThrow();
  });

  it('labels big chips short', () => {
    expect(['1', '25', '1K', '2.5K', '5K', '1M'])
      .toEqual([1, 25, 1000, 2500, 5000, 1e6].map(chipLabel));
  });
});

describe('a stack', () => {
  it('is worth its chips', () => {
    expect(stackValue([100, 25, 25, 5])).toBe(155);
    expect(stackValue([])).toBe(0);
  });

  it('finds the fewest chips that pay an amount exactly, nearest the top first', () => {
    const stack = [25, 5, 5, 5, 5, 5, 10, 10, 10];
    const paid = exactChips(stack, 30)!;
    expect(paid.map((i) => stack[i]).sort((a, b) => a - b)).toEqual([5, 25]);
    expect(exactChips([25, 10, 10, 10], 30)!.map((i) => [25, 10, 10, 10][i])).toEqual([10, 10, 10]);
    expect(exactChips([25, 25], 30)).toBeUndefined();
  });

  it('pays a bet out of chips it has, and keeps the rest in order', () => {
    const pay = payFrom([100, 25, 25, 5, 5], 30, casino);
    expect(pay.pay.sort((a, b) => a - b)).toEqual([5, 25]);
    expect(stackValue(pay.keep)).toBe(130);
    expect(pay.broken).toEqual([]);
  });

  it('breaks a chip when it has to, and the values add up', () => {
    const stack = [100, 100];
    const pay = payFrom(stack, 35, casino);
    expect(stackValue(pay.pay)).toBe(35);
    expect(stackValue(pay.pay) + stackValue(pay.keep)).toBe(200);
    // A hundred broken for 35 is not enough: a 25 broken into fives as well.
    expect(pay.broken.map((b) => b.value)).toEqual([100, 25]);
    for (const b of pay.broken) expect(stackValue(b.into)).toBe(b.value);
  });

  it('refuses to pay more than it holds', () => {
    expect(() => payFrom([5, 5], 25, casino)).toThrow();
  });

  it('colours up', () => {
    expect(colorUp(Array(25).fill(1), casino)).toEqual([25]);
    expect(colorUp([5, 5, 5, 5, 5, 25, 25, 25], casino)).toEqual([100]);
  });

  it('a ChipSet knows its looks and does the same sums', () => {
    const set = new ChipSet();
    expect(set.of(25).color).toBe('#1d8048');
    expect(set.values[0]).toBe(5000);
    expect(set.makeChange(30)).toEqual([25, 5]);
    expect(() => set.of(3)).toThrow();
  });
});

describe('stack geometry', () => {
  it('rises a chip thickness at a time, and starts a new column every twenty', () => {
    const places = chipStackLayout(45, { diameter: 40, messy: 0, seed: 3 });
    expect(places[0]).toMatchObject({ x: 0, y: 0, column: 0, row: 0 });
    expect(places[1].y).toBeCloseTo(-3);
    expect(places[19].y).toBeCloseTo(-57);
    expect(places[20]).toMatchObject({ column: 1, row: 0 });
    expect(places[20].x).toBeCloseTo(44.8);
    expect(places[44]).toMatchObject({ column: 2, row: 4 });
  });

  it('is messy from its seed, the same every time, and a chip added never moves the others', () => {
    const a = chipStackLayout(10, { seed: 7 });
    const b = chipStackLayout(11, { seed: 7 });
    expect(b.slice(0, 10)).toEqual(a);
    expect(chipStackLayout(10, { seed: 8 })).not.toEqual(a);
    // Messy but still a stack: no chip more than a few units off the column.
    for (const p of a) expect(Math.abs(p.x)).toBeLessThan(4);
    expect(new Set(a.map((p) => p.angle.toFixed(3))).size).toBe(10);
  });
});

describe('dice', () => {
  it('rolls the same from the same seed', () => {
    expect(rollDice(42, 10)).toEqual(rollDice(42, 10));
    expect(rollDice(42, 10)).not.toEqual(rollDice(43, 10));
    const many = rollDice(1, 6000);
    for (const face of DIE_FACES) {
      const n = many.filter((v) => v === face).length;
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1150);
    }
  });

  it('lies with the face asked for on top, and opposite faces add to seven', () => {
    for (const face of DIE_FACES) {
      for (const yaw of [0, 0.4, -2]) {
        const r = dieOrientation(face, yaw);
        expect(topFace(r)).toBe(face);
        expect(faceNormal(r, face)[2]).toBeCloseTo(1);
        expect(faceNormal(r, 7 - face)[2]).toBeCloseTo(-1);
      }
    }
  });

  it('draws the top face flat and upright', () => {
    for (const face of DIE_FACES) {
      const world = (() => {
        const r = dieOrientation(face, 0); const f = faceFrame(face);
        const out = new Array(9).fill(0);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += r[i * 3 + k] * f[k * 3 + j];
        return out;
      })();
      expect(close(world, [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-9)).toBe(true);
    }
  });

  it('turns any rotation into a card pose that rebuilds it', () => {
    for (let i = 0; i < 50; i++) {
      const m = axisRotation([Math.sin(i), Math.cos(i * 1.3), Math.sin(i * 0.7) + 0.2], i * 0.37);
      const p = cardPose(m);
      expect(close(cardRotation(p.angle, p.tilt, p.turn), m, 1e-9)).toBe(true);
    }
  });

  it('tumbles to the face it was given, flat on the felt, wherever the seed takes it', () => {
    for (const seed of [1, 2, 3, 99]) {
      for (const face of DIE_FACES) {
        const tumble = dieTumble({ from: { x: 0, y: 0 }, to: { x: 200, y: -60 }, face, size: 30, seed });
        const end = tumble.at(1);
        expect(topFace(end.rotation)).toBe(face);
        expect(faceNormal(end.rotation, face)[2]).toBeCloseTo(1, 9);
        expect(end).toMatchObject({ x: 200, y: -60 });
        expect(end.z).toBeCloseTo(15, 9);
        // Never through the table: the lowest corner is at or above it all the way.
        for (let t = 0; t <= 1; t += 0.01) {
          const p = tumble.at(t);
          const reach = 15 * (Math.abs(p.rotation[6]) + Math.abs(p.rotation[7]) + Math.abs(p.rotation[8]));
          expect(p.z - reach).toBeGreaterThan(-1e-9);
        }
      }
    }
  });

  it('is the same tumble for the same seed, and actually tumbles', () => {
    const a = dieTumble({ from: { x: 0, y: 0 }, to: { x: 150, y: 0 }, face: 4, seed: 5 });
    const b = dieTumble({ from: { x: 0, y: 0 }, to: { x: 150, y: 0 }, face: 4, seed: 5 });
    expect(a.at(0.3)).toEqual(b.at(0.3));
    const tops = new Set<number>();
    for (let t = 0; t < 1; t += 0.02) tops.add(topFace(a.at(t).rotation));
    expect(tops.size).toBeGreaterThan(2);
    expect(a.at(0.1).z).toBeGreaterThan(30);
  });
});

describe('the peg board', () => {
  it('leapfrogs: the back peg jumps the front one by the score', () => {
    let s = startPegs();
    expect(pegScore(s)).toBe(0);
    let m = scorePegs(s, 5);
    expect(m).toMatchObject({ peg: 1, from: -1, to: 5 });
    s = m.state;
    m = scorePegs(s, 2);
    expect(m).toMatchObject({ peg: 0, from: 0, to: 7 });
    s = m.state;
    expect(s.pegs).toEqual([7, 5]);
    expect(pegScore(s)).toBe(7);
    m = scorePegs(s, 12);
    expect(m).toMatchObject({ peg: 1, from: 5, to: 19 });
    expect(scorePegs(m.state, 0)).toMatchObject({ from: 7, to: 7 });
  });

  it('stops in the game hole', () => {
    const m = scorePegs({ pegs: [118, 112] }, 9);
    expect(m.to).toBe(PEG_GAME);
    expect(pegScore(m.state)).toBe(121);
  });

  it('runs out along one row and back along the next, in fives', () => {
    const track = pegTrack({ pitch: 6, groupGap: 4, rowGap: 9 });
    const h = (p: number) => track.hole(0, p);
    expect(h(2).x - h(1).x).toBeCloseTo(6);
    expect(h(6).x - h(5).x).toBeCloseTo(10);
    expect(h(60).y).toBe(h(1).y);
    expect(h(61).y - h(60).y).toBeCloseTo(9);
    expect(h(61).x).toBeCloseTo(h(60).x);
    expect(h(120).x).toBeCloseTo(h(1).x);
    expect(h(121).x).toBeLessThan(h(120).x);
    expect(h(0).x).toBeLessThan(h(1).x);
    expect(h(-1).x).toBeLessThan(h(0).x);
    // Player two's lane is below the first's, and every hole is on the board.
    expect(track.hole(1, 1).y).toBeGreaterThan(h(61).y);
    for (const hole of track.holes()) {
      expect(Math.abs(hole.x)).toBeLessThan(track.width / 2);
      expect(Math.abs(hole.y)).toBeLessThan(track.height / 2);
    }
    expect(track.holes().length).toBe(2 * 123);
  });
});
