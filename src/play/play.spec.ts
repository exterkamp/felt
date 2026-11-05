import { describe, expect, it } from 'vitest';
import { defineHand, defineStack, handPositions, stackDepths } from '../core/index.js';
import { Tweens } from '../scene/tweens.js';
import { flipCard } from './flip.js';
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
