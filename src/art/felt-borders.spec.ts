import { describe, expect, it } from 'vitest';
import { BORDER_PATTERNS, border } from './felt-borders.js';

describe('border', () => {
  it.each(BORDER_PATTERNS)('%s is clean path data fitted to its length', (pattern) => {
    const mark = border(pattern, { length: 300, height: 16, stroke: 1.4 });
    const paths = [mark.path].flat();
    expect(paths.length).toBeGreaterThan(0);
    for (const d of paths) {
      expect(d).toMatch(/^M/);
      expect(d).not.toMatch(/NaN|Infinity/);
    }
    expect(mark.viewBox).toEqual([-1.4, -1.4, 302.8, 18.8]);
    expect([mark.width, mark.height]).toEqual([302.8, 18.8]);
    // Every point stays inside the band, give or take the curve of a scroll.
    const numbers = paths.join(' ').match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(300 * 1.6);
  });

  it('fits a whole number of repeats, at least one', () => {
    expect([border('dentil', { length: 128, height: 16 }).path].flat()).toHaveLength(11);   // rail and 10 teeth
    expect([border('dentil', { length: 134, height: 16 }).path].flat()).toHaveLength(11);   // stretched, not 10.5
    const short = border('dentil', { length: 4, height: 16 });
    expect([short.path].flat()).toHaveLength(2);   // the rail and one tooth
  });

  it('keeps the Greek key one unbroken line per band', () => {
    const paths = [border('greek-key', { length: 200 }).path].flat();
    expect(paths).toHaveLength(3);   // two rails and the key
    expect(paths[2].match(/M/g)).toHaveLength(1);
  });
});
