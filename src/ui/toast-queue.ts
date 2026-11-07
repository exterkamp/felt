// What toasts are showing, and for how long: the policy, with no DOM in it.
//
// A toast goes queued -> entering -> shown -> leaving -> gone. Time is
// handed in by `step(ms)` - the board's frame clock in a page, a test's hand
// in node - so a toast pauses with the page and can be tested without one.
//
// The policy, per place:
//
// - **top / bottom**: up to `maxVisible` (default 3) stacked; more wait in a
//   queue, oldest first. A queue longer than `maxQueued` drops its oldest
//   non-urgent entries: by the time they would show they are stale.
// - **center**: one at a time ("Player 2's turn"), queued the same way.
// - **float**: text rising off a point ("+10"). Never queued - a late "+10"
//   is a wrong one - so past `maxVisible` the oldest is sent off early.
// - **The same toast again** (same `key`, default its text, in the same
//   place) while one is up or waiting is not a second toast: the one there
//   counts it ("Nice! ×3") and starts its time again. Floats do not
//   coalesce: two "+10"s are two.
// - **urgent** jumps the queue and, if its place is full, sends the oldest
//   up off at once.

export type ToastPlace = 'top' | 'center' | 'bottom' | 'float';
export type ToastPhase = 'queued' | 'entering' | 'shown' | 'leaving' | 'gone';

export interface ToastSpec {
  text: string;
  place?: ToastPlace;
  /** Milliseconds fully shown. Default `durationFor(text)`; Infinity until dismissed. */
  duration?: number;
  urgent?: boolean;
  /** What makes two toasts the same one. Default the text. */
  key?: string;
  /** Whether a repeat is counted onto this one. Default true, false for floats. */
  coalesce?: boolean;
}

export interface ToastState {
  readonly id: number;
  readonly text: string;
  readonly place: ToastPlace;
  readonly key: string;
  readonly urgent: boolean;
  readonly coalesce: boolean;
  duration: number;
  phase: ToastPhase;
  /** Milliseconds into the current phase. */
  age: number;
  /** How many times it was asked for: 1, then 2 if repeated while up. */
  count: number;
}

export interface ToastPolicy {
  /** Shown at once, per place. */
  maxVisible?: Partial<Record<ToastPlace, number>>;
  /** Waiting, per place, before the oldest are dropped. Default 4. */
  maxQueued?: number;
  /** Milliseconds to come in and to go. Defaults 180 and 220. */
  enter?: number;
  exit?: number;
}

const VISIBLE: Record<ToastPlace, number> = { top: 3, bottom: 3, center: 1, float: 12 };

/**
 * How long a message stays up by default: long enough to read it - about a
 * fifth of a second a character on top of a second and a half - and never
 * less than two seconds or more than seven.
 */
export function durationFor(text: string): number {
  return Math.min(7000, Math.max(2000, 1500 + text.length * 60));
}

export class ToastQueue {
  private readonly toasts: ToastState[] = [];
  private serial = 0;
  readonly maxVisible: Record<ToastPlace, number>;
  readonly maxQueued: number;
  readonly enter: number;
  readonly exit: number;
  /** Toasts dropped from a full queue without ever showing. */
  dropped = 0;

  constructor(policy: ToastPolicy = {}) {
    this.maxVisible = { ...VISIBLE, ...policy.maxVisible };
    this.maxQueued = policy.maxQueued ?? 4;
    this.enter = policy.enter ?? 180;
    this.exit = policy.exit ?? 220;
  }

  /** Every toast not yet gone, in the order they were asked for. */
  get all(): readonly ToastState[] {
    return this.toasts;
  }

  /** Whether anything is still to happen: a toast up, coming, going or waiting. */
  get busy(): boolean {
    return this.toasts.length > 0;
  }

  /** On screen (entering, shown or leaving) in a place, oldest first. */
  showing(place: ToastPlace): ToastState[] {
    return this.toasts.filter((t) => t.place === place && t.phase !== 'queued' && t.phase !== 'gone');
  }

  /** Asks for a toast. Answers it - or the one already up that it was counted onto. */
  push(spec: ToastSpec): ToastState {
    const place = spec.place ?? 'top';
    const key = spec.key ?? spec.text;
    const coalesce = spec.coalesce ?? place !== 'float';
    if (coalesce) {
      const same = this.toasts.find((t) => t.place === place && t.key === key && t.coalesce
        && (t.phase === 'queued' || t.phase === 'entering' || t.phase === 'shown'));
      if (same) {
        same.count++;
        if (same.phase === 'shown') same.age = 0;
        return same;
      }
    }
    const toast: ToastState = {
      id: ++this.serial, text: spec.text, place, key, urgent: spec.urgent ?? false, coalesce,
      duration: spec.duration ?? durationFor(spec.text), phase: 'queued', age: 0, count: 1,
    };
    if (toast.urgent) {
      // In front of everything waiting in its place.
      const first = this.toasts.findIndex((t) => t.place === place && t.phase === 'queued');
      if (first >= 0) this.toasts.splice(first, 0, toast);
      else this.toasts.push(toast);
    } else {
      this.toasts.push(toast);
    }
    this.admit(place, toast.urgent || place === 'float');
    this.trim(place);
    return toast;
  }

  /** Sends a toast off now (or drops it, if it never showed). */
  dismiss(id: number): void {
    const toast = this.toasts.find((t) => t.id === id);
    if (!toast) return;
    if (toast.phase === 'queued') {
      toast.phase = 'gone';
      this.toasts.splice(this.toasts.indexOf(toast), 1);
      return;
    }
    this.leave(toast);
  }

  /** Sends everything off and empties the queue. */
  clear(): void {
    for (const toast of [...this.toasts]) this.dismiss(toast.id);
  }

  /**
   * Moves time on by `ms`. Answers the toasts that went this step, so a view
   * can take their elements away.
   */
  step(ms: number): ToastState[] {
    const gone: ToastState[] = [];
    for (const toast of [...this.toasts]) {
      if (toast.phase === 'queued' || toast.phase === 'gone') continue;
      toast.age += ms;
      if (toast.phase === 'entering' && toast.age >= this.enter) {
        toast.phase = 'shown';
        toast.age -= this.enter;
      }
      if (toast.phase === 'shown' && toast.age >= toast.duration) {
        toast.phase = 'leaving';
        toast.age -= toast.duration;
      }
      if (toast.phase === 'leaving' && toast.age >= this.exit) {
        toast.phase = 'gone';
        this.toasts.splice(this.toasts.indexOf(toast), 1);
        gone.push(toast);
      }
    }
    for (const place of Object.keys(this.maxVisible) as ToastPlace[]) this.admit(place, false);
    return gone;
  }

  /** How far through its phase a toast is, 0-1. */
  progress(toast: ToastState): number {
    const length = toast.phase === 'entering' ? this.enter : toast.phase === 'leaving' ? this.exit
      : toast.phase === 'shown' ? toast.duration : 0;
    return length > 0 && Number.isFinite(length) ? Math.min(1, toast.age / length) : toast.phase === 'gone' ? 1 : 0;
  }

  /** Brings waiting toasts on while there is room; `force` makes room for the first. */
  private admit(place: ToastPlace, force: boolean): void {
    const cap = Math.max(1, this.maxVisible[place]);
    const up = () => this.toasts.filter((t) => t.place === place && (t.phase === 'entering' || t.phase === 'shown'));
    for (const toast of this.toasts.filter((t) => t.place === place && t.phase === 'queued')) {
      if (up().length >= cap) {
        if (!force) return;
        // The oldest goes, early, for this one.
        this.leave(up()[0]);
      }
      toast.phase = 'entering';
      toast.age = 0;
      force = false;
    }
  }

  /** Drops the oldest waiting toasts beyond the limit, urgent ones last. */
  private trim(place: ToastPlace): void {
    const waiting = () => this.toasts.filter((t) => t.place === place && t.phase === 'queued');
    while (waiting().length > this.maxQueued) {
      const list = waiting();
      const victim = list.find((t) => !t.urgent) ?? list[0];
      victim.phase = 'gone';
      this.toasts.splice(this.toasts.indexOf(victim), 1);
      this.dropped++;
    }
  }

  private leave(toast: ToastState): void {
    if (toast.phase === 'leaving' || toast.phase === 'gone') return;
    // Leaving half way in: go from where it got to, not from fully shown.
    const seen = toast.phase === 'entering' ? Math.min(1, toast.age / Math.max(1, this.enter)) : 1;
    toast.phase = 'leaving';
    toast.age = (1 - seen) * this.exit;
  }
}
