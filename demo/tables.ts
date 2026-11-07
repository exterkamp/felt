import './serve';
import {
  BORDER_PATTERNS, Board, BorderPattern, CARD_HEIGHT, CARD_WIDTH, DISPLAY_FONT, FeltInk, FeltPaint, FrameOptions, Mark, Table, buildDeck, createTable, defineScene,
  border, paintFelt, paintFeltFrame, paintFeltSvg, seeded, shuffle,
} from 'felt';
import { showCode } from './code';
import { button, expose, standalone } from './kit';

// Three casino layouts and a parlour table of old patterns, all painted on the felt. Every word, line, box, die
// and scroll below is a `paintFelt` mark: a shape in one colour of paint, an
// ordinary sprite under the cards. The cards are only there to be on it.

const W = 480;
const H = 720;
const CX = W / 2;

// #region Filigree, as SVG path data
// A scroll runs almost straight, then winds into a spiral that tightens as
// it turns - the stroke every piece of filigree is made of.
function scroll(x: number, y: number, heading: number, lead: number, radius: number, turn = 1): string {
  let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
  const to = (ds: number) => {
    x += Math.cos(heading) * ds;
    y += Math.sin(heading) * ds;
    d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  for (let s = 0; s < lead; s += 1) { heading -= turn / 260; to(1); }
  for (let a = 0; a < Math.PI * 1.85; a += 0.08) {
    heading += turn * 0.08;
    to(radius * Math.exp(-a / 3.2) * 0.08);
  }
  return d;
}
const dot = (x: number, y: number, r = 1.4) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** One corner's flourish, in a 100 x 100 box with the corner at the top-left. */
const CORNER = [
  scroll(6, 6, 0, 62, 13, 1), scroll(6, 6, Math.PI / 2, 62, 13, -1),
  scroll(6, 6, Math.PI / 4, 20, 9, 1), scroll(6, 6, Math.PI / 4, 20, 9, -1),
  scroll(40, 8, Math.PI / 2 + 0.4, 6, 6, -1), scroll(8, 40, -0.4, 6, 6, 1),
  dot(6, 6, 3),
];
/** A divider: arms either side of a diamond, curling up and down. */
const DIVIDER = [
  'M150 4 L158 12 L150 20 L142 12 Z',
  scroll(162, 12, 0, 70, 12, -1), scroll(162, 12, 0, 30, 8, 1),
  scroll(138, 12, Math.PI, 70, 12, 1), scroll(138, 12, Math.PI, 30, 8, -1),
  dot(124, 12), dot(176, 12),
];
// #endregion

// #region Old patterns, drawn in code
// Designs centuries out of copyright, generated here rather than copied
// from anyone's file: guilloché, the engraved rosettes of banknotes and
// share certificates, and seigaiha, the Japanese overlapping waves. The
// running borders - the Greek key and the rest - are the engine's own.

/** Points along a closed curve, as path data. */
function curve(at: (t: number) => readonly [number, number], steps: number): string {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at((i / steps) * Math.PI * 2);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/**
 * A guilloché rosette in a 200 x 200 box: strands of one wave, each a little
 * out of phase with the last, so that between them they weave a net. A band
 * of sine strands round the rim, spirograph loops inside it, a knot at the
 * heart.
 */
function guilloche(): string[] {
  const c = 100;
  const ring = (r: number) => curve((t) => [c + r * Math.cos(t), c + r * Math.sin(t)], 160);
  const band = (mid: number, amp: number, waves: number, strands: number) =>
    Array.from({ length: strands }, (_, k) => curve((t) => {
      const r = mid + amp * Math.sin(waves * t + (k * Math.PI * 2) / strands);
      return [c + r * Math.cos(t), c + r * Math.sin(t)];
    }, waves * 24));
  // A circle carrying a smaller one round it backwards: loops = m + 1.
  const loops = (big: number, small: number, m: number, strands: number) =>
    Array.from({ length: strands }, (_, k) => curve((t) => {
      const phase = (k * Math.PI * 2) / (strands * (m + 1));
      return [c + big * Math.cos(t) + small * Math.cos(m * t + phase * m),
        c + big * Math.sin(t) - small * Math.sin(m * t + phase * m)];
    }, (m + 1) * 30));
  return [ring(98), ring(94), ...band(82, 8, 24, 6), ring(70),
    ...loops(42, 24, 11, 4), ...band(14, 6, 8, 3)];
}

/** A guilloché band in a `length` x 24 box: strands crossing and recrossing a line. */
function guillocheBand(length: number, waves: number): string[] {
  return [0, 1, 2, 3].map((k) => {
    let d = '';
    for (let x = 0; x <= length; x += 1) {
      const y = 12 + 9 * Math.sin((x / length) * waves * Math.PI * 2 + (k * Math.PI) / 2)
        * Math.cos((x / length) * Math.PI * 2 * 0.5 - Math.PI / 2) ** 0.4;
      d += `${x ? 'L' : 'M'}${x} ${y.toFixed(2)}`;
    }
    return d;
  });
}

/**
 * Seigaiha across a whole area: rows of fans of rings, each row tucked
 * behind the one in front of it. Each fan cuts away what it covers before
 * it is drawn, so the pattern is one paint with no overlaps in it.
 */
const seigaiha = (width: number, height: number, r: number, rings = 4): Mark => ({
  width, height, key: `seigaiha-${width}x${height}-${r}-${rings}`,
  draw(pen) {
    pen.lineWidth = 1.4;
    for (let row = 0, y = -r; y <= height + r; row++, y += r / 2) {
      for (let x = row % 2 ? r : 0; x <= width + r; x += r * 2) {
        pen.globalCompositeOperation = 'destination-out';
        pen.beginPath();
        pen.arc(x, y, r, 0, Math.PI * 2);
        pen.fill();
        pen.globalCompositeOperation = 'source-over';
        for (let k = 1; k <= rings; k++) {
          pen.beginPath();
          pen.arc(x, y, (r * (k - 0.35)) / rings, 0, Math.PI * 2);
          pen.stroke();
        }
      }
    }
  },
});
// #endregion

/** A whole SVG document, in its own two colours. */
const MEDALLION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="none" stroke="#d4a93c" stroke-width="2.4"/>
  <circle cx="50" cy="50" r="38" fill="none" stroke="#f3efe2" stroke-width="1.6" stroke-dasharray="3 3"/>
  <path fill="#d4a93c" d="M50 16 L57 43 L84 50 L57 57 L50 84 L43 57 L16 50 L43 43 Z"/>
  <circle cx="50" cy="50" r="5" fill="#d2302c"/>
</svg>`;

/** What a layout paints with: a mark at a place, in a paint. */
interface Painter {
  (mark: Mark, x: number, y: number, color?: FeltInk, angle?: number, alpha?: number): void;
  text(text: string, x: number, y: number, size: number, color?: FeltInk, more?: Record<string, unknown>): void;
  box(x: number, y: number, width: number, height: number, color?: FeltInk, more?: Record<string, unknown>): void;
  /** A border round a rectangle, by the engine's paintFeltFrame. */
  frame(pattern: BorderPattern, options: FrameOptions): void;
  /** Takes a mark made later (a loading SVG) as part of this table. */
  keep(mark: FeltPaint): void;
  board: Board;
}

/** A die face as a drawing: a white square with its pips cut out, so the felt shows through. */
const die = (pips: number, size = 18): Mark => ({
  width: size, height: size,
  draw(pen, w) {
    pen.fillStyle = '#f3efe2';
    pen.beginPath();
    pen.roundRect(0, 0, w, w, w * 0.18);
    pen.fill();
    pen.globalCompositeOperation = 'destination-out';
    const at = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
      5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[pips]!;
    for (const [i, j] of at) {
      pen.beginPath();
      pen.arc(w * (0.25 + i * 0.25), w * (0.25 + j * 0.25), w * 0.09, 0, Math.PI * 2);
      pen.fill();
    }
  },
});

/** Seats round a bend: points on a circle about (CX, cy), spread `spread` radians. */
const round = (n: number, cy: number, r: number, spread: number) => Array.from({ length: n }, (_, i) => {
  const a = (i / (n - 1) - 0.5) * spread;
  return { x: CX + r * Math.sin(a), y: cy + r * Math.cos(a), angle: (-a * 180) / Math.PI };
});

/** Lays out one table: paints it, and makes the zones its cards go in. */
type Layout = (paint: Painter, table: Table) => () => Promise<void>;

// #region Blackjack: rules round the table, insurance, spots
const blackjack: Layout = (paint, table) => {
  paint.text('BLACKJACK PAYS 3 TO 2', CX, 104, 20, 'yellow', { arc: 360 });
  paint({ path: DIVIDER, viewBox: [300, 24], width: 230, stroke: 1.5 }, CX, 140, 'gold');
  paint.text('DEALER MUST DRAW TO 16 AND STAND ON ALL 17s', CX, 352, 10, 'white', { arc: -560 });
  // The insurance band: two arcs, the words between them.
  paint({ path: ['M4 4 Q 216 52 428 4', 'M4 40 Q 216 88 428 40'], viewBox: [432, 70], width: 432, stroke: 1.6 },
    CX, 400, 'yellow');
  paint.text('INSURANCE PAYS 2 TO 1', CX, 410, 13, 'yellow', { arc: -970 });
  paint.box(CX, 230, CARD_WIDTH + 18, CARD_HEIGHT + 18, 'white');
  const seats = round(3, -40, 560, 0.5);
  const spots = seats.map((seat, i) => {
    paint.box(seat.x, seat.y, CARD_WIDTH + 22, CARD_HEIGHT + 22, 'white', { dash: [6, 4] });
    paint({ shape: 'ellipse', width: 42, height: 42, stroke: 2 }, seat.x, seat.y + 92, 'yellow');
    paint.text(`${i + 1}`, seat.x, seat.y + 92, 14, 'yellow');
    return table.pile({ id: `spot-${i}`, x: seat.x, y: seat.y, faceUp: true, fan: 'right', step: 14 });
  });
  CORNERS.forEach((corner) => paint({ path: CORNER, viewBox: [100, 100], width: 96, stroke: 1.6 },
    corner.x, corner.y, 'gold', corner.angle));
  const dealer = table.pile({ id: 'dealer', x: CX, y: 230, faceUp: true, fan: 'right', step: 16 });
  return dealRounds(table, [...spots, dealer], 2);
};
// #endregion

// #region Baccarat: hand boxes, commission, the betting bands and seats
const baccarat: Layout = (paint, table) => {
  paint.text('BACCARAT', CX, 62, 30, 'gold', { arc: 420, spacing: 0.18 });
  paint.text('TIE PAYS 8 TO 1  ·  BANKER PAYS 19 TO 20', CX, 98, 10, 'cream');
  const numbers = [1, 2, 3, 5, 6, 7];   // no 4: it sounds like death
  numbers.forEach((n, i) => {
    const x = CX + (i - 2.5) * 34;
    paint.box(x, 140, 26, 26, 'cream', { radius: 4, stroke: 1.5 });
    paint.text(`${n}`, x, 140, 11, 'cream');
  });
  paint.text('COMMISSION', CX, 166, 8, 'cream', { spacing: 0.3 });
  const hands = (['PLAYER', 'BANKER'] as const).map((name, i) => {
    const x = CX + (i ? 1 : -1) * 92;
    const color: FeltInk = i ? 'red' : 'white';
    paint.box(x, 262, 160, 140, color, { radius: 10 });
    paint.text(name, x, 208, 14, color, { spacing: 0.2 });
    return table.pile({ id: name.toLowerCase(), x, y: 270, faceUp: true, fan: 'right', step: 22 });
  });
  // The bands, as circles about a point above the board: a drawing.
  const cy = 30;
  paint({ width: W, height: H - cy, draw(pen) {
    pen.lineWidth = 2;
    for (const r of [370, 420, 480, 540]) {
      pen.beginPath();
      pen.arc(CX, 0, r, Math.PI * 0.18, Math.PI * 0.82);
      pen.stroke();
    }
  } }, CX, cy + (H - cy) / 2, 'white');
  paint.text('TIE', CX, cy + 395, 13, 'yellow', { arc: -395, spacing: 0.3 });
  paint.text('BANKER', CX, cy + 450, 16, 'red', { arc: -450, spacing: 0.3 });
  paint.text('PLAYER', CX, cy + 510, 16, 'white', { arc: -510, spacing: 0.3 });
  round(6, cy, 590, 0.7).forEach((seat, i) => {
    paint({ shape: 'ellipse', width: 30, height: 30, stroke: 2 }, seat.x, seat.y, 'gold');
    paint.text(`${numbers[i]}`, seat.x, seat.y, 13, 'gold');
  });
  void paintFeltSvg(paint.board, MEDALLION, { width: 46, height: 46 }, { x: CX, y: 365 }).then(paint.keep);
  return dealRounds(table, hands, 2);
};
// #endregion

// #region Craps: numbers, come, field, the line, and the propositions
const craps: Layout = (paint) => {
  const L = 30; const R = 450; const width = R - L;
  // The point numbers, with the don't-come bar beside them.
  paint.box(60, 95, 60, 110, 'white', { radius: 0 });
  paint.text("DON'T\nCOME\nBAR", 60, 85, 10, 'white', { lineHeight: 1.3 });
  paint(die(6, 14), 52, 128); paint(die(6, 14), 68, 128);
  ['4', '5', 'SIX', '8', 'NINE', '10'].forEach((n, i) => {
    const x = 120 + i * 60;
    paint.box(x, 95, 60, 110, 'white', { radius: 0 });
    paint.text(n, x, 90, n.length > 2 ? 17 : 28, 'yellow');
  });
  paint.box(CX, 195, width, 90, 'white', { radius: 0 });
  paint.text('COME', CX, 195, 52, 'red', { spacing: 0.15 });
  // The field: a one-roll bet, the 2 paying double and the 12 triple.
  paint.box(CX, 290, width, 100, 'white', { radius: 0 });
  paint.text('3 · 4 · 9 · 10 · 11', CX, 276, 22, 'yellow');
  paint.text('FIELD', CX, 316, 18, 'white', { spacing: 0.4 });
  for (const [x, n, pays] of [[72, '2', 'DOUBLE'], [408, '12', 'TRIPLE']] as const) {
    paint({ shape: 'ellipse', width: 40, height: 40, stroke: 2 }, x, 280, 'yellow');
    paint.text(n, x, 280, 18, 'yellow');
    paint.text(`PAYS ${pays}`, x, 314, 8, 'white');
  }
  paint.box(CX, 365, width, 50, 'white', { radius: 0 });
  paint.text("DON'T PASS BAR", CX - 30, 365, 16, 'white', { spacing: 0.1 });
  paint(die(6), 360, 365); paint(die(6), 384, 365);
  paint.box(CX, 420, width, 60, 'white', { radius: 0 });
  paint.text('PASS LINE', CX, 420, 30, 'white', { spacing: 0.2 });
  // Big 6 and 8, and craps and eleven.
  paint.box(100, 520, 140, 100, 'white', { radius: 0 });
  for (const [x, n] of [[72, '6'], [128, '8']] as const) {
    paint({ shape: 'rect', width: 40, height: 40, stroke: 2 }, x, 530, 'red', 45);
    paint.text(n, x, 530, 26, 'red');
  }
  paint.text('BIG', 100, 486, 10, 'white', { spacing: 0.4 });
  paint.box(100, 640, 140, 120, 'white', { radius: 0 });
  for (const [x, letter, color] of [[72, 'C', 'red'], [128, 'E', 'yellow']] as const) {
    paint({ shape: 'ellipse', width: 44, height: 44, stroke: 2 }, x, 630, color);
    paint.text(letter, x, 630, 22, color);
  }
  paint.text('CRAPS & ELEVEN', 100, 680, 8, 'white', { spacing: 0.2 });
  // The propositions: seven, the hardways, any craps.
  const px = 320; const pw = 260;
  paint.box(px, 588, pw, 236, 'red', { radius: 0 });
  paint.text('SEVEN  ·  5 FOR 1', px, 488, 16, 'red', { spacing: 0.1 });
  [[2, '7 TO 1'], [3, '9 TO 1'], [5, '7 TO 1'], [4, '9 TO 1']].forEach(([pips, pays], i) => {
    const x = px + (i % 2 ? 1 : -1) * 65;
    const y = 536 + Math.floor(i / 2) * 64;
    paint.box(x, y, 126, 58, 'white', { radius: 0 });
    paint(die(pips as number), x - 12, y - 10); paint(die(pips as number), x + 12, y - 10);
    paint.text(pays as string, x, y + 16, 11, 'yellow');
  });
  paint.text('ANY CRAPS  ·  8 FOR 1', px, 680, 14, 'red', { spacing: 0.1 });
  return async () => {};
};
// #endregion

// #region Parlour: the old patterns - seigaiha, Greek key, guilloché
const parlour: Layout = (paint, table) => {
  // Seigaiha the whole cloth over, faint, as if woven into it.
  paint(seigaiha(W, H, 26), CX, H / 2, 'cream', 0, 0.1);
  // #region A Greek key frame
  paint.frame('greek-key', { x: CX, y: H / 2, width: W - 16, height: H - 16, depth: 17, color: 'gold' });
  // #endregion
  // Guilloché: the rosette, a band either side of the words, a small one per spot.
  paint({ path: guilloche(), viewBox: [200, 200], width: 210, stroke: 0.7 }, CX, 190, 'cream');
  paint.text('PARLOUR', CX, 330, 26, 'gold', { spacing: 0.3 });
  paint({ path: guillocheBand(360, 9), viewBox: [360, 24], width: 360, stroke: 0.8 }, CX, 360, 'cream');
  paint.text('THE HOUSE PLAYS AT ITS OWN RISK', CX, 384, 9, 'cream', { spacing: 0.3 });
  const spots = [0, 1, 2, 3].map((i) => {
    const x = CX + (i - 1.5) * 104;
    const y = 520;
    paint({ path: guilloche(), viewBox: [200, 200], width: 96, stroke: 0.5 }, x, y, 'gold');
    // Tall enough for the pair dealt to it, fanned down.
    paint.box(x, y + 9, CARD_WIDTH + 14, CARD_HEIGHT + 32, 'cream', { radius: 6, stroke: 1.5 });
    return table.pile({ id: `spot-${i}`, x, y, faceUp: true, fan: 'down', step: 18 });
  });
  return dealRounds(table, spots, 2);
};
// #endregion

// #region Borders: every running border the engine draws
const borders: Layout = (paint) => {
  paint.frame('rope', { x: CX, y: H / 2, width: W - 16, height: H - 16, depth: 14, color: 'gold' });
  paint.text('BORDERS', CX, 52, 22, 'gold', { spacing: 0.3 });
  BORDER_PATTERNS.forEach((pattern, i) => {
    const y = 104 + i * 66;
    paint.text(pattern.replaceAll('-', ' ').toUpperCase(), CX, y, 9, 'cream', { spacing: 0.3 });
    paint(border(pattern, { length: 380, height: 18, stroke: 1.5 }), CX, y + 26, i % 2 ? 'gold' : 'white');
  });
  return async () => {};
};
// #endregion

const CORNERS = [0, 90, 180, 270].map((angle, i) => ({
  x: i === 0 || i === 3 ? 52 : W - 52, y: i < 2 ? 52 : H - 52, angle,
}));

/** Deals `rounds` cards each to the zones from a fresh shuffled deck, gathering first. */
function dealRounds(table: Table, zones: readonly ReturnType<Table['pile']>[], rounds: number) {
  const shoe = table.pile({ id: 'deck', x: W - 46, y: -CARD_HEIGHT, faceUp: false });
  let seed = Date.now() % 100000;
  return () => table.run(async () => {
    await table.move(table.cards.filter((c) => table.zoneOf(c) !== shoe), shoe, { spins: 0, arc: 6, pop: false });
    table.clear();
    shoe.put(shuffle(buildDeck(), seeded(++seed)));
    const flights = Array.from({ length: rounds }, (_, round) => zones.map((zone, i) =>
      table.move(shoe.top!, zone, { delay: (round * zones.length + i) * 120, spins: 0, arc: 10 }))).flat();
    await Promise.all(flights);
  });
}

const LAYOUTS = {
  blackjack: { layout: blackjack, felt: '#13463a' },
  baccarat: { layout: baccarat, felt: '#173a5c' },
  craps: { layout: craps, felt: '#17573a' },
  parlour: { layout: parlour, felt: '#4a1621' },
  borders: { layout: borders, felt: '#1d2f4a' },
};

export const scene = defineScene({
  name: 'tables',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: LAYOUTS.blackjack.felt });
    let marks: FeltPaint[] = [];
    let table: Table | undefined;
    let deal = async () => {};
    let showing: keyof typeof LAYOUTS = 'blackjack';

    // #region A painter: paintFelt with a place and a colour
    const paint = ((mark, x, y, color, angle, alpha) => {
      marks.push(paintFelt(board, mark, { x, y, color, angle, alpha }));
    }) as Painter;
    paint.text = (text, x, y, size, color = 'white', more = {}) =>
      paint({ text, font: DISPLAY_FONT, weight: 700, size, spacing: 0.1, ...more } as Mark, x, y, color);
    paint.box = (x, y, width, height, color = 'white', more = {}) =>
      paint({ shape: 'rect', width, height, radius: 8, stroke: 2, ...more } as Mark, x, y, color);
    paint.frame = (pattern, options) => marks.push(...paintFeltFrame(board, pattern, options));
    // #endregion
    paint.board = board;

    function show(name: keyof typeof LAYOUTS): void {
      showing = name;
      for (const mark of marks) mark.destroy();
      marks = [];
      const current = marks;
      paint.keep = (mark) => { if (marks === current) marks.push(mark); else mark.destroy(); };
      table?.destroy();
      table = createTable(board);
      board.setBackground(LAYOUTS[name].felt);
      deal = LAYOUTS[name].layout(paint, table);
      table.draggable();
      for (const id of Object.keys(LAYOUTS)) ctx.$(`#${id}`).classList.toggle('on', id === name);
      void deal();
    }

    for (const name of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) button(ctx, name, () => show(name));
    button(ctx, 'deal', () => void deal());
    show('blackjack');
    expose({ board, table: () => table, marks: () => marks, showing: () => showing, show });
  },
});

standalone(scene);
