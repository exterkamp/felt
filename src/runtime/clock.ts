// Where the engine's time comes from.
//
// The loop never calls requestAnimationFrame or performance.now itself: it
// asks a clock. In a browser that is the display's frame callback. In a test,
// on a server, or replaying a recorded game, it is a clock somebody turns by
// hand, so the same loop - fixed steps, animations, timers - runs to the
// millisecond the same way every time.

export interface Clock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Calls back once, at the next frame, with the frame's time. */
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

/** The display's own clock: requestAnimationFrame and performance.now. */
export class RafClock implements Clock {
  now(): number {
    return performance.now();
  }

  request(callback: (now: number) => void): number {
    return requestAnimationFrame(callback);
  }

  cancel(handle: number): void {
    cancelAnimationFrame(handle);
  }
}

/**
 * A clock turned by hand. `advance(ms)` moves time on, running a frame every
 * `frameMs` along the way for whatever has asked for one.
 */
export class ManualClock implements Clock {
  private time = 0;
  private next = 1;
  private readonly waiting = new Map<number, (now: number) => void>();

  constructor(readonly frameMs = 1000 / 60) {}

  now(): number {
    return this.time;
  }

  request(callback: (now: number) => void): number {
    const handle = this.next++;
    this.waiting.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.waiting.delete(handle);
  }

  /** Whether anything is waiting for a frame. */
  get pending(): boolean {
    return this.waiting.size > 0;
  }

  /** Runs one frame `ms` after the last, for everything waiting. */
  frame(ms = this.frameMs): void {
    this.time += ms;
    const due = [...this.waiting.values()];
    this.waiting.clear();
    for (const callback of due) callback(this.time);
  }

  /** Moves on by `ms`, a frame at a time. Time passes even with nothing waiting. */
  advance(ms: number): void {
    let left = ms;
    while (left > 1e-9) {
      const step = Math.min(this.frameMs, left);
      if (this.waiting.size) this.frame(step);
      else this.time += step;
      left -= step;
    }
  }
}
