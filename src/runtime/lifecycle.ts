// The page's lifecycle, as one stream of plain events.
//
// None of the engines felt was compared with (see docs/runtime.md) handles
// the back/forward cache, and a board that sleeps when nothing moves is the
// worst case for it: a page brought back from the cache, a tab brought back
// from the background, or a page thawed after being frozen may come back
// with its canvas blank, and a sleeping board would leave it so. The browser
// says all of this through six different events with overlapping meanings;
// this folds them into two states and a few notices.
//
// `active` is false while the page is hidden, frozen, or being put into the
// cache. `'resume'` fires every time it becomes true again, with why, and is
// the moment to drop the time that passed, check the GPU, and draw.

export type LifecycleEvent =
  /** The page stopped being shown or running: hidden, frozen, or cached. */
  | { type: 'suspend'; reason: 'hidden' | 'freeze' | 'pagehide'; persisted?: boolean }
  /** The page is back: shown, thawed, or restored from the back/forward cache. */
  | { type: 'resume'; reason: 'visible' | 'resume' | 'pageshow'; persisted?: boolean }
  /** The window lost or gained focus. The page is still running. */
  | { type: 'blur' } | { type: 'focus' }
  /** devicePixelRatio changed: the window moved to another screen, or was zoomed. */
  | { type: 'pixelratio'; ratio: number };

export interface LifecycleHost {
  document: Pick<Document, 'addEventListener' | 'removeEventListener'> & { readonly hidden?: boolean };
  window: Pick<Window, 'addEventListener' | 'removeEventListener'> & {
    readonly devicePixelRatio?: number;
    matchMedia?: (query: string) => Pick<MediaQueryList, 'addEventListener' | 'removeEventListener'>;
  };
}

type Listener = (event: LifecycleEvent) => void;

export class PageLifecycle {
  /** Whether the page is shown and running. */
  active: boolean;
  /** Times it has come back from being suspended, for anyone measuring. */
  resumes = 0;
  private readonly listeners = new Set<Listener>();
  private readonly cleanup: (() => void)[] = [];
  private suspendedFor = new Set<string>();

  constructor(private readonly host: LifecycleHost = { document, window }) {
    this.active = !host.document.hidden;
    if (!this.active) this.suspendedFor.add('hidden');
    const on = (target: LifecycleHost['document'] | LifecycleHost['window'], type: string,
      handler: (event: Event) => void) => {
      target.addEventListener(type, handler);
      this.cleanup.push(() => target.removeEventListener(type, handler));
    };
    on(host.document, 'visibilitychange', () => {
      if (host.document.hidden) this.suspend('hidden');
      else this.resume('hidden', 'visible');
    });
    // Page Lifecycle API: a frozen page runs nothing until it is resumed.
    on(host.document, 'freeze', () => this.suspend('freeze'));
    on(host.document, 'resume', () => this.resume('freeze', 'resume'));
    // The back/forward cache. `persisted` on pagehide means the page is
    // going into it rather than away; on pageshow, that it came out of it.
    on(host.window, 'pagehide', (event) => {
      this.suspend('pagehide', (event as PageTransitionEvent).persisted);
    });
    on(host.window, 'pageshow', (event) => {
      const persisted = (event as PageTransitionEvent).persisted;
      // The first pageshow of a fresh load is not a return from anywhere.
      if (!persisted && !this.suspendedFor.has('pagehide')) return;
      // Out of the cache, everything is suspect: resume whatever the page
      // was suspended for, since some browsers send nothing else.
      if (persisted) this.suspendedFor.clear();
      this.resume('pagehide', 'pageshow', persisted, true);
    });
    on(host.window, 'blur', () => this.emit({ type: 'blur' }));
    on(host.window, 'focus', () => this.emit({ type: 'focus' }));
    this.watchRatio();
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    for (const fn of this.cleanup.splice(0).reverse()) fn();
    this.listeners.clear();
  }

  private suspend(reason: 'hidden' | 'freeze' | 'pagehide', persisted?: boolean): void {
    this.suspendedFor.add(reason);
    const was = this.active;
    this.active = false;
    if (was) this.emit({ type: 'suspend', reason, persisted });
  }

  private resume(cause: string, reason: 'visible' | 'resume' | 'pageshow', persisted?: boolean,
    always = false): void {
    this.suspendedFor.delete(cause);
    if (this.suspendedFor.size && !always) return;
    // A return from the cache always counts as a return, even if the page
    // never saw itself go: it may be showing a canvas nobody drew.
    if (this.active && !always) return;
    this.suspendedFor.clear();
    this.active = true;
    this.resumes++;
    this.emit({ type: 'resume', reason, persisted });
  }

  /**
   * A media query for exactly the current ratio stops matching when the
   * ratio changes; then it is asked again for the new one.
   */
  private watchRatio(): void {
    const win = this.host.window;
    if (!win.matchMedia || !win.devicePixelRatio) return;
    let stop = () => {};
    const watch = () => {
      const query = win.matchMedia!(`(resolution: ${win.devicePixelRatio}dppx)`);
      const changed = () => {
        stop();
        this.emit({ type: 'pixelratio', ratio: win.devicePixelRatio ?? 1 });
        watch();
      };
      query.addEventListener('change', changed);
      stop = () => query.removeEventListener('change', changed);
    };
    watch();
    this.cleanup.push(() => stop());
  }

  private emit(event: LifecycleEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
