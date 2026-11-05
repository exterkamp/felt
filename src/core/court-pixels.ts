// The pixel half of the background part, on its own so it can run anywhere.
//
// Self-contained on purpose: no module-level names, no imports. The court
// worker is built from this function's source text (see court-worker.ts), and
// a reference to anything outside it would be a ReferenceError over there.

/**
 * Pull the card's background back to the stock, leaving the figure alone.
 *
 * The source deck has no white skin to recolor. Paint the background element
 * one color and everything else another, and what comes out is a figure whose
 * face, hands, hair and linen are all *background* - the full-card rectangle
 * showing through gaps in the drawing. So a dark stock takes the King's face
 * with it unless the two are told apart here.
 *
 * Nothing in the file separates them, and two simpler rules both failed:
 *
 *   A flood from the border leaks. A Queen's cloak is white and runs unbroken
 *   into the white margin beside her, and the white between the strands of
 *   her hair runs into her face - so the flood arrives inside the figure and
 *   takes both.
 *
 *   Walking each column down from the top stops at the first thing drawn,
 *   which cannot leak but barely fills: a Jack's hat touches the top of the
 *   frame, so every column through it stops at once and the whole background
 *   behind his head stays pale.
 *
 * What works is flooding at a coarser grain than the leaks. A cell of the
 * grid counts as drawn if any pixel in it is, so the gaps the flood escaped
 * through - a few pixels between two strands of hair - are sealed, while the
 * background stays open. Then the result is grown back a bounded few pixels
 * at full resolution to take the rim the coarse grid left behind. Bounded,
 * because a growth that cannot run more than GROW pixels cannot cross a
 * figure to reach a face however the drawing is shaped.
 *
 * Edges are blended rather than switched, so the figure keeps its
 * antialiasing instead of gaining a pale fringe against a dark stock.
 */
export function partBackgroundPixels(
  data: Uint8ClampedArray, width: number, height: number,
  source: readonly number[], target: readonly number[],
  extra: readonly { x: number; y: number }[] = [],
): void {
  // Generous enough to carry the antialiased ramp, tight enough that it
  // cannot cross into one of the other four inks - the source is drawn in
  // five colors and nothing else, so there is a lot of room in between.
  const REACH = 60;
  const REACH2 = REACH * REACH;
  // Wider than the gaps the flood escaped through, narrower than anything
  // that is really background.
  const CELL = 4;
  const GROW = 6;
  // How far down the sides to start from. The art is a bust bleeding off the
  // bottom of the card, so below this the edges are the figure's own body and
  // seeding there floods a sleeve. Above it they are still sky.
  const SIDES = 0.6;

  const distance2 = (at: number) => {
    const dr = data[at] - source[0];
    const dg = data[at + 1] - source[1];
    const db = data[at + 2] - source[2];
    return dr * dr + dg * dg + db * db;
  };

  // Every pixel that is still the highlight, and every cell holding anything
  // that is not.
  const pale = new Uint8Array(width * height);
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const blocked = new Uint8Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const open = distance2(index * 4) <= REACH2;
      pale[index] = open ? 1 : 0;
      if (!open) blocked[Math.floor(y / CELL) * columns + Math.floor(x / CELL)] = 1;
    }
  }

  // Flood the open cells, in from every edge.
  const outside = new Uint8Array(columns * rows);
  const cells: number[] = [];
  const seed = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= columns || cy >= rows) return;
    const cell = cy * columns + cx;
    if (outside[cell] || blocked[cell]) return;
    outside[cell] = 1;
    cells.push(cell);
  };
  // The top edge is sky the whole way across. The sides are only sky while
  // the figure is still a head and shoulders; the bottom never is, because
  // the art bleeds off the card there.
  for (let cx = 0; cx < columns; cx++) seed(cx, 0);
  for (let cy = 0; cy < rows * SIDES; cy++) { seed(0, cy); seed(columns - 1, cy); }
  // And the places on two of the twelve that no edge can reach. See
  // COURT_BACKGROUND_SEEDS.
  for (const point of extra) {
    seed(Math.floor((point.x * width) / CELL), Math.floor((point.y * height) / CELL));
  }
  while (cells.length) {
    const cell = cells.pop() as number;
    const cx = cell % columns;
    const cy = (cell - cx) / columns;
    seed(cx - 1, cy); seed(cx + 1, cy); seed(cx, cy - 1); seed(cx, cy + 1);
  }

  // Back to pixels, and out by GROW to take the rim the grid left.
  const background = new Uint8Array(width * height);
  let front: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!pale[index]) continue;
      if (!outside[Math.floor(y / CELL) * columns + Math.floor(x / CELL)]) continue;
      background[index] = 1;
      front.push(index);
    }
  }
  for (let step = 0; step < GROW && front.length; step++) {
    const next: number[] = [];
    for (const index of front) {
      const x = index % width;
      const y = (index - x) / width;
      const look = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const at = ny * width + nx;
        if (background[at] || !pale[at]) return;
        background[at] = 1;
        next.push(at);
      };
      look(x - 1, y); look(x + 1, y); look(x, y - 1); look(x, y + 1);
    }
    front = next;
  }

  for (let index = 0; index < background.length; index++) {
    if (!background[index]) continue;
    const at = index * 4;
    // Full stock where it matched exactly, tapering out across the ramp.
    const mix = 1 - Math.sqrt(distance2(at)) / REACH;
    data[at] += (target[0] - data[at]) * mix;
    data[at + 1] += (target[1] - data[at + 1]) * mix;
    data[at + 2] += (target[2] - data[at + 2]) * mix;
  }
}

