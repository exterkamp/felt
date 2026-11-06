// Teardown, as a habit rather than a chore.
//
// Everything that hooks into something longer-lived - a listener on the
// engine, a frame callback, a timer, a node on a board - hands back a function
// that unhooks it, and that function goes into the scope that asked for it:
// the engine's, a board's, a scene's. Ending the scope unhooks the lot, last
// first. Nothing is left listening to a board that is gone, which is how a
// page that swaps one board for another used to leak.

export type Dispose = () => void;

export class Disposables {
  private readonly list: Dispose[] = [];
  private done = false;

  /** Keeps a teardown for when the scope ends. Ended already: runs it now. */
  add<T extends Dispose>(dispose: T): T {
    if (this.done) {
      dispose();
      return dispose;
    }
    this.list.push(dispose);
    return dispose;
  }

  /** Runs one teardown early, and forgets it. */
  run(dispose: Dispose): void {
    const at = this.list.indexOf(dispose);
    if (at >= 0) this.list.splice(at, 1);
    dispose();
  }

  get disposed(): boolean {
    return this.done;
  }

  /**
   * Runs every teardown, newest first. One that throws does not stop the
   * rest: half a teardown is worse than a logged error.
   */
  dispose(): void {
    if (this.done) return;
    this.done = true;
    while (this.list.length) {
      const dispose = this.list.pop()!;
      try {
        dispose();
      } catch (error) {
        console.error('felt: a teardown threw', error);
      }
    }
  }
}
