import { describe, expect, it } from 'vitest';
import { LifecycleEvent, PageLifecycle } from './lifecycle.js';

function page(hidden = false) {
  const doc = Object.assign(new EventTarget(), { hidden });
  const win = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  const lifecycle = new PageLifecycle({ document: doc, window: win });
  const seen: LifecycleEvent[] = [];
  lifecycle.on((e) => seen.push(e));
  const fire = (target: EventTarget, type: string, extra: object = {}) =>
    target.dispatchEvent(Object.assign(new Event(type), extra));
  return { doc, win, lifecycle, seen, fire };
}

describe('the page lifecycle', () => {
  it('suspends when hidden and resumes when shown', () => {
    const { doc, lifecycle, seen, fire } = page();
    doc.hidden = true; fire(doc, 'visibilitychange');
    expect(lifecycle.active).toBe(false);
    doc.hidden = false; fire(doc, 'visibilitychange');
    expect(lifecycle.active).toBe(true);
    expect(seen.map((e) => e.type)).toEqual(['suspend', 'resume']);
  });

  it('stays suspended until every reason has gone: hidden and frozen', () => {
    const { doc, lifecycle, seen, fire } = page();
    doc.hidden = true; fire(doc, 'visibilitychange');
    fire(doc, 'freeze');
    fire(doc, 'resume');
    expect(lifecycle.active).toBe(false);
    doc.hidden = false; fire(doc, 'visibilitychange');
    expect(lifecycle.active).toBe(true);
    expect(seen.filter((e) => e.type === 'resume')).toHaveLength(1);
  });

  it('a page out of the back/forward cache always resumes, even unannounced', () => {
    const { win, lifecycle, seen, fire } = page();
    // No pagehide seen (some browsers freeze without telling the page).
    fire(win, 'pageshow', { persisted: true });
    expect(lifecycle.active).toBe(true);
    expect(seen).toEqual([{ type: 'resume', reason: 'pageshow', persisted: true }]);
  });

  it('a pagehide into the cache and back is one suspend and one resume', () => {
    const { win, seen, fire } = page();
    fire(win, 'pagehide', { persisted: true });
    fire(win, 'pageshow', { persisted: true });
    expect(seen.map((e) => e.type)).toEqual(['suspend', 'resume']);
  });

  it('the first pageshow of a fresh load is not a return', () => {
    const { win, seen, fire } = page();
    fire(win, 'pageshow', { persisted: false });
    expect(seen).toEqual([]);
  });

  it('starts suspended in a tab opened in the background', () => {
    const { doc, lifecycle, seen, fire } = page(true);
    expect(lifecycle.active).toBe(false);
    doc.hidden = false; fire(doc, 'visibilitychange');
    expect(seen.map((e) => e.type)).toEqual(['resume']);
  });

  it('lets every listener go when destroyed', () => {
    const { doc, lifecycle, seen, fire } = page();
    lifecycle.destroy();
    doc.hidden = true; fire(doc, 'visibilitychange');
    expect(seen).toEqual([]);
  });
});
