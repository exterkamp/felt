import type { Dispose } from '../runtime/disposables.js';
import { Engine, engine as pageEngine, serviceOf } from '../runtime/engine.js';

// Saying what happened, to someone who cannot see the table.
//
// A canvas is one opaque image to assistive technology: a screen reader
// cannot see that the seven of hearts moved, or that it is your turn. An
// ARIA live region is the way a page speaks without moving focus - text put
// into it is read out, politely (when the reader is next idle) or
// assertively (now, interrupting).
//
// **One per page: an engine service.** Live regions are a shared channel.
// Two of them (one per board, say) talk over each other: readers queue,
// drop or interleave updates from separate regions differently, and nothing
// can coalesce across them. One region per politeness, made once and kept
// for the life of the page, also means it is already in the document when
// its first message arrives - a region added and filled in the same moment
// is often not read at all - and that a message is not cut off by a scene
// changing under it ("You win!" and then the results screen).
//
// **Coalescing.** A game says things in bursts: a move, its consequence, the
// turn passing, a score - four messages in one frame. Read one by one, each
// interrupts or queues behind the last. So polite messages wait for a short
// quiet spell (`delay`, at most `maxWait` in all) and go as one sentence;
// a message with a `key` replaces any waiting with the same key (a score
// bumped sixty times is read once, at its last value); the same text twice
// in a burst is said once. Assertive ones go at the next frame, together.

export type Politeness = 'polite' | 'assertive';

export interface AnnounceOptions {
  /** Default `'polite'`. Assertive interrupts: keep it for what cannot wait. */
  politeness?: Politeness;
  /** A message waiting with the same key is replaced by this one. */
  key?: string;
}

export interface Announcement {
  readonly text: string;
  readonly politeness: Politeness;
}

export interface AnnouncePolicy {
  /** Quiet milliseconds a polite burst waits for before it is said. Default 250. */
  delay?: number;
  /** Most milliseconds a polite message waits, however busy it gets. Default 1000. */
  maxWait?: number;
  /** Between the messages of a burst. Default `' '`. */
  separator?: string;
}

interface Waiting { text: string; key?: string }

/** The coalescing, with no DOM: `push`, then `step(ms)` answers what to say now. */
export class AnnounceQueue {
  private polite: Waiting[] = [];
  private assertive: Waiting[] = [];
  private quiet = 0;
  private waited = 0;
  readonly delay: number;
  readonly maxWait: number;
  readonly separator: string;

  constructor(policy: AnnouncePolicy = {}) {
    this.delay = policy.delay ?? 250;
    this.maxWait = policy.maxWait ?? 1000;
    this.separator = policy.separator ?? ' ';
  }

  /** Whether anything is waiting to be said. */
  get pending(): boolean {
    return this.polite.length > 0 || this.assertive.length > 0;
  }

  push(text: string, options: AnnounceOptions = {}): void {
    const clean = text.trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const list = options.politeness === 'assertive' ? this.assertive : this.polite;
    if (list === this.polite) {
      if (!this.polite.length) this.waited = 0;
      this.quiet = 0;
    }
    if (options.key !== undefined) {
      const at = list.findIndex((w) => w.key === options.key);
      // Replaced where the newest would go: it is news as of now.
      if (at >= 0) list.splice(at, 1);
    }
    const same = list.findIndex((w) => w.text === clean);
    if (same >= 0) list.splice(same, 1);
    list.push({ text: clean, key: options.key });
  }

  /** Moves time on. Answers what is due now: assertive first, then a polite burst. */
  step(ms: number): Announcement[] {
    const out: Announcement[] = [];
    if (this.assertive.length) {
      out.push({ text: this.join(this.assertive), politeness: 'assertive' });
      this.assertive = [];
    }
    if (this.polite.length) {
      this.quiet += ms;
      this.waited += ms;
      if (this.quiet >= this.delay || this.waited >= this.maxWait) out.push(...this.flushPolite());
    }
    return out;
  }

  /** Everything waiting, now. */
  flush(): Announcement[] {
    const out: Announcement[] = [];
    if (this.assertive.length) out.push({ text: this.join(this.assertive), politeness: 'assertive' });
    this.assertive = [];
    out.push(...this.flushPolite());
    return out;
  }

  /** Forgets what is waiting: everything, or the messages with a key. */
  cancel(key?: string): void {
    if (key === undefined) {
      this.polite = [];
      this.assertive = [];
      return;
    }
    this.polite = this.polite.filter((w) => w.key !== key);
    this.assertive = this.assertive.filter((w) => w.key !== key);
  }

  private flushPolite(): Announcement[] {
    if (!this.polite.length) return [];
    const text = this.join(this.polite);
    this.polite = [];
    this.quiet = 0;
    this.waited = 0;
    return [{ text, politeness: 'polite' }];
  }

  /** One sentence of a burst, each part ending in its own stop. */
  private join(list: Waiting[]): string {
    return list.map((w, i) => (i < list.length - 1 && !/[.!?…:;]$/.test(w.text) ? `${w.text}.` : w.text))
      .join(this.separator);
  }
}

/** Hidden from sight, not from assistive technology. */
const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', border: '0',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
};

/**
 * The page's live regions, and the queue in front of them. Get it with
 * `announcerOf(engine)`, or speak through `announce(text)`.
 */
export class Announcer {
  readonly queue: AnnounceQueue;
  /** The polite region (`role="status"`). Its text is the last polite message said. */
  readonly politeRegion: HTMLElement;
  /** The assertive region (`role="alert"`). */
  readonly assertiveRegion: HTMLElement;
  /** What has been said, newest last; the last 50. */
  readonly said: (Announcement & { at: number })[] = [];
  private readonly listeners = new Set<(said: Announcement) => void>();
  private stopTicking?: Dispose;
  /** Flipped each write, so the same words twice in a row are still read twice. */
  private parity = false;

  constructor(readonly engine: Engine, policy: AnnouncePolicy = {}) {
    this.queue = new AnnounceQueue(policy);
    this.politeRegion = this.region('polite');
    this.assertiveRegion = this.region('assertive');
  }

  /**
   * Says something. Polite messages are coalesced with the others in the same
   * burst (see the policy above); assertive ones go at the next frame.
   */
  announce(text: string, options: AnnounceOptions = {}): void {
    this.queue.push(text, options);
    if (this.queue.pending && !this.stopTicking) {
      this.stopTicking = this.engine.onUpdate((delta) => this.tick(delta));
    }
  }

  /** Says everything waiting now, without waiting for the burst to end. */
  flush(): void {
    for (const said of this.queue.flush()) this.write(said);
    this.idle();
  }

  /** Forgets what is waiting: all of it, or what has a key. */
  cancel(key?: string): void {
    this.queue.cancel(key);
    if (!this.queue.pending) this.idle();
  }

  /** Calls back with each thing said - for a visible log, for sighted testers. */
  onAnnounce(fn: (said: Announcement) => void): Dispose {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Engine teardown: the regions leave the page. */
  dispose(): void {
    this.idle();
    this.listeners.clear();
    this.politeRegion.remove();
    this.assertiveRegion.remove();
  }

  private tick(delta: number): void {
    for (const said of this.queue.step(delta)) this.write(said);
    if (!this.queue.pending) this.idle();
  }

  private idle(): void {
    this.stopTicking?.();
    this.stopTicking = undefined;
  }

  private write(said: Announcement): void {
    const region = said.politeness === 'assertive' ? this.assertiveRegion : this.politeRegion;
    this.parity = !this.parity;
    // A trailing no-break space on every other write: a region whose text
    // does not change is not read again.
    region.textContent = this.parity ? said.text : `${said.text} `;
    this.said.push({ ...said, at: this.engine.time });
    if (this.said.length > 50) this.said.shift();
    for (const fn of [...this.listeners]) fn(said);
  }

  private region(politeness: Politeness): HTMLElement {
    const el = document.createElement('div');
    el.className = `felt-announcer felt-announcer--${politeness}`;
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
    Object.assign(el.style, VISUALLY_HIDDEN);
    document.body.appendChild(el);
    return el;
  }
}

/** The page's announcer: made, with its live regions, the first time it is asked for. */
export function announcerOf(owner: Engine = pageEngine()): Announcer {
  return serviceOf(owner, 'felt:announcer', () => new Announcer(owner));
}

/** Says something to assistive technology, through the page's live region. */
export function announce(text: string, options: AnnounceOptions & { engine?: Engine } = {}): void {
  announcerOf(options.engine).announce(text, options);
}
