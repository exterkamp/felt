import { describe, expect, it } from 'vitest';
import {
  LID_SWING, Panel, Quad, boxQuads, deckBlockSize, deckRise, flapQuads,
  panelUvs, quadVertices, tuckBoxAtlas, tuckBoxQuads, tuckBoxSize,
} from './tuck-box.js';
import { CARD_ASPECT } from './cards.js';

const SIZE = tuckBoxSize(60);

const span = (quads: Quad[], axis: 'x' | 'y' | 'z') => {
  const all = quads.flatMap((q) => q.corners.map((c) => c[axis]));
  return { low: Math.min(...all), high: Math.max(...all) };
};

describe('the size of a box', () => {
  it('is the card it holds, plus room to get it out', () => {
    const box = tuckBoxSize(60);
    expect(box.width).toBeGreaterThan(60);
    expect(box.width).toBeLessThan(64);
    expect(box.height / box.width).toBeCloseTo(1 / CARD_ASPECT, 2);
  });

  // A box that cannot answer for 32 cards is a box that only ever held one
  // game, so the depth is derived rather than named.
  it('is as deep as the deck in it', () => {
    const full = tuckBoxSize(60, 52);
    const piquet = tuckBoxSize(60, 32);
    const double = tuckBoxSize(60, 104);
    expect(piquet.depth).toBeLessThan(full.depth);
    expect(double.depth).toBeGreaterThan(full.depth);
    // Fifty-two real cards in a real box: about a quarter of the width.
    expect(full.depth / full.width).toBeGreaterThan(0.2);
    expect(full.depth / full.width).toBeLessThan(0.32);
  });

  it('holds the block of cards it is cut for', () => {
    const box = tuckBoxSize(60);
    const deck = deckBlockSize(60);
    for (const axis of ['width', 'height', 'depth'] as const) {
      expect(deck[axis]).toBeLessThan(box[axis]);
    }
  });
});

describe('the body', () => {
  const quads = boxQuads(SIZE);

  it('is five panels, and the same five turned inside out', () => {
    expect(quads).toHaveLength(10);
    // Six rather than five: the five inward panels, and the base, which a box
    // standing on a table shows as the board it is cut from rather than as
    // printing nobody will see.
    expect(quads.filter((q) => q.panel === 'inside')).toHaveLength(6);
  });

  // Back-face culling means the far side of a panel is not drawn, so without
  // the inward set an open box is a box you can see straight through.
  it('gives every outward panel an inward twin wound the other way', () => {
    const out = quads.slice(0, 5);
    const inward = quads.slice(5);
    out.forEach((face, i) => {
      expect(inward[i].corners[0]).toEqual(face.corners[1]);
      expect(inward[i].corners[1]).toEqual(face.corners[0]);
    });
  });

  it('is open at the top and closed everywhere else', () => {
    const y = span(quads, 'y');
    expect(y.high).toBeCloseTo(SIZE.height / 2);
    expect(y.low).toBeCloseTo(-SIZE.height / 2);
    // Nothing lies in the plane of the opening: that is what the lid is for.
    const lidPlane = quads.filter((q) => q.corners.every((c) => c.y > SIZE.height / 2 - 0.01));
    expect(lidPlane).toHaveLength(0);
  });

  // One atlas rect serves both sides, so exactly one of them has to be
  // mirrored or the name down the spine reads backwards on one side.
  it('mirrors one side and not the other', () => {
    const sides = quads.filter((q) => q.panel === 'side');
    expect(sides).toHaveLength(2);
    expect(sides.filter((q) => q.flip)).toHaveLength(1);
  });
});

describe('the lid and its tab', () => {
  it('lies flat across the opening when the box is shut', () => {
    const [lid] = flapQuads(SIZE, 0);
    for (const corner of lid.corners) {
      expect(corner.y).toBeCloseTo(SIZE.height / 2, 5);
    }
    // Hinged at the back, reaching the front.
    expect(lid.corners[0].z).toBeCloseTo(SIZE.depth / 2, 5);
    expect(lid.corners[2].z).toBeCloseTo(-SIZE.depth / 2, 5);
  });

  // The fold that makes it a tuck box rather than a lid: shut, the tab hangs
  // *down inside the front panel*. Animating only the lid's own fold sent it
  // sweeping back through the box, which is what this pins down.
  it('tucks the tab down inside the front when shut', () => {
    const [, tab] = flapQuads(SIZE, 0);
    const bottom = tab.corners[2];
    expect(bottom.y).toBeCloseTo(SIZE.height / 2 - SIZE.tab, 5);
    expect(bottom.z).toBeCloseTo(-SIZE.depth / 2, 5);
    // And it is inside the box, not out the back of it.
    for (const corner of tab.corners) {
      expect(corner.z).toBeLessThanOrEqual(SIZE.depth / 2 + 1e-6);
    }
  });

  it('swings the lid up and back, past upright', () => {
    const [lid] = flapQuads(SIZE, 1);
    const tip = lid.corners[2];
    expect(tip.y).toBeGreaterThan(SIZE.height / 2);
    // Past the vertical: the tip has gone behind the hinge.
    expect(tip.z).toBeGreaterThan(SIZE.depth / 2);
    expect(LID_SWING).toBeGreaterThan(Math.PI / 2);
  });

  it('straightens the tab into line with the lid before the lid is up', () => {
    const inLine = (open: number) => {
      const [lid, tab] = flapQuads(SIZE, open);
      const lidDir = { y: lid.corners[2].y - lid.corners[0].y, z: lid.corners[2].z - lid.corners[0].z };
      const tabDir = { y: tab.corners[2].y - tab.corners[0].y, z: tab.corners[2].z - tab.corners[0].z };
      const cross = lidDir.y * tabDir.z - lidDir.z * tabDir.y;
      const len = Math.hypot(lidDir.y, lidDir.z) * Math.hypot(tabDir.y, tabDir.z);
      return Math.abs(cross / len);
    };
    // A right angle when shut, and flat by the time the lid is two-thirds up.
    expect(inLine(0)).toBeCloseTo(1, 2);
    expect(inLine(0.7)).toBeCloseTo(0, 2);
  });

  it('is four quads - both sides of both folds', () => {
    const flaps = flapQuads(SIZE, 0.5);
    expect(flaps).toHaveLength(4);
    expect(flaps.filter((q) => q.panel === 'inside')).toHaveLength(2);
  });
});

describe('the deck coming out', () => {
  // A deck cannot come out through a lid that is still over it.
  it('does not move until the lid is most of the way back', () => {
    expect(deckRise(0)).toBe(0);
    expect(deckRise(0.5)).toBe(0);
    expect(deckRise(1)).toBeCloseTo(1);
  });

  it('starts and stops smoothly rather than at speed', () => {
    const step = deckRise(0.6) - deckRise(0.56);
    const middle = deckRise(0.8) - deckRise(0.76);
    expect(middle).toBeGreaterThan(step);
  });
});

describe('where the artwork goes', () => {
  const atlas = tuckBoxAtlas(SIZE, 6);
  const panels: Panel[] = ['face', 'side', 'lid', 'tab', 'inside', 'leaves'];

  it('fits every panel inside the texture', () => {
    for (const panel of panels) {
      const r = atlas.rects[panel];
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(atlas.width);
      expect(r.y + r.height).toBeLessThanOrEqual(atlas.height);
    }
  });

  // Two panels sharing pixels is one panel wearing the other's artwork.
  it('does not let two panels overlap', () => {
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = atlas.rects[panels[i]];
        const b = atlas.rects[panels[j]];
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x
          || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${panels[i]} overlaps ${panels[j]}`).toBe(true);
      }
    }
  });

  it('prints each panel at its own shape', () => {
    const face = atlas.rects.face;
    expect(face.width / face.height).toBeCloseTo(SIZE.width / SIZE.height, 1);
    expect(atlas.rects.side.width / face.width).toBeCloseTo(SIZE.depth / SIZE.width, 1);
  });

  it('keeps every uv on the texture, and mirrors when asked', () => {
    for (const panel of panels) {
      const uvs = panelUvs(atlas, panel);
      for (const v of uvs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      const flipped = panelUvs(atlas, panel, true);
      expect(flipped[0]).toBeCloseTo(uvs[2]);
      expect(flipped[2]).toBeCloseTo(uvs[0]);
    }
  });
});

// Phaser expands an index array into one vertex per *index*, so anything that
// writes new positions into a built mesh has to walk the vertices in exactly
// the order they were made. Both the building and the re-laying go through
// `quadVertices` for that reason, and this is the contract between them.
describe('quads as triangles', () => {
  const atlas = tuckBoxAtlas(SIZE, 6);

  it('is six vertices a quad, two triangles round it', () => {
    const quad = boxQuads(SIZE)[0];
    const { positions, uvs } = quadVertices([quad], atlas);
    expect(positions).toHaveLength(18);
    expect(uvs).toHaveLength(12);
    const corner = (i: number) => positions.slice(i * 3, i * 3 + 3);
    expect(corner(0)).toEqual([quad.corners[0].x, quad.corners[0].y, quad.corners[0].z]);
    expect(corner(3)).toEqual(corner(0));
    expect(corner(2)).toEqual(corner(4));
  });

  it('scales every coordinate by the unit it is given', () => {
    const one = quadVertices(boxQuads(SIZE), atlas, 1).positions;
    const two = quadVertices(boxQuads(SIZE), atlas, 2).positions;
    expect(two.map((v) => v / 2)).toEqual(one);
  });

  it('gives a whole box the same count however far open it is', () => {
    const shut = quadVertices(tuckBoxQuads(SIZE, 0), atlas).positions.length;
    const open = quadVertices(tuckBoxQuads(SIZE, 1), atlas).positions.length;
    expect(open).toBe(shut);
    expect(shut / 18).toBe(14);
  });
});
