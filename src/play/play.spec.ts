import { describe, expect, it } from 'vitest';
import { defineHand, defineStack, handPositions, stackDepths } from '../core/index.js';
import { animatorOf } from '../scene/animator.js';
import { Tweens } from '../scene/tweens.js';
import { flipCard } from './flip.js';
import { popCard, throwCard } from './flight.js';
import { layHand, orderStack } from './order.js';
import { RIFFLE_DEPTH, riffleShuffle } from './riffle.js';

const host = () => ({ tweens: new Tweens() });

function card(i = 0) {
  return { i, x: 0, y: 0, z: 0, angle: 0, depth: 0, bow: 0, tilt: 0, turn: 0, scaleX: 1, scaleY: 1 };
}

describe('ordering a stack', () => {
  it('gives the oldest card the front on a first-on-top pile', () => {
    const stack = defineStack({ id: 's', x: 0, y: 0, fan: 'up', step: 20, order: 'first-on-top' });
    const cards = [card(), card(), card()];
    orderStack(cards, stack, 100);
    expect(cards.map((c) => c.depth)).toEqual(stackDepths(stack, 3).map((d) => d + 100));
    expect(cards[0].depth).toBeGreaterThan(cards[2].depth);
  });
});

describe('re-fanning a hand', () => {
  const hand = defineHand({ id: 'h', x: 100, y: 300, step: 10, maxSpread: 0, radius: 200, facing: 180 });

  it('takes the short way round to every place', () => {
    const h = host();
    const cards = [card(), card(), card()];
    // Reporting -171 for a place at 189: the same angle.
    cards.forEach((c, i) => { c.angle = handPositions(hand, 3)[i].angle - 360; });
    layHand(h, cards, hand);
    h.tweens.flush();
    cards.forEach((c, i) => {
      expect(Math.abs(c.angle - (handPositions(hand, 3)[i].angle - 360))).toBeLessThan(1e-6);
    });
  });

  it('leaves a card in flight to the throw', () => {
    const h = host();
    const cards = [card(), card()];
    layHand(h, cards, hand, { except: [cards[1]], duration: 0 });
    expect(cards[1].x).toBe(0);
    expect(cards[0].x).not.toBe(0);
  });
});

describe('the riffle', () => {
  const stack = defineStack({ id: 'deck', x: 240, y: 300 });

  it('parts the deck, bends it, and squares it up where it was', async () => {
    const h = host();
    const cards = Array.from({ length: 52 }, (_, i) => card(i));
    let widest = 0;
    let deepest = 0;
    const done = riffleShuffle(h, cards, stack, { random: () => 0.37 });
    for (let i = 0; i < 400 && h.tweens.count >= 0; i++) {
      h.tweens.update(16);
      await Promise.resolve();
      const xs = cards.map((c) => c.x);
      widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
      deepest = Math.max(deepest, ...cards.map((c) => c.bow));
    }
    await done;
    expect(widest).toBeGreaterThan(100);
    expect(deepest).toBeGreaterThan(0.2);
    expect(cards.every((c) => c.x === 240 && c.y === 300)).toBe(true);
    expect(cards.every((c) => c.bow === 0 && c.tilt === 0 && c.turn === 0 && c.z === 0)).toBe(true);
    // In the order it was in, and drawn that way rather than in the riffle's band.
    expect(cards.map((c) => c.depth)).toEqual(stackDepths(stack, 52));
    expect(cards.every((c) => c.depth < RIFFLE_DEPTH)).toBe(true);
  });
});

describe('canned animations, tapped fast', () => {
  const flippable = () => ({
    ...card(), card: { faceUp: false },
    setFaceUp(up: boolean) { this.card.faceUp = up; },
  });

  // A host whose animator debounces on a clock the test turns.
  function clocked() {
    const h = host();
    const clock = { now: 0 };
    animatorOf(h).now = () => clock.now;
    const run = (ms: number, each?: () => void) => {
      for (let left = ms; left > 0; left -= 10) { clock.now += 10; h.tweens.update(10); each?.(); }
    };
    return { h, clock, run };
  }

  // The first bug: a flip tapped mid-flip lifted from the first one's height,
  // and a few quick taps left the card floating - and, through the lens,
  // larger. The second: once that was fixed, every tap queued a whole flip.
  it('a burst of taps is one flip, on the table, at once', async () => {
    const { h, run } = clocked();
    const sprite = flippable();
    let highest = 0;
    const flips = [];
    for (let i = 0; i < 12; i++) {
      flips.push(flipCard(h, sprite, { lift: 18 }));
      run(40, () => { highest = Math.max(highest, sprite.z); });
    }
    run(400, () => { highest = Math.max(highest, sprite.z); });
    await Promise.all(flips);
    expect(highest).toBeLessThanOrEqual(18.0001);
    expect(sprite.z).toBe(0);
    expect(sprite.turn).toBe(0);
    expect(sprite.card.faceUp).toBe(true);
    expect(animatorOf(h).busy(sprite, 'flip')).toBe(false);
  });

  it('a tap during a flip waits as one more flip, and a third calls it off', async () => {
    const { h, run } = clocked();
    const sprite = flippable();
    let flips = 0;
    const was = sprite.setFaceUp;
    sprite.setFaceUp = function (up: boolean) { flips++; was.call(this, up); };
    void flipCard(h, sprite);              // to face up
    run(150);
    void flipCard(h, sprite);              // then back down
    expect(animatorOf(h).intent(sprite, 'flip')).toBe(false);
    run(150);
    void flipCard(h, sprite);              // no: stay up
    expect(animatorOf(h).intent(sprite, 'flip')).toBe(true);
    run(800);
    expect(flips).toBe(1);
    expect(sprite.card.faceUp).toBe(true);
  });

  it('taps a flip apart are a flip each', async () => {
    const { h, run } = clocked();
    const sprite = flippable();
    for (let i = 0; i < 3; i++) { void flipCard(h, sprite); run(400); }
    expect(sprite.card.faceUp).toBe(true);
    void flipCard(h, sprite);
    run(400);
    expect(sprite.card.faceUp).toBe(false);
  });

  it('saying which side is not debounced, and saying it twice is once', async () => {
    const { h, run } = clocked();
    const sprite = flippable();
    const a = flipCard(h, sprite, { faceUp: true });
    const b = flipCard(h, sprite, { faceUp: true });
    expect(b).toBe(a);
    void flipCard(h, sprite, { faceUp: false });
    expect(animatorOf(h).intent(sprite, 'flip')).toBe(false);
    run(800);
    expect(sprite.card.faceUp).toBe(false);
  });

  it('a throw thrown again to the same place carries on', async () => {
    const { h, run } = clocked();
    const sprite = card();
    const first = throwCard(h, sprite, { x: 200, y: 0 }, { duration: 300, pop: false });
    run(100);
    const x = sprite.x;
    expect(throwCard(h, sprite, { x: 200, y: 0 }, { duration: 300, pop: false })).toBe(first);
    run(10);
    expect(sprite.x).toBeGreaterThan(x);
    run(400);
    await first;
    expect(sprite.x).toBe(200);
  });

  it('a pop popped again does not grow the card', async () => {
    const h = host();
    const sprite = card();
    for (let i = 0; i < 10; i++) {
      void popCard(h, sprite);
      h.tweens.update(30);
    }
    h.tweens.flush();
    expect(sprite.scaleX).toBeCloseTo(1, 9);
  });

  it('a re-fan leaves a card in flight to its throw', async () => {
    const h = host();
    const hand = defineHand({ id: 'h', x: 100, y: 300, step: 10, maxSpread: 0, radius: 200 });
    const cards = [card(), card()];
    const thrown = throwCard(h, cards[1], { hand, count: 1 }, { duration: 300, pop: false });
    h.tweens.update(50);
    layHand(h, cards, hand, { duration: 100 });
    h.tweens.flush();
    await thrown;
    const places = handPositions(hand, 2);
    expect(cards[1].x).toBeCloseTo(places[1].x);
    expect(cards[0].x).toBeCloseTo(places[0].x);
  });
});

describe('flipping a card', () => {
  it('rolls half a turn, lifting, and lands the other side up', async () => {
    const h = host();
    const sprite = {
      ...card(), card: { faceUp: false },
      setFaceUp(up: boolean) { this.card.faceUp = up; },
    };
    let lifted = 0;
    let rolled = 0;
    const done = flipCard(h, sprite);
    for (let i = 0; i < 40; i++) {
      h.tweens.update(16);
      lifted = Math.max(lifted, sprite.z);
      rolled = Math.max(rolled, sprite.turn);
    }
    await done;
    expect(lifted).toBeGreaterThan(15);
    expect(rolled).toBeGreaterThan(3);
    expect(sprite.card.faceUp).toBe(true);
    expect(sprite.turn).toBe(0);
    expect(sprite.z).toBe(0);
  });
});
