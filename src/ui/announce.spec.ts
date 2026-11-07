import { describe, expect, it } from 'vitest';
import { AnnounceQueue, Announcement } from './announce.js';

describe('AnnounceQueue', () => {
  it('waits for a quiet spell and says a burst as one sentence', () => {
    const q = new AnnounceQueue({ delay: 100 });
    q.push('You moved the seven of hearts to column three');
    q.step(50);
    q.push('Your turn');
    expect(q.step(60)).toEqual([]);   // the second message restarted the quiet
    expect(q.step(40)).toEqual([{ text: 'You moved the seven of hearts to column three. Your turn', politeness: 'polite' }]);
    expect(q.pending).toBe(false);
  });

  it('says a busy stream at least every maxWait', () => {
    const q = new AnnounceQueue({ delay: 100, maxWait: 300 });
    const said: Announcement[] = [];
    for (let t = 0; t < 300; t += 50) {
      q.push(`m${t}`);
      said.push(...q.step(50));
    }
    expect(said.length).toBe(1);
    expect(said[0].text.startsWith('m0.')).toBe(true);
  });

  it('keeps only the newest of a key, and the same words once', () => {
    const q = new AnnounceQueue({ delay: 10 });
    for (let score = 1; score <= 60; score++) q.push(`Score ${score}`, { key: 'score' });
    q.push('Nice!');
    q.push('Nice!');
    expect(q.step(10)).toEqual([{ text: 'Score 60. Nice!', politeness: 'polite' }]);
  });

  it('says assertive messages at the next step, before polite ones', () => {
    const q = new AnnounceQueue({ delay: 100 });
    q.push('Card placed');
    q.push('Time is up!', { politeness: 'assertive' });
    q.push('Game over', { politeness: 'assertive' });
    expect(q.step(16)).toEqual([{ text: 'Time is up! Game over', politeness: 'assertive' }]);
    expect(q.step(100)).toEqual([{ text: 'Card placed', politeness: 'polite' }]);
  });

  it('flushes, cancels, and ignores blank messages', () => {
    const q = new AnnounceQueue();
    q.push('   ');
    expect(q.pending).toBe(false);
    q.push('a', { key: 'x' });
    q.push('b');
    q.cancel('x');
    expect(q.flush()).toEqual([{ text: 'b', politeness: 'polite' }]);
    q.push('c');
    q.cancel();
    expect(q.flush()).toEqual([]);
  });
});
