import { Board, CARD_HEIGHT, CARD_WIDTH, DISPLAY_FONT, Sprite, animatorOf, fpsMeter } from 'felt';

// The two things every demo page prints on its felt: the outline of an empty
// pile, and a small label. One picture each, shared by every sprite using it.

export function slot(board: Board, x: number, y: number, depth = 0,
  width = CARD_WIDTH, height = CARD_HEIGHT): Sprite {
  return board.graphic(width, height, (pen, w, h) => {
    pen.strokeStyle = 'rgba(207, 234, 208, 0.25)';
    pen.lineWidth = 1.5;
    pen.beginPath();
    pen.roundRect(0.75, 0.75, w - 1.5, h - 1.5, 5);
    pen.stroke();
  }, { key: `slot-${width}x${height}`, x, y, depth });
}

export function label(board: Board, x: number, y: number, text: string,
  color = '#7fae86', size = 10, font = DISPLAY_FONT): Sprite {
  return board.text(text, { font, size, color }, { x, y, depth: 0 });
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
