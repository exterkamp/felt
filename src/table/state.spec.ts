import { describe, expect, it } from 'vitest';
import { type TableState, cloneState, diffStates, isTableState, sameState, stateFits } from './state.js';

const base = (): TableState => ({
  zones: { stock: ['a', 'b'], 'column-0': ['c', 'd'], waste: [] },
  faceUp: ['d'],
  loose: [{ id: 'e', x: 10, y: 20, angle: 0.5 }],
});

describe('table states', () => {
  it('a clone is equal and shares nothing', () => {
    const a = base();
    const b = cloneState(a);
    expect(sameState(a, b)).toBe(true);
    b.zones.stock.push('x');
    b.loose[0].x = 99;
    expect(a.zones.stock).toEqual(['a', 'b']);
    expect(a.loose[0].x).toBe(10);
  });

  it('order, side and loose position all count', () => {
    const a = base();
    const order = cloneState(a); order.zones.stock.reverse();
    const side = cloneState(a); side.faceUp = ['c', 'd'];
    const lying = cloneState(a); lying.loose[0].y = 30;
    const nudged = cloneState(a); nudged.loose[0].y = 20.2;
    expect(sameState(a, order)).toBe(false);
    expect(sameState(a, side)).toBe(false);
    expect(sameState(a, lying)).toBe(false);
    expect(sameState(a, nudged)).toBe(true);
  });

  it('a diff names what moved, turned, came and went', () => {
    const a = base();
    const b: TableState = {
      zones: { stock: ['a'], 'column-0': ['c', 'd', 'b'], waste: [] },
      faceUp: ['b', 'd'],
      loose: [{ id: 'f', x: 0, y: 0, angle: 0 }],
    };
    const diff = diffStates(a, b);
    expect(diff.moved).toEqual([{ id: 'b', from: 'stock', to: 'column-0' }]);
    expect(diff.flipped).toEqual(['b']);
    expect(diff.added).toEqual(['f']);
    expect(diff.removed).toEqual(['e']);
  });

  it('checks a state read back from storage', () => {
    expect(isTableState(base())).toBe(true);
    expect(isTableState(JSON.parse(JSON.stringify(base())))).toBe(true);
    expect(isTableState(null)).toBe(false);
    expect(isTableState({ zones: [], faceUp: [], loose: [] })).toBe(false);
    expect(isTableState({ ...base(), zones: { a: ['x'], b: ['x'] } })).toBe(false);   // one card in two places
    expect(isTableState({ ...base(), faceUp: ['nobody'] })).toBe(false);
    expect(isTableState({ ...base(), loose: [{ id: 'e', x: 'one', y: 0, angle: 0 }] })).toBe(false);
  });

  it('fits a table only with its zones and cards', () => {
    expect(stateFits(base(), ['stock', 'column-0', 'waste'], 'abcde')).toBe(true);
    expect(stateFits(base(), ['stock', 'waste'], 'abcde')).toBe(false);
    expect(stateFits(base(), ['stock', 'column-0', 'waste'], 'abcd')).toBe(false);
  });
});
