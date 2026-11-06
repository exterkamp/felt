import { describe, expect, it } from 'vitest';
import { ManualClock } from '../runtime/clock.js';
import { createEngine } from '../runtime/engine.js';
import { Offset } from './animator.js';
import { PickUp } from './pick-up.js';
import { cardRotation } from '../gl/lens.js';

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
    expect(most).toBeLessThan(0.7 * 1.35);   // a spring may overshoot a little
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

describe('how it settles', () => {
  it('swings past where it is going at most once, and only a little', () => {
    const { clock, pick } = setup();
    const c = card();
    pick.lift(c);
    clock.advance(300);
    for (let i = 0; i < 15; i++) { c.x += 14; clock.advance(1000 / 60); }
    // Stopped: count the swings through upright on the way back.
    let crossings = 0;
    let last = Math.sign(c.shown.turn);
    let overshoot = 0;
    for (let i = 0; i < 120; i++) {
      clock.advance(1000 / 60);
      // Visible swings only: a few thousandths either side of upright is
      // the spring arriving, not a wobble.
      const now = Math.abs(c.shown.turn) > 0.005 ? Math.sign(c.shown.turn) : 0;
      if (now !== 0 && now !== last) { crossings++; last = now; }
      if (crossings) overshoot = Math.max(overshoot, Math.abs(c.shown.turn));
    }
    expect(crossings).toBeLessThanOrEqual(1);
    expect(overshoot).toBeLessThan(0.1);
  });
});

describe('a run carried with a held card', () => {
  /** A point on the lead card, posed as the shader poses it: centre + Rz·Rx·Ry·local. */
  const posed = (lead: ReturnType<typeof card>, lx: number, ly: number) => {
    const o = lead.shown as Offset;
    const r = cardRotation(((lead.angle + o.angle) * Math.PI) / 180, o.tilt, o.turn);
    return { x: lead.x + r[0] * lx + r[1] * ly, y: lead.y + r[3] * lx + r[4] * ly, z: o.z + r[6] * lx + r[7] * ly };
  };

  it('swings with it as one rigid stack, not card by card', () => {
    const { clock, pick } = setup();
    const lead = card();
    const below = [card(), card()];
    below.forEach((c, i) => { c.y = lead.y + 24 * (i + 1); });
    pick.lift(lead);
    pick.carry(lead, below);
    clock.advance(300);
    let worst = 0;
    let swung = 0;
    for (let i = 0; i < 30; i++) {
      // Dragged up and right together, the way the table moves a run.
      for (const c of [lead, ...below]) { c.x += 9; c.y -= 4; }
      clock.advance(1000 / 60);
      swung = Math.max(swung, Math.abs((lead.shown as Offset).turn), Math.abs((lead.shown as Offset).tilt));
      below.forEach((c, k) => {
        const o = c.shown as Offset;
        const want = posed(lead, 0, 24 * (k + 1));
        if (want.z < 0) return;   // never below the felt; nothing to compare there
        worst = Math.max(worst, Math.hypot(c.x + o.x - want.x, c.y + o.y - want.y, o.z - want.z));
        expect(o.angle).toBe((lead.shown as Offset).angle);
        expect(o.tilt).toBe((lead.shown as Offset).tilt);
        expect(o.turn).toBe((lead.shown as Offset).turn);
      });
    }
    expect(swung).toBeGreaterThan(0.05);
    expect(worst).toBeLessThan(1e-6);
  });

  it('swings less than a card on its own, being heavier', () => {
    const swing = (carrying: number) => {
      const { clock, pick } = setup();
      const lead = card();
      const rest = Array.from({ length: carrying }, () => card());
      pick.lift(lead);
      pick.carry(lead, rest);
      clock.advance(300);
      let most = 0;
      for (let i = 0; i < 20; i++) { lead.x += 12; clock.advance(1000 / 60); most = Math.max(most, Math.abs((lead.shown as Offset).turn)); }
      return most;
    };
    expect(swing(3)).toBeLessThan(swing(0) * 0.6);
  });

  it('comes off the carried cards once the held one is down', () => {
    const { clock, pick } = setup();
    const lead = card();
    const other = card();
    pick.lift(lead);
    pick.carry(lead, [other]);
    clock.advance(300);
    pick.drop(lead);
    clock.advance(2000);
    expect(pick.holding(lead)).toBe(false);
    expect(other.offsets.length).toBe(0);
  });
});
