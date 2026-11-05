import type { Region } from '../gl/atlas.js';
import type { Board } from '../scene/board.js';
import {
  DISPLAY_FONT, DISPLAY_WEIGHT, DECK_THEME_LABELS, DeckTheme, Panel,
  TuckBoxSize, colorCss, tuckBoxAtlas,
} from '../core/index.js';
import { CardArt, FONT_ASSET, backAssetKey, ensureArt } from './card-art.js';

// The printing on a box.
//
// One texture with every panel on it, drawn here and measured in
// tuck-box.ts - the two agree about where a panel landed because they both
// ask the same function.
//
// Nothing here is new artwork. A deck's box carries the deck's own back, over
// the deck's own colour, because that is what a real one does and because it
// means a box costs nothing to theme: every deck in the package already has a
// back, so every deck already has a box.

/** The board a box is made of, seen where the printing is not. */
const BOARD = '#d9cfbe';
const BOARD_SHADE = '#c2b6a2';

/** The cut edge of a deck - the fifty-two leaves you see from the side. */
const LEAF = '#f4efe4';
const LEAF_LINE = 'rgba(120, 108, 92, 0.30)';

export interface TuckBoxArt {
  /**
   * A printed box, or the block of cards that comes out of it.
   *
   * Both are boxes - see `boxQuads` - so both are printed here, off one
   * layout, which is the only way the two can be guaranteed to agree about
   * where a panel landed.
   */
  kind?: 'box' | 'deck';
  theme: DeckTheme;
  /** What the pattern is printed over, as the cards' own back colour is. */
  backColor: number;
  /** The deck's name down the spine. Defaults to the theme's label. */
  label?: string;
  /** Pixels per unit. The box is small on screen; 6 is plenty. */
  scale?: number;
}

export function tuckBoxTextureKey(art: TuckBoxArt, size: TuckBoxSize): string {
  const scale = art.scale ?? DEFAULT_SCALE;
  return `pce-${art.kind ?? 'box'}-${art.theme}-${art.backColor.toString(16)}`
    + `-${Math.round(size.width)}x${Math.round(size.depth)}-${scale}`;
}

const DEFAULT_SCALE = 6;

/**
 * Prints a box into the board's atlas, and hands back its region.
 *
 * Synchronous, unlike the courts: if the back has not loaded yet the box is
 * printed without it and printed again, in place, when it lands.
 */
export function renderTuckBox(board: Board, size: TuckBoxSize, art: TuckBoxArt): Region {
  const key = tuckBoxTextureKey(art, size);
  const existing = board.atlas.acquire(key);
  if (existing) return existing;
  const scale = art.scale ?? DEFAULT_SCALE;
  const atlas = tuckBoxAtlas(size, scale);
  ensureArt(board, art.theme, 'spades');
  const cardArt = CardArt.of(board);
  const region = board.atlas.reserve(key, atlas.width, atlas.height);
  cardArt.paintTracked(region, (lookup) => {
    const source = lookup.get(backAssetKey(art.theme));
    lookup.get(FONT_ASSET);
    return (pen) => printBox(pen as CanvasRenderingContext2D, atlas, art, scale, source);
  });
  return region;
}

function printBox(
  pen: CanvasRenderingContext2D, atlas: ReturnType<typeof tuckBoxAtlas>, art: TuckBoxArt,
  scale: number, source: CanvasImageSource | undefined,
): void {
  const rect = (panel: Panel) => atlas.rects[panel];

  const ink = colorCss(art.backColor);
  const deck = art.kind === 'deck';
  pen.clearRect(0, 0, atlas.width, atlas.height);

  // The board first, everywhere. Anything printed goes over it, and anything
  // not printed - the inside of the box, the inside of the lid - is this.
  pen.fillStyle = BOARD;
  pen.fillRect(0, 0, atlas.width, atlas.height);

  // The inside panel is board with the light off: it is the one surface that
  // is only ever seen in shadow, through an opening.
  const inside = rect('inside');
  pen.fillStyle = BOARD_SHADE;
  pen.fillRect(inside.x, inside.y, inside.width, inside.height);

  // The face, the lid and the tab are all the deck's colour.
  for (const panel of ['face', 'side', 'lid', 'tab'] as const) {
    const r = rect(panel);
    pen.fillStyle = ink;
    pen.fillRect(r.x, r.y, r.width, r.height);
  }

  // The deck's own back, on the front panel. Inset on a box, because the
  // pattern already has its own margin and a box is not a card: printing it
  // edge to edge would put a card's border inside a box's border. Not inset
  // on the deck, which *is* a card and wants its own border where it is.
  const face = rect('face');
  if (source) {
    const inset = deck ? 0 : Math.round(face.width * 0.06);
    pen.drawImage(source, face.x + inset, face.y + inset,
      face.width - inset * 2, face.height - inset * 2);

    // And a slice of it across the lid, so the pattern runs over the fold
    // rather than stopping at it.
    const lid = rect('lid');
    if (deck) {
      pen.fillStyle = LEAF;
      pen.fillRect(lid.x, lid.y, lid.width, lid.height);
    } else {
    pen.save();
    pen.beginPath();
    pen.rect(lid.x, lid.y, lid.width, lid.height);
    pen.clip();
    pen.drawImage(source, lid.x + Math.round(lid.width * 0.06), lid.y,
      lid.width - Math.round(lid.width * 0.12), face.height);
    pen.restore();
    }
  }

  // Everything below is the box's own furniture: a name down the spine and a
  // hairline inside each printed edge. A block of cards has neither - what it
  // has on every side is its own cut edge - so it stops here.
  const side = rect('side');
  if (deck) {
    for (const panel of ['side', 'tab', 'inside'] as const) {
      const r = rect(panel);
      pen.fillStyle = LEAF;
      pen.fillRect(r.x, r.y, r.width, r.height);
    }
    leafEdges(pen, atlas, ['side', 'tab', 'inside']);
    leafEdges(pen, atlas, ['leaves']);
    return;
  }
  const label = art.label ?? DECK_THEME_LABELS[art.theme];
  pen.save();
  pen.translate(side.x + side.width / 2, side.y + side.height / 2);
  // Reading up the spine, which is how a box stood on a table is read.
  pen.rotate(Math.PI / 2);
  pen.fillStyle = 'rgba(253, 253, 253, 0.88)';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.font = `${DISPLAY_WEIGHT} ${Math.round(side.width * 0.42)}px ${DISPLAY_FONT}`;
  pen.fillText(label.toUpperCase(), 0, 0);
  pen.restore();

  // A hairline just inside every printed edge, which is what a box has and
  // what stops the panels reading as coloured rectangles.
  pen.strokeStyle = 'rgba(253, 253, 253, 0.34)';
  pen.lineWidth = Math.max(1, Math.round(scale * 0.22));
  for (const panel of ['face', 'side', 'lid'] as const) {
    const r = rect(panel);
    const m = Math.round(r.width * 0.045);
    pen.strokeRect(r.x + m, r.y + m, r.width - m * 2, r.height - m * 2);
  }

  // The cut edge of the deck itself: cream, with a line for every few cards.
  // Not one per card - at the size this is ever seen that is a grey block -
  // but enough of them that it reads as leaves rather than as a solid.
  const leaves = rect('leaves');
  pen.fillStyle = LEAF;
  pen.fillRect(leaves.x, leaves.y, leaves.width, leaves.height);
  leafEdges(pen, atlas, ['leaves']);
}

/**
 * The cut edge of a deck: a line every few cards.
 *
 * Not one line per card. At the size this is ever seen fifty-two of them is a
 * grey block, and what the eye reads as "a deck rather than a brick" is a
 * handful of leaves it can almost count.
 */
function leafEdges(
  pen: CanvasRenderingContext2D, atlas: ReturnType<typeof tuckBoxAtlas>,
  panels: readonly Panel[],
): void {
  pen.strokeStyle = LEAF_LINE;
  pen.lineWidth = 1;
  for (const panel of panels) {
    const r = atlas.rects[panel];
    for (let x = r.x + 1.5; x < r.x + r.width; x += 2) {
      pen.beginPath();
      pen.moveTo(x, r.y);
      pen.lineTo(x, r.y + r.height);
      pen.stroke();
    }
  }
}
