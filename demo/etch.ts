import './serve';
import {
  CARD_HEIGHT, CARD_WIDTH, DISPLAY_FONT, EtchStyle, Etching, buildDeck, createTable, defineScene, etch, etchSvg,
  seeded, shuffle,
} from 'felt';
import { showCode } from './code';
import { button, expose, standalone } from './kit';

// A table with its markings worked into the cloth. Everything on the felt
// here - words, boxes, scrolls, the medallion - is an etching: a shape lit as
// part of the felt, under the cards. The cards are only there to be on it.

const W = 480;
const H = 720;
const BOXES = [-1, 0, 1].map((i) => ({ x: W / 2 + i * 120, y: 512 - Math.abs(i) * 26 }));
const DEALER = { x: W / 2, y: 250 };

// #region Filigree, as SVG path data
// A scroll is a line that runs almost straight, then winds into a spiral
// that tightens as it turns - the stroke every piece of filigree is made of.
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

/** A whole SVG document - anything a drawing program saves. */
const MEDALLION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g fill="none" stroke="#000" stroke-width="2.2">
    <circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="38" stroke-dasharray="3 3"/>
  </g>
  <path d="M50 16 L57 43 L84 50 L57 57 L50 84 L43 57 L16 50 L43 43 Z"/>
  <circle cx="50" cy="50" r="5" fill="none" stroke="#000" stroke-width="2"/>
</svg>`;

const FELTS = [['green', '#13463a'], ['blue', '#173a5c'], ['red', '#5a1a22'], ['black', '#1d1f1e']] as const;
const STYLES: EtchStyle[] = ['etched', 'embossed', 'printed', 'gilt'];

export const scene = defineScene({
  name: 'etch',
  create(ctx) {
    showCode(ctx);
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: FELTS[0][1] });
    let marks: Etching[] = [];
    let style: EtchStyle = 'etched';
    let built = 0;

    async function markTable(): Promise<void> {
      const build = ++built;
      for (const mark of marks) mark.destroy();
      // #region Words: gilt, pressed in, printed, bent round the table
      const title = { font: DISPLAY_FONT, weight: 700 };
      marks = [
        etch(board, { ...title, text: 'FELT & COMPANY', size: 26, spacing: 0.1, arc: 320 },
          { x: W / 2, y: 74, style: 'gilt', relief: 1.2 }),
        etch(board, { ...title, text: 'BLACKJACK PAYS 3 TO 2', size: 13, spacing: 0.22, arc: 420 },
          { x: W / 2, y: 116, style }),
        etch(board, { font: DISPLAY_FONT, text: 'DEALER MUST DRAW TO 16 AND STAND ON ALL 17s', size: 10, spacing: 0.12, arc: -520 },
          { x: W / 2, y: 356, style }),
        etch(board, { font: DISPLAY_FONT, weight: 700, text: 'INSURANCE PAYS 2 TO 1', size: 12, spacing: 0.25, arc: -470 },
          { x: W / 2, y: 388, style: style === 'etched' ? 'printed' : style, color: '#e8c873' }),
        // #endregion

        // #region Outlines: bet boxes, the dealer's place, a curved line
        etch(board, { shape: 'rect', width: CARD_WIDTH + 18, height: CARD_HEIGHT + 18, radius: 8, stroke: 2 },
          { ...DEALER, style }),
        ...BOXES.map((box) => etch(board,
          { shape: 'rect', width: CARD_WIDTH + 22, height: CARD_HEIGHT + 22, radius: 10, stroke: 2, dash: [6, 4] },
          { ...box, style })),
        ...BOXES.map((box, i) => etch(board, { font: DISPLAY_FONT, text: `SPOT ${i + 1}`, size: 10, spacing: 0.3 },
          { x: box.x, y: box.y + CARD_HEIGHT / 2 + 24, style })),
        // An insurance line round the table: a stroked SVG arc.
        etch(board, { path: 'M4 4 Q 220 52 436 4', viewBox: [440, 32], width: 420, stroke: 1.5 },
          { x: W / 2, y: 414, style }),
        // #endregion

        // #region Filigree: one path set, turned for each corner
        ...[0, 90, 180, 270].map((angle, i) => etch(board, { path: CORNER, viewBox: [100, 100], width: 110, stroke: 1.6 },
          { x: i === 0 || i === 3 ? 58 : W - 58, y: i < 2 ? 58 : H - 58, angle, style })),
        etch(board, { path: DIVIDER, viewBox: [300, 24], width: 230, stroke: 1.5 }, { x: W / 2, y: 150, style }),
        // #endregion
      ];
      // #region Artwork: a whole SVG document
      const medallion = await etchSvg(board, MEDALLION, { width: 86, height: 86 },
        { x: W / 2, y: 640, style: style === 'etched' ? 'embossed' : style });
      // #endregion
      if (build !== built) medallion.destroy();
      else marks.push(medallion);
    }
    void markTable();

    // Cards to put on it: a shoe at the dealer, a spot for each player.
    const table = createTable(board);
    const shoe = table.pile({ id: 'dealer', ...DEALER, faceUp: false });
    const spots = BOXES.map((box, i) => table.pile({ id: `spot-${i}`, ...box, faceUp: true, fan: 'right', step: 14 }));
    table.draggable();
    const seed = Date.now() % 100000;
    const deal = () => table.run(async () => {
      await table.move(table.cards.filter((c) => table.zoneOf(c) !== shoe), shoe, { spins: 0, arc: 6, pop: false });
      const flights = [0, 1].flatMap((round) => spots.map((spot, i) =>
        table.move(shoe.top!, spot, { delay: (round * 3 + i) * 120, spins: 0, arc: 10 })));
      await Promise.all(flights);
    });
    shoe.put(shuffle(buildDeck(), seeded(seed)));
    void deal();

    button(ctx, 'style', (el) => {
      style = STYLES[(STYLES.indexOf(style) + 1) % STYLES.length];
      el.textContent = `Style: ${style}`;
      void markTable();
    });
    let felt = 0;
    button(ctx, 'felt', (el) => {
      felt = (felt + 1) % FELTS.length;
      board.setBackground(FELTS[felt][1]);
      el.textContent = `Felt: ${FELTS[felt][0]}`;
    });
    button(ctx, 'deal', () => void deal());
    expose({ board, table, marks: () => marks, style: () => style });
  },
});

standalone(scene);
