import {
  Board, CARD_HEIGHT, CARD_WIDTH, DISPLAY_FONT, Director, FeltPaint, Scene, SceneContext, animatorOf, fpsMeter,
  paintFelt,
} from '@exterkamp/felt';

// The two things every demo page paints on its felt: the outline of an empty
// pile, and a small label. Felt paint (paintFelt), so one picture each is
// shared by every mark that is the same.

/** The paint the demos' outlines and labels are in: the felt's own pale green. */
export const OUTLINE_PAINT = 'rgba(207, 234, 208, 0.25)';

export function slot(board: Board, x: number, y: number, depth = 0,
  width = CARD_WIDTH, height = CARD_HEIGHT, color = OUTLINE_PAINT, angle = 0): FeltPaint {
  return paintFelt(board, { shape: 'rect', width, height, radius: 5, stroke: 1.5 }, { x, y, depth, color, angle });
}

export function label(board: Board, x: number, y: number, text: string,
  color = '#7fae86', size = 10, font = DISPLAY_FONT, weight?: string): FeltPaint {
  return paintFelt(board, { text, font, size, weight }, { x, y, depth: 0, color });
}

/**
 * Hands the page's state to the console and the smoke test, and pins the
 * frame-rate readout to the top-right of every demo.
 */
export function expose(handle: Record<string, unknown> & { board?: Board }): void {
  (window as unknown as Record<string, unknown>)['__felt'] = {
    ...handle, ...(handle.board ? { animator: animatorOf(handle.board) } : {}),
  };
  if (handle.board) fpsMeter(handle.board);
}

/**
 * Runs a demo's scene as the whole page, when the page is that demo's own.
 * Inside the demo app the app adds the scene to its director instead, and
 * this does nothing: the app says so before it imports any scene.
 */
export function standalone(scene: Scene<never>): void {
  if ((window as unknown as { __feltApp?: unknown }).__feltApp) return;
  // Reached at its clean path - /felt/stacks, which the host answers with
  // stacks.html - the page starts the whole app, which routes to this demo
  // and keeps going from there. Only stacks.html, asked for by name, is the
  // demo on its own.
  if (!location.pathname.endsWith('.html')) {
    void import('./app').then((app) => app.startApp());
    return;
  }
  const director = new Director(document.body, [scene]);
  void director.go(scene.name);
}

/**
 * A button by id, wired for as long as the scene runs. `run` gets the
 * element, for a button that labels its own state ("Spins: 2").
 */
export function button(ctx: SceneContext, id: string, run: (el: HTMLElement) => void): HTMLElement {
  const el = ctx.$(`#${id}`);
  ctx.listen(el, 'click', () => run(el));
  return el;
}
