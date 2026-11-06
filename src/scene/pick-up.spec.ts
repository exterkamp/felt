import { describe, expect, it } from 'vitest';
import { ManualClock } from '../runtime/clock.js';
import { createEngine } from '../runtime/engine.js';
import { Offset } from './animator.js';
import { PickUp } from './pick-up.js';

function card() {
  const offsets: Offset[] = [];
  return {
    x: 100, y: 100, angle: 0, offsets,
    addOffset(o: Offset) { offsets.push(o); },
    removeOffset(o: Offset) { offsets.splice(offsets.indexOf(o), 1); },
    offsetChanged() {},
    get shown() { return offsets[0] ?? { z: 0, turn: 0, tilt: 0, angle: 0 }; },
  };
}

function setup() {
  const clock = new ManualClock(1000 / 60);
  const engine = createEngine({ clock, lifecycle: null });
  return { clock, pick: new PickUp(engine) };
}

describe('picking a card up', () => {
  it('lifts it off the table and holds it there', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    clock.advance(600);
    expect(c.shown.z).toBeGreaterThan(24);
    expect(c.shown.z).toBeLessThan(28);
  });

  it('leans into a drag and settles once the hand stops', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    clock.advance(300);
    let leant = 0;
    for (let i = 0; i < 20; i++) { c.x += 12; clock.advance(1000 / 60); leant = Math.min(leant, c.shown.turn); }
    // Pulled right: right edge down (negative turn), swayed clockwise.
    expect(leant).toBeLessThan(-0.15);
    expect(c.shown.angle).toBeGreaterThan(2);
    clock.advance(1500);
    expect(Math.abs(c.shown.turn)).toBeLessThan(0.01);
    expect(Math.abs(c.shown.angle)).toBeLessThan(0.05);
    expect(c.shown.z).toBeGreaterThan(24);
  });

  it('pulled up the table, tips its top edge away', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    clock.advance(300);
    for (let i = 0; i < 15; i++) { c.y -= 12; clock.advance(1000 / 60); }
    expect(c.shown.tilt).toBeGreaterThan(0.1);
    expect(Math.abs(c.shown.turn)).toBeLessThan(0.02);
  });

  it('swivels about the card\'s own edges when the card is turned', () => {
    const { clock, pick } = setup();
    const c = card();
    c.angle = 90;
    pick.lift(c);
    clock.advance(300);
    // Pulled right across the board is pulled along the card's own length.
    for (let i = 0; i < 15; i++) { c.x += 12; clock.advance(1000 / 60); }
    expect(Math.abs(c.shown.tilt)).toBeGreaterThan(0.1);
    expect(Math.abs(c.shown.turn)).toBeLessThan(0.02);
  });

  it('never swivels past its limit, however hard it is flung', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    let most = 0;
    for (let i = 0; i < 30; i++) { c.x += 200; clock.advance(1000 / 60); most = Math.max(most, Math.abs(c.shown.turn)); }
    expect(most).toBeLessThan(0.32 * 1.35);   // a spring may overshoot a little
  });

  it('put down, drops back onto the table and lets the card go', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    clock.advance(400);
    for (let i = 0; i < 10; i++) { c.x += 10; clock.advance(1000 / 60); }
    pick.drop(c);
    let lowest = Infinity;
    for (let i = 0; i < 120 && pick.holding(c); i++) { clock.advance(1000 / 60); lowest = Math.min(lowest, c.shown.z); }
    expect(pick.holding(c)).toBe(false);
    expect(c.offsets).toHaveLength(0);
    expect(lowest).toBeGreaterThanOrEqual(0);   // never through the felt
  });

  it('caught again while dropping, it goes back up from where it was', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    clock.advance(500);
    pick.drop(c);
    clock.advance(60);
    const mid = c.shown.z;
    pick.lift(c);
    expect(c.offsets).toHaveLength(1);
    clock.advance(16);
    expect(c.shown.z).toBeGreaterThan(mid * 0.5);
    clock.advance(800);
    expect(c.shown.z).toBeGreaterThan(24);
  });
});
