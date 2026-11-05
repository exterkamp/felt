import { describe, expect, it } from 'vitest';
import { easeOf } from './ease.js';
import { Tweens } from './tweens.js';

describe('tweens', () => {
  it('moves a number to where it was asked, and resolves', async () => {
    const tweens = new Tweens();
    const card = { x: 0 };
    const done = tweens.to(card, { x: 100, duration: 100 });
    tweens.update(50);
    expect(card.x).toBeCloseTo(50);
    tweens.update(60);
    expect(card.x).toBe(100);
    await done;
    expect(tweens.count).toBe(0);
  });

  // A stagger of throws: each picks up wherever the card is when it starts.
  it('reads its start value when its delay is over, not when it was made', () => {
    const tweens = new Tweens();
    const card = { x: 0 };
    tweens.add({ targets: card, x: 10, duration: 10 });
    tweens.add({ targets: card, x: 20, duration: 10, delay: 10 });
    tweens.update(10);
    expect(card.x).toBe(10);
    tweens.update(5);
    expect(card.x).toBeCloseTo(15);
  });

  it('comes back again when it yoyos', () => {
    const tweens = new Tweens();
    const card = { scaleX: 1 };
    tweens.add({ targets: card, scaleX: 2, duration: 10, yoyo: true });
    tweens.update(10);
    expect(card.scaleX).toBe(2);
    tweens.update(10);
    expect(card.scaleX).toBe(1);
    expect(tweens.count).toBe(0);
  });

  it('runs onComplete once, and a stopped tween does not run it', () => {
    const tweens = new Tweens();
    let completed = 0;
    tweens.add({ targets: {}, duration: 10, onComplete: () => completed++ });
    const stopped = tweens.add({ targets: {}, duration: 10, onComplete: () => completed++ });
    stopped.stop();
    tweens.flush();
    expect(completed).toBe(1);
  });

  it('knows Phaser-s ease names', () => {
    expect(easeOf('Cubic.easeOut')(0.5)).toBeCloseTo(0.875);
    expect(easeOf('Quad.easeIn')(0.5)).toBeCloseTo(0.25);
    expect(easeOf('Power2')(0.5)).toBeCloseTo(0.875);
    expect(easeOf('Linear')(0.3)).toBeCloseTo(0.3);
    for (const name of ['Sine.easeInOut', 'Back.easeOut', 'Expo.easeIn', 'Quart.easeInOut']) {
      expect(easeOf(name)(0)).toBeCloseTo(0);
      expect(easeOf(name)(1)).toBeCloseTo(1);
    }
  });
});
