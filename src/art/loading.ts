import type { Board } from '../scene/board.js';
import { ArtKind, CardArt } from './card-art.js';
import { CardSheets } from './card-sheets.js';

// How far the engine has got towards drawing its first card.
//
// A card on a board that waits for art (the default) is not drawn until its
// sheets are finished, so "ready" has a precise meaning: every sheet a card
// is using has every face painted, with its fonts, pips and portraits. This
// is the account of getting there, stage by stage, for a loading screen or a
// debug page - and `cardsReady` is the moment itself.

export type LoadingStageId = 'gl' | 'fonts' | 'suits' | 'backs' | 'courts' | 'sheets';

export interface LoadingStage {
  id: LoadingStageId;
  label: string;
  /** Finished, failed included: a failed piece of art is one nobody waits for. */
  done: number;
  total: number;
  failed: number;
  /** Milliseconds from the board being made to the stage first being complete. */
  finishedAt?: number;
}

export interface LoadingReport {
  stages: LoadingStage[];
  /** Every sheet in use is finished, and there is at least one. */
  ready: boolean;
  /** Milliseconds since the board was made. */
  elapsed: number;
  /** When `ready` first came true, in milliseconds from the board being made. */
  readyAt?: number;
  /** What is still on its way, by key: for a page that wants to name it. */
  waitingFor: string[];
}

const LABELS: Record<LoadingStageId, string> = {
  gl: 'WebGL2 context',
  fonts: 'Index fonts',
  suits: 'Suit glyphs',
  backs: 'Card backs',
  courts: 'Court portraits',
  sheets: 'Card sheets painted',
};

const ORDER: LoadingStageId[] = ['gl', 'fonts', 'suits', 'backs', 'courts', 'sheets'];
const BY_KIND: Partial<Record<ArtKind, LoadingStageId>> = {
  font: 'fonts', suit: 'suits', back: 'backs', court: 'courts',
};

class Loading {
  private readonly finished = new Map<LoadingStageId, number>();
  private readyAt?: number;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly board: Board) {
    // Checked as each frame is drawn: every step towards ready (art landing,
    // a cell painted, art given up on) wakes the board for a frame.
    board.on('render', () => this.report());
  }

  static of(board: Board): Loading {
    let loading = board.services.get('loading') as Loading | undefined;
    if (!loading) {
      loading = new Loading(board);
      board.services.set('loading', loading);
    }
    return loading;
  }

  report(): LoadingReport {
    const board = this.board;
    const now = performance.now() - board.createdAt;
    const stages = new Map<LoadingStageId, LoadingStage>();
    for (const id of ORDER) stages.set(id, { id, label: LABELS[id], done: 0, total: 0, failed: 0 });

    const gl = stages.get('gl')!;
    gl.total = 1;
    gl.done = board.renderer.lost ? 0 : 1;

    const waitingFor: string[] = [];
    for (const { key, kind, status } of CardArt.of(board).report()) {
      const id = BY_KIND[kind];
      if (!id) continue;
      const stage = stages.get(id)!;
      stage.total++;
      if (status === 'pending') waitingFor.push(key);
      else stage.done++;
      if (status === 'failed') stage.failed++;
    }

    const sheets = CardSheets.of(board);
    const painted = stages.get('sheets')!;
    for (const sheet of sheets.progress()) {
      painted.done += sheet.done;
      painted.total += sheet.total;
    }
    const ready = painted.total > 0 && sheets.ready();

    for (const stage of stages.values()) {
      if (stage.total > 0 && stage.done === stage.total && !this.finished.has(stage.id)) {
        this.finished.set(stage.id, now);
      }
      stage.finishedAt = this.finished.get(stage.id);
    }
    if (ready && this.readyAt === undefined) {
      this.readyAt = now;
      for (const resolve of this.waiters.splice(0)) resolve();
    }
    return { stages: [...stages.values()], ready, elapsed: now, readyAt: this.readyAt, waitingFor };
  }

  whenReady(): Promise<void> {
    if (this.readyAt !== undefined) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.board.touch();
    });
  }
}

/** Where the engine has got to, towards drawing finished cards. */
export function loadingReport(board: Board): LoadingReport {
  return Loading.of(board).report();
}

/**
 * Resolves the first time every sheet a card is using is finished - the
 * frame the first cards are drawn, on a board that waits for art. Make the
 * cards first: with none, there is nothing to be ready.
 */
export function cardsReady(board: Board): Promise<void> {
  return Loading.of(board).whenReady();
}
