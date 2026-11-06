import type { Board } from './board.js';

// A frame-rate readout, pinned to the top-right of the page.
//
// It counts frames the board actually drew, which is not the same as frames
// the browser offered it: a felt board sleeps when nothing moves, so a still
// table reads "idle" rather than a misleading 0 fps. Beside the rate is how
// long a frame's work took on the main thread, which is the number that
// says whether there is headroom - 60 fps at 2 ms is a different board from
// 60 fps at 15 ms - and what one frame drew.
//
// Updated four times a second from a timer of its own, so watching the
// meter never keeps a board awake that would otherwise sleep.

export interface FpsMeter {
  readonly element: HTMLElement;
  destroy(): void;
}

/**
 * Pass a board, or a function answering the current one for a page that
 * replaces its board: the meter follows it to the new one.
 */
export function fpsMeter(source: Board | (() => Board), parent: HTMLElement = document.body): FpsMeter {
  const current = typeof source === 'function' ? source : () => source;
  let board = current();
  const element = document.createElement('div');
  element.className = 'felt-fps';
  Object.assign(element.style, {
    position: 'fixed', top: '0.55rem', right: '0.6rem', zIndex: '30',
    font: '600 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#cfead0', background: 'rgba(8, 26, 19, 0.82)', border: '1px solid #1f5e4d',
    borderRadius: '4px', padding: '0.25rem 0.45rem', pointerEvents: 'none',
    whiteSpace: 'pre', textAlign: 'right', minWidth: '6.5rem',
  } as Partial<CSSStyleDeclaration>);
  parent.appendChild(element);

  const frames: number[] = [];
  const work: number[] = [];
  let worst = 0;
  const onRender = () => {
    const now = performance.now();
    frames.push(now);
    work.push(board.frameWork);
  };
  board.on('render', onRender);

  const paint = () => {
    const now = performance.now();
    const next = current();
    if (next !== board) {
      board.off('render', onRender);
      board = next;
      board.on('render', onRender);
    }
    while (frames.length && frames[0] < now - 1000) {
      frames.shift();
      work.shift();
    }
    const last = frames[frames.length - 1];
    const idle = last === undefined || now - last > 500;
    const avg = work.length ? work.reduce((a, b) => a + b, 0) / work.length : 0;
    worst = work.length ? Math.max(...work) : 0;
    const r = board.renderer;
    const fpsLine = idle ? 'idle' : `${frames.length} fps`;
    const lost = r.lost ? '  CONTEXT LOST' : '';
    element.textContent = `${fpsLine}${lost}\n`
      + `${avg.toFixed(1)} ms · worst ${worst.toFixed(0)}\n`
      + `${r.drawCalls} draw · ${r.instanceCount} inst`;
    element.style.color = r.lost ? '#ff8a8a' : !idle && frames.length < 50 ? '#ffd166' : '#cfead0';
  };
  paint();
  const timer = setInterval(paint, 250);

  const destroy = () => {
    clearInterval(timer);
    board.off('render', onRender);
    element.remove();
  };
  // A fixed board takes its meter with it; a followed one may be replaced.
  if (typeof source !== 'function') board.once('destroy', destroy);
  return { element, destroy };
}
