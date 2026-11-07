import { describe, expect, it } from 'vitest';
import { ToastQueue, durationFor } from './toast-queue.js';

const phases = (q: ToastQueue) => q.all.map((t) => `${t.text}:${t.phase}`);

describe('ToastQueue', () => {
  it('comes in, stays for its duration, goes, and is gone', () => {
    const q = new ToastQueue({ enter: 100, exit: 100 });
    const t = q.push({ text: 'Nice!', duration: 1000 });
    expect(t.phase).toBe('entering');
    q.step(100);
    expect(t.phase).toBe('shown');
    q.step(999);
    expect(t.phase).toBe('shown');
    q.step(1);
    expect(t.phase).toBe('leaving');
    expect(q.step(100)).toEqual([t]);
    expect(t.phase).toBe('gone');
    expect(q.busy).toBe(false);
  });

  it('stacks up to three at an edge and queues the rest, oldest first', () => {
    const q = new ToastQueue({ enter: 10, exit: 10 });
    for (const text of ['a', 'b', 'c', 'd', 'e']) q.push({ text, duration: 100 });
    expect(phases(q)).toEqual(['a:entering', 'b:entering', 'c:entering', 'd:queued', 'e:queued']);
    q.step(10);
    q.step(100);   // a, b, c leave; d and e come on as they go
    expect(q.showing('top').map((t) => t.phase)).toEqual(['leaving', 'leaving', 'leaving', 'entering', 'entering']);
    q.step(10);
    expect(phases(q)).toEqual(['d:shown', 'e:shown']);
  });

  it('shows one in the centre at a time', () => {
    const q = new ToastQueue({ enter: 10, exit: 10 });
    q.push({ text: "Player 2's turn", place: 'center', duration: 50 });
    q.push({ text: "Player 3's turn", place: 'center', duration: 50 });
    expect(phases(q)).toEqual(["Player 2's turn:entering", "Player 3's turn:queued"]);
    q.step(60);
    expect(phases(q)).toEqual(["Player 2's turn:leaving", "Player 3's turn:entering"]);
  });

  it('counts the same toast again instead of showing it twice, and restarts its time', () => {
    const q = new ToastQueue({ enter: 10, exit: 10 });
    const first = q.push({ text: 'Nice!', duration: 100 });
    q.step(80);
    const again = q.push({ text: 'Nice!', duration: 100 });
    expect(again).toBe(first);
    expect(first.count).toBe(2);
    expect(first.age).toBe(0);
    q.step(90);
    expect(first.phase).toBe('shown');
    // By key, too.
    expect(q.push({ text: 'Other', key: 'k' })).toBe(q.push({ text: 'Other again', key: 'k' }));
  });

  it('never queues floats: past the cap the oldest goes early, and repeats are separate', () => {
    const q = new ToastQueue({ enter: 10, exit: 10, maxVisible: { float: 2 } });
    const a = q.push({ text: '+10', place: 'float', duration: 500 });
    const b = q.push({ text: '+10', place: 'float', duration: 500 });
    expect(a).not.toBe(b);
    const c = q.push({ text: '+10', place: 'float', duration: 500 });
    expect([a.phase, b.phase, c.phase]).toEqual(['leaving', 'entering', 'entering']);
  });

  it('lets urgent ones jump the queue and push the oldest off', () => {
    const q = new ToastQueue({ enter: 10, exit: 10, maxVisible: { top: 1 } });
    q.push({ text: 'a', duration: 1000 });
    q.push({ text: 'b', duration: 1000 });
    q.push({ text: 'No moves left', duration: 1000, urgent: true });
    expect(phases(q)).toEqual(['a:leaving', 'No moves left:entering', 'b:queued']);
  });

  it('drops the stalest waiting toasts beyond its queue', () => {
    const q = new ToastQueue({ maxVisible: { top: 1 }, maxQueued: 2 });
    for (const text of ['a', 'b', 'c', 'd', 'e']) q.push({ text });
    expect(phases(q)).toEqual(['a:entering', 'd:queued', 'e:queued']);
    expect(q.dropped).toBe(2);
  });

  it('dismisses: a shown toast leaves, a queued one is dropped', () => {
    const q = new ToastQueue({ enter: 10, exit: 100, maxVisible: { top: 1 } });
    const a = q.push({ text: 'a', duration: Infinity });
    const b = q.push({ text: 'b' });
    q.dismiss(b.id);
    expect(b.phase).toBe('gone');
    q.step(20);
    expect(a.phase).toBe('shown');
    q.step(100_000);
    expect(a.phase).toBe('shown');   // sticky until dismissed
    q.dismiss(a.id);
    expect(a.phase).toBe('leaving');
    q.step(100);
    expect(q.busy).toBe(false);
  });

  it('leaves from where it had got to when dismissed half way in', () => {
    const q = new ToastQueue({ enter: 100, exit: 100 });
    const t = q.push({ text: 'x' });
    q.step(25);
    q.dismiss(t.id);
    expect(t.phase).toBe('leaving');
    expect(q.progress(t)).toBeCloseTo(0.75);
  });

  it('gives longer messages longer', () => {
    expect(durationFor('+1')).toBe(2000);
    expect(durationFor('You moved the seven of hearts to column three')).toBeGreaterThan(4000);
    expect(durationFor('x'.repeat(500))).toBe(7000);
  });
});
