import './serve';
import { CardSprite, buildDeck, defineScene, loadCardArt } from 'felt';
import { expose, standalone } from './kit';

// A thousand cards in motion, for measuring. Every card is moved every frame
// by a game update (not tweens), the way a busy realtime table would - and
// `__felt.measure(ms)` reports what a frame of it costs.

const COUNTS = [52, 208, 520, 1040, 2080, 4160];
type Mode = 'flat' | '3d' | 'still';

export const scene = defineScene({
  name: 'stress',
  create(ctx) {
    const W = 560;
    const H = 700;
    const board = ctx.board({ parent: 'board', width: W, height: H, backgroundColor: '#13463a' });
    void loadCardArt(board);
    const deck = buildDeck();
    let cards: { sprite: CardSprite; phase: number; speed: number; cx: number; cy: number; r: number }[] = [];
    let level = Number(new URLSearchParams(location.search).get('level') ?? 0);
    let mode: Mode = (new URLSearchParams(location.search).get('mode') as Mode) ?? 'flat';
    let paused = false;

    function populate(): void {
      const want = COUNTS[level];
      while (cards.length > want) cards.pop()!.sprite.destroy();
      while (cards.length < want) {
        const i = cards.length;
        const card = deck[i % deck.length];
        const sprite = new CardSprite(board, { ...card, faceUp: i % 3 !== 0 }, { width: 44 });
        sprite.depth = i;
        cards.push({
          sprite, phase: (i * 2.399) % (Math.PI * 2), speed: 0.4 + ((i * 7) % 13) / 13,
          cx: 40 + ((i * 37) % (W - 80)), cy: 40 + ((i * 53) % (H - 80)), r: 10 + (i % 30),
        });
      }
    }

    let t = 0;
    ctx.onFrame((delta) => {
      if (paused || mode === 'still') return;
      t += delta / 1000;
      for (const c of cards) {
        const a = c.phase + t * c.speed;
        const s = c.sprite;
        s.x = c.cx + Math.cos(a) * c.r;
        s.y = c.cy + Math.sin(a) * c.r;
        s.angle = (a * 30) % 360;
        if (mode === '3d') {
          s.z = 10 + 10 * Math.sin(a * 2);
          s.tilt = 0.4 * Math.sin(a);
          s.turn = a % (Math.PI * 2);
          s.bow = 0.15 * Math.sin(a * 3);
        }
      }
    });

    const stats = ctx.$('#stats');
    const work: number[] = [];
    let last = performance.now();
    const gaps: number[] = [];
    board.on('render', () => {
      work.push(board.frameWork);
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (work.length > 60) { work.shift(); gaps.shift(); }
    });
    ctx.every(300, () => {
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      stats.textContent = `${cards.length} cards · ${mode} · board work ${avg(work).toFixed(2)} ms/frame`
        + ` · ${(1000 / Math.max(1, avg(gaps))).toFixed(0)} fps · ${board.renderer.drawCalls} draw call`;
    });

    const refresh = () => {
      populate();
      ctx.$('#mode').textContent = `Mode: ${mode}`;
      board.touch();
    };
    ctx.listen(ctx.$('#more'), 'click', () => { level = Math.min(COUNTS.length - 1, level + 1); refresh(); });
    ctx.listen(ctx.$('#fewer'), 'click', () => { level = Math.max(0, level - 1); refresh(); });
    ctx.listen(ctx.$('#mode'), 'click', () => {
      mode = mode === 'flat' ? '3d' : mode === '3d' ? 'still' : 'flat';
      refresh();
    });
    ctx.listen(ctx.$('#pause'), 'click', () => { paused = !paused; });
    refresh();

    /** Average board work over `ms` of frames, for the benchmark. */
    const measure = async (ms = 2000) => {
      work.length = 0;
      gaps.length = 0;
      const samples: number[] = [];
      const off = board.on('render', () => samples.push(board.frameWork));
      void off;
      await new Promise((r) => setTimeout(r, ms));
      const sorted = [...samples].sort((a, b) => a - b);
      return { frames: samples.length, avg: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
        median: sorted[Math.floor(sorted.length / 2)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 };
    };
    const set = (n: number, m: Mode) => { level = n; mode = m; refresh(); };
    expose({ board, cards: () => cards, measure, set });
  },
});

standalone(scene);
