import { describe, expect, it, vi } from 'vitest';
import { defineHand, handPositions } from '../core/hand.js';
import { defineStack } from '../core/stack.js';
import { Tweens } from '../scene/tweens.js';
import {
  Movable, TweenHost, dealCards, flightDuration, landingsFor, shortestTurn, spinTarget,
  throwCard, throwLanding,
} from './flight.js';

// A real tween clock, recording what it was asked for. Nothing here needs a
// browser: the board is only ever a host with tweens, and stepping the clock
// by hand is what lets a throw's promise resolve in a test.
function stubScene() {
  const clock = new Tweens();
  const tweens: Record<string, any>[] = [];
  const add = clock.add.bind(clock);
  clock.add = (config) => {
    tweens.push(config as Record<string, any>);
    return add(config);
  };
  const scene: TweenHost & { run<T>(p: Promise<T>): Promise<T> } = {
    tweens: clock,
    async run<T>(p: Promise<T>) {
      clock.flush();
      return p;
    },
  };
  return { scene, tweens };
}

function stubCard(x = 0, y = 0): Movable {
  return { x, y, angle: 0, scaleX: 1, scaleY: 1, z: 0 };
}

describe('where a throw lands', () => {
  it('lands on a bare point', () => {
    expect(throwLanding({ x: 120, y: 40 })).toEqual({ x: 120, y: 40 });
  });

  it('lands on an empty stack-s anchor', () => {
    const stack = defineStack({ id: 's', x: 100, y: 50, fan: 'down', step: 20 });
    expect(throwLanding(stack)).toEqual({ x: 100, y: 50, angle: 0 });
  });

  // Throwing at a pile of six means landing on top of the six, not under them.
  it('lands where a stack-s next card goes', () => {
    const stack = defineStack({ id: 's', x: 100, y: 50, fan: 'down', step: 20 });
    expect(throwLanding({ stack, count: 3 })).toEqual({ x: 100, y: 110, angle: 0 });
  });

  it('respects a squeezed pile-s own gaps', () => {
    const stack = defineStack({ id: 's', x: 0, y: 0, fan: 'down', step: 20, maxSpread: 30 });
    expect(throwLanding({ stack, count: 3 }).y).toBeCloseTo(30);
  });
});

describe('how long it takes', () => {
  it('takes longer the further it goes', () => {
    expect(flightDuration(300)).toBeGreaterThan(flightDuration(100));
  });

  it('is never instant and never a journey', () => {
    expect(flightDuration(0)).toBe(220);
    expect(flightDuration(100000)).toBe(700);
  });
});

describe('the spin', () => {
  // The detail that stops a card snapping when the pile redraws it.
  it('always ends exactly on the angle it has to rest at', () => {
    for (const from of [0, 17, -200, 359, 720]) {
      for (const settle of [0, 15, -30]) {
        const target = spinTarget(from, settle, 1);
        expect(((target - settle) % 360 + 360) % 360).toBeCloseTo(0);
      }
    }
  });

  it('turns about once on the way', () => {
    for (let i = 0; i < 50; i++) {
      const turn = Math.abs(spinTarget(0, 0, 1));
      expect(turn).toBeGreaterThan(300);
      expect(turn).toBeLessThan(420);
    }
  });

  it('can be thrown flat', () => {
    expect(spinTarget(0, 0, 0)).toBe(0);
    expect(spinTarget(90, 0, 0)).toBe(0);
  });

  // Variety comes from the direction, not from fuzzing the angle - fuzzing
  // it would land the card off square and the settle would snap it back.
  it('spins both ways over a run of throws', () => {
    const turns = new Set(Array.from({ length: 40 }, () => spinTarget(0, 0, 1)));
    expect([...turns].sort()).toEqual([-360, 360]);
  });

  it('still ends on the resting angle after several turns', () => {
    for (const spins of [0, 1, 2, 3]) {
      const target = spinTarget(33, -12, spins);
      expect(((target + 12) % 360 + 360) % 360).toBeCloseTo(0);
    }
  });
});

describe('throwing a card', () => {
  it('flies it to the landing place and settles it upright', async () => {
    const { scene } = stubScene();
    const card = stubCard(0, 0);
    await scene.run(throwCard(scene, card, { x: 200, y: 100 }));
    expect(card.x).toBe(200);
    expect(card.y).toBe(100);
    expect(card.angle).toBe(0);
    expect(card.scaleX).toBe(1);
  });

  it('tells the game when it has landed', async () => {
    const { scene } = stubScene();
    const onLand = vi.fn();
    await scene.run(throwCard(scene, stubCard(), { x: 10, y: 10 }, { onLand }));
    expect(onLand).toHaveBeenCalledOnce();
  });

  it('pops on landing, and can be thrown without the bounce', async () => {
    for (const pop of [true, false]) {
      const { scene } = stubScene();
      const card = stubCard();
      let biggest = 0;
      const done = throwCard(scene, card, { x: 10, y: 10 }, { pop, duration: 200 });
      for (let t = 0; t < 500; t += 10) {
        scene.tweens.update(10);
        biggest = Math.max(biggest, card.scaleX);
      }
      await done;
      expect(biggest > 1.01).toBe(pop);
      expect(card.scaleX).toBeCloseTo(1, 9);
    }
  });

  // A card thrown again while it is still in the air flies on from where it
  // is, rather than both throws fighting over it.
  it('a second throw takes over from the first, where it is', async () => {
    const { scene } = stubScene();
    const card = stubCard(0, 0);
    const first = throwCard(scene, card, { x: 300, y: 0 }, { duration: 400, pop: false, arc: 30 });
    for (let t = 0; t < 200; t += 20) scene.tweens.update(20);
    const halfway = card.x;
    const second = throwCard(scene, card, { x: 0, y: 300 }, { duration: 400, pop: false, arc: 30 });
    await first;
    scene.tweens.update(1);
    expect(Math.abs(card.x - halfway)).toBeLessThan(5);
    scene.tweens.flush();
    await second;
    expect(card.x).toBe(0);
    expect(card.y).toBe(300);
    expect(card.z).toBe(0);
  });
});

describe('dealing several', () => {
  const stack = defineStack({ id: 's', x: 0, y: 0, fan: 'down', step: 20 });

  it('gives every card its own place in the pile', () => {
    expect(landingsFor({ stack, count: 0 }, 3).map((p) => p.y)).toEqual([0, 20, 40]);
  });

  it('deals onto the end of what is already there', () => {
    expect(landingsFor({ stack, count: 2 }, 2).map((p) => p.y)).toEqual([40, 60]);
  });

  it('sends them all to the same spot when the target is a point', () => {
    expect(landingsFor({ x: 5, y: 5 }, 3)).toEqual([
      { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 },
    ]);
  });

  it('leaves a gap between one card and the next', async () => {
    const { scene } = stubScene();
    const cards = [stubCard(0, 500), stubCard(0, 500), stubCard(0, 500)];
    const done = dealCards(scene, cards, { stack, count: 0 }, { stagger: 50, pop: false });
    const moved = () => cards.map((c) => c.y !== 500);
    scene.tweens.update(30);
    expect(moved()).toEqual([true, false, false]);
    scene.tweens.update(30);
    expect(moved()).toEqual([true, true, false]);
    scene.tweens.update(50);
    expect(moved()).toEqual([true, true, true]);
    scene.tweens.flush();
    await done;
    expect(cards.map((c) => c.y)).toEqual([0, 20, 40]);
  });
});

describe('throwing into a hand', () => {
  const hand = defineHand({ id: 'h', x: 100, y: 300, step: 10, maxSpread: 0, radius: 200 });

  it('lands at the place in the fan, and at the angle it is held at', () => {
    const landing = throwLanding({ hand, count: 2 });
    const expected = handPositions(hand, 3)[2];
    expect(landing.x).toBeCloseTo(expected.x);
    expect(landing.y).toBeCloseTo(expected.y);
    expect(landing.angle).toBeCloseTo(expected.angle);
  });

  // A card that settled square and was then redrawn at 10 degrees by the hand
  // would jump on arrival - the same artefact the exact landing exists for.
  it('settles at the hand-s angle rather than upright', async () => {
    const { scene } = stubScene();
    const card = stubCard(0, 0);
    await scene.run(throwCard(scene, card, { hand, count: 2 }));
    expect(card.angle).toBeCloseTo(handPositions(hand, 3)[2].angle);
  });

  it('is overridden when the caller asks for a particular angle', async () => {
    const { scene } = stubScene();
    const card = stubCard(0, 0);
    await scene.run(throwCard(scene, card, { hand, count: 0 }, { settleAngle: 45 }));
    expect(card.angle).toBe(45);
  });

  // Dealing into a hand is not dealing onto a pile: every card that arrives
  // moves every card already there, so they all aim at the finished fan.
  it('deals into the hand as it will be, not as it is', () => {
    const places = landingsFor({ hand, count: 0 }, 3);
    expect(places.map((p) => p.angle)).toEqual([-10, 0, 10]);
  });

  it('deals onto the end of a hand that already holds cards', () => {
    const places = landingsFor({ hand, count: 2 }, 2);
    expect(places).toEqual(handPositions(hand, 4).slice(2));
  });
});

describe('turning the short way', () => {
  // The bug this exists for: a hand facing across the table holds cards at
  // 189 degrees, the sprite showing one reports -171, and a plain tween from
  // one to the other is a full spin to reach a place five degrees away.
  it('crosses the wrap instead of going all the way round', () => {
    // The exact case that shipped: a card reporting -175 in a hand that now
    // wants it at 180. Five degrees, not three hundred and fifty-five.
    const turn = (from: number, to: number) => Math.abs(shortestTurn(from, to) - from);
    expect(turn(-175, 180)).toBeCloseTo(5);
    expect(turn(-166, 189)).toBeCloseTo(5);
    expect(turn(176, 171)).toBeCloseTo(5);
  });

  // -171 and 189 are the same angle, so the honest answer is to stay put.
  it('does not move a card that is already where it should be', () => {
    expect(shortestTurn(-171, 189)).toBeCloseTo(-171);
    expect(shortestTurn(0, 720)).toBeCloseTo(0);
  });

  it('never turns more than half a circle', () => {
    for (let from = -720; from <= 720; from += 37) {
      for (let to = -720; to <= 720; to += 53) {
        expect(Math.abs(shortestTurn(from, to) - from)).toBeLessThanOrEqual(180.0001);
      }
    }
  });

  it('still arrives at the angle asked for', () => {
    for (const [from, to] of [[-171, 189], [10, -350], [0, 540], [33, 33]]) {
      const target = shortestTurn(from, to);
      expect(((target - to) % 360 + 360) % 360).toBeCloseTo(0);
    }
  });
});

describe('a throw with an arc', () => {
  it('rises off the table on the way and comes down where it started', async () => {
    const { scene } = stubScene();
    const card = stubCard();
    let highest = 0;
    const promise = throwCard(scene, card, { x: 300, y: 0 }, { arc: 30, duration: 400, pop: false });
    for (let t = 0; t < 500; t += 16) {
      scene.tweens.update(16);
      highest = Math.max(highest, card.z ?? 0);
    }
    await promise;
    expect(highest).toBeGreaterThan(28);
    expect(card.z).toBe(0);
  });
});
