import { describe, expect, it } from 'vitest';
import { ManualClock } from './clock.js';
import { Disposables } from './disposables.js';
import { Engine, createEngine, engine } from './engine.js';
import { PageLifecycle } from './lifecycle.js';

const manual = (options = {}) => {
  const clock = new ManualClock(1000 / 60);
  return { clock, engine: createEngine({ clock, lifecycle: null, ...options }) };
};

describe('the engine loop', () => {
  it('sleeps when nothing asks for a frame, and wakes when asked', () => {
    const { clock, engine } = manual();
    let frames = 0;
    let wanted = 3;
    engine.add({ frame: () => { frames++; return --wanted > 0; } });
    clock.advance(1000);
    expect(frames).toBe(3);
    expect(clock.pending).toBe(false);
    wanted = 1;
    engine.wake();
    clock.advance(1000);
    expect(frames).toBe(4);
  });

  it('runs fixed steps on simulation time, whatever the frame rate', () => {
    const clock = new ManualClock(10);
    const engine = createEngine({ clock, lifecycle: null, fixedStep: 50 });
    const at: number[] = [];
    const stop = engine.onFixedUpdate((step, sim) => at.push(sim));
    clock.advance(1000);
    // The first frame is counted as one display frame (16.7 ms), not 10.
    expect(at.length).toBe(20);
    expect(at.every((t, i) => t === (i + 1) * 50)).toBe(true);
    stop();
    expect(clock.pending).toBe(true);   // the frame already asked for
    clock.advance(100);
    expect(clock.pending).toBe(false);  // and then it sleeps
  });

  it('drops what it cannot catch up on rather than spiralling', () => {
    const clock = new ManualClock(1000 / 60);
    const e = createEngine({ clock, lifecycle: null, fixedStep: 10, maxSteps: 3, maxDelta: 1000 });
    let steps = 0;
    e.onFixedUpdate(() => steps++);
    clock.frame(1);       // the first frame counts as one display frame
    const before = steps;
    clock.frame(500);     // one long frame: 50 steps owed
    expect(steps - before).toBe(3);
    expect(e.droppedSteps).toBeGreaterThan(40);
  });

  it('clamps a long frame to maxDelta', () => {
    const { clock, engine } = manual({ maxDelta: 100 });
    const deltas: number[] = [];
    const stop = engine.onUpdate((d) => deltas.push(d));
    clock.frame(16);
    clock.frame(5000);
    stop();
    expect(deltas[1]).toBe(100);
  });

  it('stops while the page is away, and on return drops the gap and redraws', () => {
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const win = new EventTarget();
    const lifecycle = new PageLifecycle({ document: doc, window: win });
    const clock = new ManualClock(1000 / 60);
    const e = new Engine({ clock, lifecycle });
    const seen: string[] = [];
    const deltas: number[] = [];
    e.add({ frame: (d) => { deltas.push(d); return false; }, lifecycle: (ev) => seen.push(ev.type) });
    clock.advance(50);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    e.wake();
    expect(clock.pending).toBe(false);
    clock.advance(10_000);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    expect(clock.pending).toBe(true);
    clock.advance(20);
    expect(seen).toEqual(['suspend', 'resume']);
    // The frame after coming back is one frame long, not ten seconds.
    expect(deltas[deltas.length - 1]).toBeLessThan(20);
  });

  it('disposes its services and forgets its members when destroyed', () => {
    const { clock, engine } = manual();
    let disposed = 0;
    engine.services.set('x', { dispose: () => disposed++ });
    let frames = 0;
    engine.add({ frame: () => { frames++; return true; } });
    clock.advance(50);
    engine.destroy();
    clock.advance(50);
    const after = frames;
    clock.advance(500);
    expect(frames).toBe(after);
    expect(disposed).toBe(1);
  });

  it('is one per page, made again once destroyed', () => {
    const a = engine();
    expect(engine()).toBe(a);
    a.destroy();
    expect(engine()).not.toBe(a);
  });
});

describe('disposables', () => {
  it('tears down newest first, and keeps going past a throw', () => {
    const order: number[] = [];
    const scope = new Disposables();
    scope.add(() => order.push(1));
    scope.add(() => { throw new Error('x'); });
    scope.add(() => order.push(3));
    const quiet = console.error;
    console.error = () => {};
    scope.dispose();
    console.error = quiet;
    expect(order).toEqual([3, 1]);
    scope.add(() => order.push(4));
    expect(order).toEqual([3, 1, 4]);
  });
});
