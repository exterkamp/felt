import './serve';
import {
  CardSprite, DECK_THEMES, DeckTheme, LoadingStage, SUITS, RANKS, buildDeck, cardsReady, loadingReport,
} from 'felt';
import { expose, standalone } from './kit';
import { fpsMeter } from 'felt';
import { defineScene } from 'felt';

// A scene: run on its own page (standalone, below) or as one screen of the
// demo app, which moves between scenes without the page navigating.
export const scene = defineScene({
  name: 'loading',
  create(ctx) {
    // The engine starting up, made visible: one bar per thing it waits for, and
    // the moment the first card can be drawn.
    //
    // Nothing here waits by hand. The page makes its fifty-two cards straight
    // away, before any art has arrived; the engine notices what those cards'
    // sheets need, gets it, paints every face, and only then draws them. The
    // bars are `loadingReport(board)` read once a frame; "ready" is
    // `cardsReady(board)`.
    //
    // `?draw=at-once` makes the same board with `waitForArt: false`, to compare:
    // the cards appear at once and fill in as their art lands.

    const params = new URLSearchParams(location.search);
    const atOnce = params.get('draw') === 'at-once';
    const WIDTH = 520;
    const HEIGHT = 330;
    const CARD = 46;
    const MARGIN = 14;

    const log = document.getElementById('log')!;
    const note = (text: string) => {
      log.textContent += `${text}\n`;
      log.scrollTop = log.scrollHeight;
    };
    ctx.listen(window, 'error', (event) => note(`error: ${(event as ErrorEvent).message}`));

    const makeBoard = () => ctx.board({
      parent: 'board', width: WIDTH, height: HEIGHT, backgroundColor: '#13463a', waitForArt: !atOnce,
    });
    let board = makeBoard();
    const t0 = board.createdAt;
    const at = () => `${(performance.now() - t0).toFixed(0).padStart(6)} ms`;
    note(`${at()}  board made, ${t0.toFixed(0)} ms after navigation${atOnce ? ' (drawing cards at once, waitForArt: false)' : ''}`);

    // The whole deck, one suit to a row, face up - so ready means every face.
    let theme: DeckTheme = 'press';
    let cards: CardSprite[] = [];
    const rowHeight = (HEIGHT - 2 * MARGIN) / 4;
    const step = (WIDTH - 2 * MARGIN - CARD) / (RANKS.length - 1);
    const deck = buildDeck();

    // Every frame drawn, for the smoke test: how many cards it drew, and whether
    // the engine said it was ready by then.
    let frames: { at: number; instances: number; ready: boolean }[] = [];

    function deal(): void {
      cards = [];
      SUITS.forEach((suit, row) => {
        RANKS.forEach((rank, i) => {
          const card = new CardSprite(board, { ...deck.find((c) => c.suit === suit && c.rank === rank)!, faceUp: true },
            { width: CARD, theme });
          card.setPosition(MARGIN + CARD / 2 + i * step, MARGIN + rowHeight * (row + 0.5));
          card.depth = row * 20 + i;
          cards.push(card);
        });
      });
      frames = [];
      const b = board;
      b.on('render', () => {
        frames.push({ at: performance.now() - b.createdAt, instances: b.renderer.instanceCount,
          ready: loadingReport(b).ready });
      });
    }
    deal();
    note(`${at()}  52 cards made, none drawn yet`);

    /**
     * The board thrown away and a new one made: a new canvas, a new GL context,
     * an empty atlas - but the same engine, whose art (fonts, glyphs, portraits)
     * is all still there. What a game does going from one screen to the next.
     */
    function newBoard(): void {
      board.destroy();
      board = makeBoard();
      deal();
      const made = board.createdAt;
      note(`${at()}  board destroyed and a new one made on the same engine`);
      void cardsReady(board).then(() => {
        note(`${at()}  new board ready in ${(performance.now() - made).toFixed(0)} ms: its art was the engine's already`);
      });
    }

    // --- the bars ---------------------------------------------------------------

    const panel = document.getElementById('stages')!;
    const rows = new Map<string, { root: HTMLElement; fill: HTMLElement; count: HTMLElement }>();
    const logged = new Set<string>();

    function row(stage: LoadingStage) {
      let r = rows.get(stage.id);
      if (!r) {
        const root = document.createElement('div');
        root.className = 'stage';
        root.dataset.stage = stage.id;
        root.innerHTML = `<span class="name"></span><span class="bar"><span class="fill"></span></span><span class="count"></span>`;
        root.querySelector('.name')!.textContent = stage.label;
        panel.appendChild(root);
        r = { root, fill: root.querySelector('.fill')!, count: root.querySelector('.count')! };
        rows.set(stage.id, r);
      }
      return r;
    }

    const verdict = document.getElementById('verdict')!;
    const waiting = document.getElementById('waiting')!;

    const PIPS: Record<string, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
    /** An art key as a person would say it: `court K♠`, `back press`. */
    function named(key: string): string {
      const court = /-(J|Q|K)-(\w+)$/.exec(key);
      if (court) return `court ${court[1]}${PIPS[court[2]] ?? court[2]}`;
      if (key === 'font:faces') return 'fonts';
      const [kind, what] = key.split(':');
      return what ? `${kind} ${PIPS[what] ?? what}` : key;
    }

    function show(): void {
      const report = loadingReport(board);
      for (const stage of report.stages) {
        const r = row(stage);
        const fraction = stage.total ? stage.done / stage.total : 0;
        r.fill.style.width = `${(fraction * 100).toFixed(1)}%`;
        const complete = stage.total > 0 && stage.done === stage.total;
        r.root.classList.toggle('done', complete && !stage.failed);
        r.root.classList.toggle('failed', stage.failed > 0);
        r.count.textContent = `${stage.done}/${stage.total}${stage.failed ? ` ${stage.failed}✗` : ''}`
          + (stage.finishedAt !== undefined ? ` ${stage.finishedAt.toFixed(0)}ms` : '');
        if (stage.finishedAt !== undefined && !logged.has(stage.id)) {
          logged.add(stage.id);
          note(`${stage.finishedAt.toFixed(0).padStart(6)} ms  ${stage.label}: ${stage.done}/${stage.total}`
            + (stage.failed ? `, ${stage.failed} failed` : ''));
        }
      }
      const drawn = cards.filter((c) => c.revealed).length;
      if (report.ready) {
        verdict.textContent = `ready in ${report.readyAt!.toFixed(0)} ms · ${drawn} of 52 cards drawn · `
          + `${board.renderer.drawCalls} draw call`;
        verdict.classList.remove('waiting');
      } else {
        verdict.textContent = `loading… ${(report.elapsed / 1000).toFixed(1)} s · ${drawn} of 52 cards drawn`;
        verdict.classList.add('waiting');
      }
      waiting.textContent = report.waitingFor.length
        ? `waiting for: ${report.waitingFor.slice(0, 12).map(named).join(', ')}`
          + (report.waitingFor.length > 12 ? ` +${report.waitingFor.length - 12}` : '')
        : '';
    }
    // Every frame, for as long as the scene runs - and not a frame after.
    show();
    ctx.onFrame(show);

    void cardsReady(board).then(() => {
      note(`${at()}  cards ready: first frame with every card drawn`);
    });

    // --- the buttons ------------------------------------------------------------

    document.getElementById('reload')!.addEventListener('click', () => location.reload());
    document.getElementById('again')!.addEventListener('click', () => newBoard());

    document.getElementById('restyle')!.addEventListener('click', () => {
      theme = DECK_THEMES[(DECK_THEMES.indexOf(theme) + 1) % DECK_THEMES.length];
      const started = performance.now();
      note(`${at()}  restyled to ${theme}: the old deck stays on show until the new one is finished`);
      for (const card of cards) card.restyle({ width: CARD, theme });
      const sheet = cards[0].sheet;
      const stop = ctx.onFrame(() => {
        if (!(sheet.ready() && cards.every((c) => c.revealed))) return;
        stop();
        note(`${at()}  ${theme} finished, swapped in after ${(performance.now() - started).toFixed(0)} ms`);
      });
    });

    document.getElementById('lose')!.addEventListener('click', () => {
      const lose = board.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      if (!lose) return note('no WEBGL_lose_context here');
      note(`${at()}  context lost on purpose`);
      lose.loseContext();
      ctx.delay(600, () => { lose.restoreContext(); note(`${at()}  context restored, atlas replayed`); });
    });

    const mode = document.getElementById('mode')!;
    mode.textContent = atOnce ? 'Wait for art' : 'Draw at once';
    mode.addEventListener('click', () => {
      location.search = atOnce ? '' : '?draw=at-once';
    });

    // Getters, since the board can be replaced.
    expose({ cards: () => cards, frames: () => frames, loadingReport: () => loadingReport(board), newBoard });
    Object.defineProperty((window as unknown as { __felt: object }).__felt, 'board', { get: () => board });
    const meter = fpsMeter(() => board);
    ctx.scope.add(() => meter.destroy());
  },
});

standalone(scene);
