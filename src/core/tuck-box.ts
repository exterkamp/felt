import { CARD_ASPECT } from './cards.js';

// The box a deck comes in, as numbers.
//
// Everything here is arithmetic - corners in model space, and where each
// panel lands on one texture - so that the shape of a tuck box can be tested
// without a renderer. The Phaser half (phaser/tuck-box.ts) does nothing but
// hand these numbers to a Mesh and print the texture this file measures.
//
// Model space is the mesh's, not the board's: x right, **y up**, z away from
// the camera. Phaser negates a vertex's y on its way to the screen, so a box
// built with the board's y-down convention comes out upside down - which is
// how this was first drawn. The box is centred on the origin, so the front
// panel is the one at -z and the lid is at +y.
//
// A tuck box is one piece of card folded into a tube with a flap at each end,
// and the flap is the whole reason this is not a cube with a texture on it.
// The top flap is hinged at the back edge and carries a tab that folds again
// and tucks down inside the front - which is the join you actually look at
// when somebody opens a deck, and the thing that says "paper" rather than
// "box".

/** How thick a deck of this many cards is, as a fraction of a card's width. */
//
// A playing card is about 0.3mm and a poker card is 63mm across, so 52 of
// them is a shade over a quarter of the width. Worth deriving rather than
// naming: a piquet deck and a double deck are the same box at a different
// depth, and a box that cannot answer for 32 cards is a box that only ever
// held one game.
const LEAF = 0.3 / 63;

/** The room the card needs beyond its own size to go in and come out. */
const SLACK = 0.035;

export interface TuckBoxSize {
  /** Across the printed face. */
  width: number;
  /** Down it. */
  height: number;
  /** Through the box - how thick the deck inside is. */
  depth: number;
  /** How far the tab folds down inside the front panel. */
  tab: number;
}

/**
 * A box around a deck of this many cards.
 *
 * Sized from the card rather than named outright, so a box is always the box
 * for the deck it is holding.
 */
export function tuckBoxSize(cardWidth: number, cards = 52): TuckBoxSize {
  const width = cardWidth * (1 + SLACK);
  return {
    width,
    height: (cardWidth / CARD_ASPECT) * (1 + SLACK),
    depth: cardWidth * LEAF * cards + cardWidth * SLACK,
    // A quarter of the way down the front, which is what a tuck tab is on
    // every deck anybody has opened.
    tab: (cardWidth / CARD_ASPECT) * 0.24,
  };
}

/** The block of cards inside, which is a box with no flap. */
export function deckBlockSize(cardWidth: number, cards = 52): TuckBoxSize {
  return {
    width: cardWidth,
    height: cardWidth / CARD_ASPECT,
    depth: cardWidth * LEAF * cards,
    tab: 0,
  };
}

export interface Vec3 { x: number; y: number; z: number; }

/** Which printed panel a quad shows. */
export type Panel = 'face' | 'side' | 'lid' | 'tab' | 'inside' | 'leaves';

/**
 * One flat panel: four corners, and which bit of the texture goes on it.
 *
 * Corners run top-left, top-right, bottom-right, bottom-left *as the panel is
 * printed*, so the artwork lands the right way up on a panel whichever
 * direction it faces in the box.
 */
export interface Quad {
  panel: Panel;
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** Mirrored across the panel's own width - the inside of a flap. */
  flip?: boolean;
}

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * A closed box: five panels out and five in.
 *
 * The inward set is not waste. Back-face culling means the far side of a
 * panel is not drawn, so a box with only outward panels is a box you can see
 * straight through the moment its lid is open - and what you see through it
 * is the felt. The second set is the board's own unprinted inside, which is
 * what is actually there.
 */
export function boxQuads(size: TuckBoxSize, sides: Panel = 'side',
  face: Panel = 'face',
  // The base is board rather than printing by default. It is the one panel a
  // box on a table never shows, and leaving it unprinted gives the box a
  // visible foot to stand on instead of a colour that runs off the bottom.
  bottom: Panel = 'inside'): Quad[] {
  const x = size.width / 2;
  const y = size.height / 2;
  const z = size.depth / 2;

  const quads: Quad[] = [
    // The printed front, towards the camera at -z.
    { panel: face, corners: [at(-x, y, -z), at(x, y, -z), at(x, -y, -z), at(-x, -y, -z)] },
    // And the back, read from its own side, so its artwork is not mirrored.
    { panel: face, corners: [at(x, y, z), at(-x, y, z), at(-x, -y, z), at(x, -y, z)] },
    // The two sides carry the same printing, and one of them has to be
    // mirrored across it or the name down the spine reads backwards on
    // whichever side you happen to be looking at.
    { panel: sides, corners: [at(-x, y, z), at(-x, y, -z), at(-x, -y, -z), at(-x, -y, z)] },
    { panel: sides, flip: true,
      corners: [at(x, y, -z), at(x, y, z), at(x, -y, z), at(x, -y, -z)] },
    // The bottom, seen from below.
    { panel: bottom, corners: [at(-x, -y, -z), at(x, -y, -z), at(x, -y, z), at(-x, -y, z)] },
  ];

  // The same five turned inside out. Wound the other way round, so whichever
  // of the two is facing the camera is the one that gets drawn.
  const inward = quads.map((quad): Quad => ({
    panel: 'inside',
    corners: [quad.corners[1], quad.corners[0], quad.corners[3], quad.corners[2]],
  }));

  return [...quads, ...inward];
}

/**
 * The lid and its tab, at some fraction open.
 *
 * Two folds rather than one, which is what a tuck box actually has: the lid
 * swings up on the crease at the back edge, and the tab - which is tucked
 * down inside the front panel when the box is shut - straightens out as the
 * lid rises. Animating only the first fold gives a box whose tab sweeps a
 * quarter-circle through the front panel it is supposed to be behind.
 *
 * `open` runs 0 (shut) to 1 (lid laid back past the vertical, where a real
 * one rests once the crease has been broken).
 */
export function flapQuads(size: TuckBoxSize, open: number): Quad[] {
  const t = Math.max(0, Math.min(1, open));
  const x = size.width / 2;
  const y = size.height / 2;
  const z = size.depth / 2;

  // The hinge is the crease along the top of the back panel, at (+y, +z).
  const lid = t * LID_SWING;
  // The tab is folded a right angle under the lid when the box is shut - so
  // that it hangs down inside the front panel, which is where a tuck tab
  // actually is - and straightens into line with the lid as the box opens.
  // It straightens ahead of the lid, because on a real box the tab has to be
  // clear of the front panel before the lid is halfway up.
  const tuck = -(Math.PI / 2) * (1 - Math.min(1, t * 1.6));

  // Lid: from the hinge, forward over the opening. Shut, it runs from +z to
  // -z at the top of the box; open, it swings up and back.
  const tipY = y + Math.sin(lid) * size.depth;
  const tipZ = z - Math.cos(lid) * size.depth;

  // Tab: from the lid's tip, folded down by `tuck` about the lid's own edge.
  const tabAngle = lid + tuck;
  const tabY = tipY + Math.sin(tabAngle) * size.tab;
  const tabZ = tipZ - Math.cos(tabAngle) * size.tab;

  const lidOut: Quad = {
    panel: 'lid',
    corners: [at(-x, y, z), at(x, y, z), at(x, tipY, tipZ), at(-x, tipY, tipZ)],
  };
  const tabOut: Quad = {
    panel: 'tab',
    corners: [at(-x, tipY, tipZ), at(x, tipY, tipZ), at(x, tabY, tabZ), at(-x, tabY, tabZ)],
  };

  // Both sides of both folds. Paper is printed on one face and board on the
  // other, and an open lid shows you the board.
  return [lidOut, tabOut, back(lidOut), back(tabOut)];
}

/** The unprinted side of a flap, which is board rather than artwork. */
function back(quad: Quad): Quad {
  return {
    panel: 'inside',
    corners: [quad.corners[1], quad.corners[0], quad.corners[3], quad.corners[2]],
  };
}

/** How far the lid swings at fully open - past upright, as a broken crease sits. */
export const LID_SWING = Math.PI * 0.86;

/**
 * Every quad of a box at a given lid position, in a stable order.
 *
 * Kept for a caller that wants the whole box as one mesh. The renderer here
 * does not: a lid laid back is *behind* the deck coming out, and the body is
 * in front of it, and one mesh cannot be both - see phaser/tuck-box.ts.
 */
export function tuckBoxQuads(size: TuckBoxSize, open: number): Quad[] {
  return [...boxQuads(size), ...flapQuads(size, open)];
}

/**
 * How far the deck has risen out of the box.
 *
 * Nothing moves until the lid is most of the way back, because a deck cannot
 * come out through a lid that is still over it - and then it comes out
 * smoothly rather than starting at speed.
 */
export function deckRise(open: number): number {
  const t = Math.max(0, Math.min(1, (open - 0.55) / 0.45));
  return t * t * (3 - 2 * t);
}

// --- where the artwork goes -----------------------------------------------

export interface AtlasRect { x: number; y: number; width: number; height: number; }

export interface TuckBoxAtlas {
  width: number;
  height: number;
  rects: Record<Panel, AtlasRect>;
}

/**
 * One texture, with every panel on it.
 *
 * A Mesh has a single texture, so the box's six printed surfaces have to
 * share one - and both the thing that draws the artwork and the thing that
 * maps it onto the corners have to agree about where each panel landed. They
 * agree by both calling this.
 *
 * Packed in the order a box is printed rather than tightly: a tuck box is a
 * handful of rectangles and the room saved by a real packer is room nobody
 * needed.
 */
export function tuckBoxAtlas(size: TuckBoxSize, scale: number): TuckBoxAtlas {
  const px = (v: number) => Math.max(1, Math.round(v * scale));
  const pad = 2;

  const face = { x: pad, y: pad, width: px(size.width), height: px(size.height) };
  const side = { x: face.x + face.width + pad, y: pad, width: px(size.depth), height: face.height };
  const lid = { x: pad, y: face.y + face.height + pad, width: face.width, height: side.width };
  const tab = { x: pad, y: lid.y + lid.height + pad, width: face.width, height: px(size.tab) };
  const inside = { x: side.x, y: lid.y, width: side.width, height: lid.height };
  const leaves = { x: side.x, y: tab.y, width: side.width, height: tab.height };

  return {
    width: side.x + side.width + pad,
    height: tab.y + tab.height + pad,
    rects: { face, side, lid, tab, inside, leaves },
  };
}

/**
 * A box's quads as triangles: six vertices each, positions and UVs together.
 *
 * Phaser's `addVertices` expands an index array into one Vertex per *index*
 * rather than keeping one per corner, so a mesh built from fourteen quads has
 * eighty-four vertices in it and not fifty-six. Anything that writes new
 * positions into those vertices later has to walk them in exactly the order
 * they were made - which is this order, and the reason both the building and
 * the re-laying go through one function rather than each having its own idea
 * of it. Getting that wrong does not fail: it draws a bow-tie.
 */
export function quadVertices(quads: readonly Quad[], atlas: TuckBoxAtlas, unit = 1):
{ positions: number[]; uvs: number[] } {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const quad of quads) {
    const uv = panelUvs(atlas, quad.panel, quad.flip);
    // Two triangles round the quad: 0-1-2 and 0-2-3.
    for (const corner of [0, 1, 2, 0, 2, 3]) {
      const point = quad.corners[corner];
      positions.push(point.x * unit, point.y * unit, point.z * unit);
      uvs.push(uv[corner * 2], uv[corner * 2 + 1]);
    }
  }
  return { positions, uvs };
}

/** A panel's corner UVs, in the same order `Quad.corners` are given. */
export function panelUvs(atlas: TuckBoxAtlas, panel: Panel, flip = false):
[number, number, number, number, number, number, number, number] {
  const r = atlas.rects[panel];
  const left = r.x / atlas.width;
  const right = (r.x + r.width) / atlas.width;
  const top = r.y / atlas.height;
  const bottom = (r.y + r.height) / atlas.height;
  const [a, b] = flip ? [right, left] : [left, right];
  return [a, top, b, top, b, bottom, a, bottom];
}
