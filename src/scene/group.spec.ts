import { describe, expect, it } from 'vitest';
import { Group } from './group.js';
import { Node, NodeHost } from './node.js';
import { Tweens } from './tweens.js';

// A node with nothing to draw, on a board that only counts.
class Dot extends Node {
  constructor(board: NodeHost) { super(board); this.attach(); }
  get width(): number { return 10; }
  get height(): number { return 20; }
  writeInstance(): boolean { return false; }
}

function flatBoard(): NodeHost & { touched: number } {
  const board = {
    distance: Infinity, localLens: true, vanishX: 0, vanishY: 0, touched: 0,
    touch() { board.touched++; }, resort() {}, attach() {}, detach() {},
  };
  return board;
}

describe('groups', () => {
  it('carries a pose out of its frame: moved, turned, scaled', () => {
    const board = flatBoard();
    const seat = new Group(board, { x: 100, y: 50, angle: 90, scale: 0.5 });
    const card = new Dot(board).setPosition(20, 0).setAngle(10);
    card.parent = seat;
    const shown = card.shown;
    expect(shown.x).toBeCloseTo(100);
    expect(shown.y).toBeCloseTo(60);
    expect(shown.angle).toBeCloseTo(100);
    expect(shown.scaleX).toBeCloseTo(0.5);
    // The resting pose is still the group's.
    expect(card.x).toBe(20);
  });

  it('nests, and fromBoard undoes toBoard', () => {
    const board = flatBoard();
    const outer = new Group(board, { x: 10, y: -5, angle: 30, scale: 2 });
    const inner = new Group(board, { x: -40, y: 7, angle: -75, scale: 0.6, parent: outer });
    const p = inner.toBoard(13, 21);
    const back = inner.fromBoard(p.x, p.y);
    expect(back.x).toBeCloseTo(13);
    expect(back.y).toBeCloseTo(21);
    expect(inner.boardAngle).toBeCloseTo(-45);
    expect(inner.boardScale).toBeCloseTo(1.2);
  });

  it('reparents without moving on screen', () => {
    const board = flatBoard();
    const seat = new Group(board, { x: 300, y: 120, angle: 180, scale: 0.7 });
    const card = new Dot(board).setPosition(-12, 33).setAngle(5).setScale(1.1);
    card.parent = seat;
    const before = card.shown;
    card.reparent(undefined);
    const after = card.shown;
    expect(card.parent).toBeUndefined();
    for (const key of ['x', 'y', 'angle', 'scaleX', 'scaleY'] as const) {
      expect(after[key]).toBeCloseTo(before[key]);
    }
    // And back in, to the same place.
    const other = new Group(board, { x: -20, y: 9, angle: 40, scale: 1.5 });
    card.reparent(other);
    const again = card.shown;
    for (const key of ['x', 'y', 'angle', 'scaleX', 'scaleY'] as const) {
      expect(again[key]).toBeCloseTo(before[key]);
    }
  });

  it('picks a node where its group puts it', () => {
    const board = flatBoard();
    const seat = new Group(board, { x: 200, y: 200, angle: 90, scale: 2 });
    const card = new Dot(board);
    card.parent = seat;
    // 10 wide and 20 tall, turned a quarter and doubled: 40 wide, 20 tall.
    expect(card.hitTest(200 + 19, 200)).toBe(true);
    expect(card.hitTest(200, 200 + 11)).toBe(false);
  });

  it('cannot be put inside itself', () => {
    const board = flatBoard();
    const a = new Group(board);
    const b = new Group(board, { parent: a });
    expect(() => { a.parent = b; }).toThrow();
  });
});

describe('timers and counters on the tween clock', () => {
  it('calls back once its delay has run, and not if stopped', () => {
    const tweens = new Tweens();
    let fired = 0;
    tweens.delayedCall(100, () => fired++);
    const cancelled = tweens.delayedCall(100, () => fired += 10);
    cancelled.stop();
    tweens.update(60);
    expect(fired).toBe(0);
    tweens.update(60);
    expect(fired).toBe(1);
    expect(tweens.count).toBe(0);
  });

  it('runs a counter and hands over the eased value', () => {
    const tweens = new Tweens();
    const seen: number[] = [];
    tweens.counter({ from: 10, to: 20, duration: 100, onUpdate: (v) => seen.push(v) });
    tweens.update(50);
    tweens.update(50);
    expect(seen[0]).toBeCloseTo(15);
    expect(seen.at(-1)).toBe(20);
  });

  it('clears everything at once: no callbacks, nothing left running', () => {
    const tweens = new Tweens();
    let fired = 0;
    tweens.delayedCall(10, () => fired++);
    tweens.add({ targets: { x: 0 }, x: 1, duration: 10, onComplete: () => fired++ });
    tweens.tick(() => true);
    tweens.clear();
    tweens.update(50);
    expect(fired).toBe(0);
    expect(tweens.count).toBe(0);
  });
});
