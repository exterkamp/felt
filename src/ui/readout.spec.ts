import { describe, expect, it } from 'vitest';
import { Atlas } from '../gl/atlas.js';
import type { Node } from '../scene/node.js';
import { Tweens } from '../scene/tweens.js';
import { GlyphCache, alignOffset, layoutLine } from './glyphs.js';
import { formatClock } from './format.js';
import { Readout, ReadoutHost } from './readout.js';

/** A board as far as a readout can tell: an atlas, a ratio, tweens, a list. */
function host(pixelRatio = 2): ReadoutHost & { nodes: Node[] } {
  const nodes: Node[] = [];
  const atlas = new Atlas(512);
  const board = {
    distance: Infinity, localLens: true, vanishX: 0, vanishY: 0, pixelRatio, atlas,
    tweens: new Tweens(), services: new Map<string, unknown>(), nodes,
    touch() {}, resort() {},
    attach(node: Node) { nodes.push(node); },
    detach(node: Node) { nodes.splice(nodes.indexOf(node), 1); },
  };
  // Every character 10 wide but a "1" (4) and an "M" (14): proportional figures.
  const width = (text: string) => [...text].reduce((n, c) => n + (c === '1' ? 4 : c === 'M' ? 14 : 10), 0);
  board.services.set('felt:glyphs', new GlyphCache(board, { measure: (_font, text) => width(text), fonts: null }));
  return board;
}

const glyphs = (board: ReadoutHost) => board.services.get('felt:glyphs') as GlyphCache;

describe('layoutLine', () => {
  it('places characters by their advances, and digits tabular', () => {
    const adv = (c: string) => (c === '1' ? 4 : 10);
    expect(layoutLine('11', adv).width).toBe(8);
    const tab = layoutLine('11', adv, { tabular: true, digitAdvance: 10 });
    expect(tab.width).toBe(20);
    expect(tab.places.map((p) => p.x)).toEqual([5, 15]);
    expect(layoutLine('a1', adv, { letterSpacing: 2 }).width).toBe(16);
    expect(alignOffset(20, 'left')).toBe(0);
    expect(alignOffset(20, 'center')).toBe(-10);
    expect(alignOffset(20, 'right')).toBe(-20);
  });
});

describe('Readout', () => {
  it('draws a sprite per character, and spaces as nothing', () => {
    const board = host();
    const r = new Readout(board, { value: 'Stock 24', x: 100, y: 50, align: 'left' });
    expect(r.text).toBe('Stock 24');
    expect(r.sprites.length).toBe(7);
    expect(r.bounds.x).toBe(100);
    expect(r.bounds.width).toBe(80);
  });

  it('keeps its anchor where asked: left, centre or right', () => {
    const board = host(1);
    const right = new Readout(board, { value: 1234, x: 300, align: 'right' });
    // "1,234": four tabular digits at 10 and a comma at 10.
    expect(right.bounds.x + right.bounds.width).toBe(300);
    expect(right.sprites.at(-1)!.x).toBeCloseTo(295, 5);
    const centre = new Readout(board, { value: 'MM', x: 300 });
    expect(centre.bounds.x).toBe(286);
  });

  it('does not shimmy as it counts: tabular digits are one width', () => {
    const board = host();
    const r = new Readout(board, { value: 1111, align: 'right' });
    const ones = r.bounds.width;
    r.set(8888);
    expect(r.bounds.width).toBe(ones);
    const prop = new Readout(board, { value: 1111, tabular: false });
    expect(prop.bounds.width).toBeLessThan(ones);
  });

  it('hammered 500 times paints each glyph once and holds a dozen regions at most', () => {
    const board = host();
    const r = new Readout(board, { value: 0, format: (v) => `Score ${v}` });
    const atlas = board.atlas;
    for (let i = 1; i <= 500; i++) r.set(i * 37);
    const cache = glyphs(board);
    // S c o r e, and ten digits.
    expect(cache.painted).toBeLessThanOrEqual(15);
    expect(atlas.paints).toBe(cache.painted);
    expect(atlas.pages.length).toBe(1);
    expect(cache.size).toBeLessThanOrEqual(15);
    expect(r.text).toBe('Score 18500');
    // The same 500 again paints nothing more.
    const before = atlas.paints;
    for (let i = 1; i <= 500; i++) r.set(i * 37);
    expect(atlas.paints).toBe(before);
  });

  it('shares glyphs between readouts, counted, and lets them go when destroyed', () => {
    const board = host();
    const a = new Readout(board, { value: 11 });
    const b = new Readout(board, { value: 12 });
    const cache = glyphs(board);
    expect(cache.size).toBe(2);
    const one = a.sprites[0].region!;
    expect(b.sprites[0].region).toBe(one);
    expect(one.refs).toBe(1);   // one atlas ref, however many sprites show it
    a.destroy();
    expect(cache.size).toBe(2);
    b.destroy();
    expect(cache.size).toBe(0);
    expect(one.refs).toBe(0);
    expect(board.nodes.length).toBe(0);
  });

  it('colours by tint, so another colour paints nothing', () => {
    const board = host();
    const r = new Readout(board, { value: 42, color: '#ffd166' });
    const before = board.atlas.paints;
    expect(r.sprites[0].tint).toBe(0xffd166);
    r.color = '#ff0000';
    new Readout(board, { value: 24, color: 0x00ff00 });
    expect(r.sprites[0].tint).toBe(0xff0000);
    expect(board.atlas.paints).toBe(before);
  });

  it('snaps each glyph to a canvas pixel at rest', () => {
    const board = host(2);
    const r = new Readout(board, { value: 7, x: 100.3, y: 50.2, align: 'left' });
    const s = r.sprites[0];
    const left = (s.x - s.width / 2) * 2;
    const top = (s.y - s.height / 2) * 2;
    expect(left).toBeCloseTo(Math.round(left), 9);
    expect(top).toBeCloseTo(Math.round(top), 9);
  });

  it('counts up to a new value on the board clock, and pops', () => {
    const board = host();
    const r = new Readout(board, { value: 0, countUp: 400, pop: true });
    r.set(100);
    expect(r.text).toBe('0');
    board.tweens.update(60);
    const mid = Number(r.text);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    expect(r.sprites[0].scale).toBeGreaterThan(1);
    board.tweens.flush();
    expect(r.text).toBe('100');
    expect(r.sprites[0].scale).toBe(1);
    r.set(5, { animate: false });
    expect(r.text).toBe('5');
  });

  it('jumps and stays still under reduced motion', () => {
    const board = host();
    const r = new Readout(board, { value: 0, countUp: 400, pop: true, reducedMotion: true });
    r.set(100);
    expect(r.text).toBe('100');
    expect(board.tweens.count).toBe(0);
  });

  it('formats a clock', () => {
    const board = host();
    const r = new Readout(board, { value: 187_000, format: (ms) => formatClock(ms) });
    expect(r.text).toBe('03:07');
  });

  it('lays out again and repaints when its face arrives', () => {
    const board = host();
    const cache = glyphs(board);
    const r = new Readout(board, { value: 42 });
    const old = r.sprites[0].region!;
    cache.reflow('normal 16px "Jost", "Helvetica Neue", Arial, sans-serif');
    expect(r.sprites[0].region).not.toBe(old);
    expect(old.refs).toBe(0);
    expect(cache.size).toBe(2);
  });
});
