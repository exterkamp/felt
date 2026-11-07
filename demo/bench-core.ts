// A benchmark that measures any card engine the same way.
//
// The same file sits in felt's demo and in phaser-card-engine's (on its
// `bench` branch): only the adapter at the bottom of each page differs. It
// times every requestAnimationFrame callback - the engine's update, its
// render and its draw submission, and the bench's own moving of the cards -
// so neither engine is measured by its own accounting. Imported first, before
// the engine has asked for a frame.
//
// GPU time and the browser's compositing are not in it: on a phone a frame
// can be late with little JavaScript in it. That is what the frame rate
// column is for.

export interface Adapter {
  name: string;
  /** Resolves once the engine is up and 52 cards could be drawn. */
  start(): Promise<void>;
  /** Makes or destroys cards until there are `n`; resolves when they can all be drawn. */
  setCount(n: number): Promise<void>;
  /** Moves every card for time `t` seconds. */
  move(t: number): void;
}

interface Frame { gap: number; js: number }

const raf = window.requestAnimationFrame.bind(window);
let frameT = -1;
let frameJs = 0;
let lastT = -1;
let frames: Frame[] = [];
function tally(t: number, ms: number): void {
  if (t !== frameT) {
    if (frameT >= 0) {
      frames.push({ gap: lastT >= 0 ? frameT - lastT : 0, js: frameJs });
      lastT = frameT;
    }
    frameT = t;
    frameJs = 0;
  }
  frameJs += ms;
}
window.requestAnimationFrame = (callback: FrameRequestCallback): number => raf((t) => {
  const started = performance.now();
  try { callback(t); } finally { tally(t, performance.now() - started); }
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => raf(() => raf(r)));
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const heap = () => {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? round(m.usedJSHeapSize / 1048576, 1) : null;
};

/** Frames between now and `ms` from now. */
async function record(ms: number): Promise<Frame[]> {
  frames = [];
  await wait(ms);
  return frames.slice(1);
}

function summary(fs: Frame[], ms: number) {
  const gaps = fs.map((f) => f.gap).filter((g) => g > 0);
  const js = fs.map((f) => f.js);
  return {
    frames: fs.length,
    fps: round(gaps.length ? 1000 / pct(gaps, 0.5) : 0, 1),
    fpsWorst: round(gaps.length ? 1000 / pct(gaps, 0.95) : 0, 1),
    jsMedian: round(pct(js, 0.5)),
    jsP95: round(pct(js, 0.95)),
    /** JavaScript per second of wall time, in ms: what it costs the battery. */
    jsPerSecond: round(js.reduce((a, b) => a + b, 0) / (ms / 1000), 1),
  };
}

export const COUNTS = [52, 208, 520, 1040, 2080];

/** Runs the whole bench, shows it on the page and posts it to the dev server. */
export async function run(adapter: Adapter, out: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const counts = (params.get('counts') ?? COUNTS.join(',')).split(',').map(Number);
  const result: Record<string, unknown> = {
    engine: adapter.name, ua: navigator.userAgent, dpr: devicePixelRatio,
    screen: `${screen.width}x${screen.height}`, at: new Date().toISOString(),
  };
  const show = (line: string) => { out.textContent += `${line}\n`; };
  show(`${adapter.name} - running, keep this tab in front`);

  // From navigation to 52 cards drawable and drawn.
  await adapter.start();
  await nextFrame();
  result['ready'] = round(performance.now(), 0);
  show(`ready ${result['ready']} ms after navigation`);

  let t = 0;
  let moving = false;
  const loop = (now: number) => {
    if (moving) {
      t = now / 1000;
      adapter.move(t);
    }
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);

  const rows: Record<string, unknown>[] = [];
  for (const n of counts) {
    moving = false;
    const startedAt = performance.now();
    await adapter.setCount(n);
    const made = performance.now() - startedAt;
    await nextFrame();
    const drawn = performance.now() - startedAt;
    await wait(800);
    const still = summary(await record(2000), 2000);
    moving = true;
    await wait(500);
    const motion = summary(await record(3000), 3000);
    moving = false;
    const row = { cards: n, makeMs: round(made, 0), drawnMs: round(drawn, 0), still, motion, heapMb: heap() };
    rows.push(row);
    show(`${n} cards: make ${row.makeMs} ms, ${motion.fps} fps (worst ${motion.fpsWorst}),`
      + ` js ${motion.jsMedian}/${motion.jsP95} ms, idle js ${still.jsPerSecond} ms/s, heap ${row.heapMb} MB`);
  }
  result['rows'] = rows;
  show('done');
  try {
    await fetch('/__bench', { method: 'POST', body: JSON.stringify(result) });
  } catch { /* no dev server: the page is the report */ }
  (window as unknown as { __bench?: unknown }).__bench = result;
}
