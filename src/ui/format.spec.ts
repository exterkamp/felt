import { describe, expect, it } from 'vitest';
import { formatClock, formatNumber, parseColor } from './format.js';

describe('formatNumber', () => {
  it('groups thousands and rounds', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(12.6)).toBe('13');
    expect(formatNumber(1234567, { group: '' })).toBe('1234567');
    expect(formatNumber(1234567, { group: ' ' })).toBe('1 234 567');
  });

  it('writes signs, decimals, padding and affixes', () => {
    expect(formatNumber(-1500)).toBe('-1,500');
    expect(formatNumber(15, { sign: 'always' })).toBe('+15');
    expect(formatNumber(-15, { sign: 'always' })).toBe('-15');
    expect(formatNumber(-15, { sign: 'never' })).toBe('15');
    expect(formatNumber(0, { sign: 'always' })).toBe('0');
    // A negative that rounds to nothing is not negative.
    expect(formatNumber(-0.4)).toBe('0');
    expect(formatNumber(2.5, { decimals: 2, prefix: '$' })).toBe('$2.50');
    expect(formatNumber(-2.5, { decimals: 1, prefix: '$' })).toBe('-$2.5');
    expect(formatNumber(1234.5, { decimals: 1, group: '.', point: ',' })).toBe('1.234,5');
    expect(formatNumber(7, { pad: 3 })).toBe('007');
    expect(formatNumber(24, { prefix: 'Stock ' })).toBe('Stock 24');
    expect(formatNumber(3, { suffix: ' pts' })).toBe('3 pts');
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(Number.NaN)).toBe('–');
  });
});

describe('formatClock', () => {
  it('is mm:ss, with hours from an hour', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(999)).toBe('00:00');
    expect(formatClock(187_000)).toBe('03:07');
    expect(formatClock(59 * 60_000 + 59_999)).toBe('59:59');
    expect(formatClock(3_600_000)).toBe('01:00:00');
    expect(formatClock(3_725_000, { padLead: false })).toBe('1:02:05');
    expect(formatClock(65_000, { hours: 'always' })).toBe('00:01:05');
    expect(formatClock(65_000, { padLead: false })).toBe('1:05');
  });

  it('counts down with ceil, never below zero, and shows tenths', () => {
    expect(formatClock(9_001, { round: 'ceil' })).toBe('00:10');
    expect(formatClock(1, { round: 'ceil' })).toBe('00:01');
    expect(formatClock(-5_000)).toBe('00:00');
    expect(formatClock(67_450, { tenths: true })).toBe('01:07.4');
  });
});

describe('parseColor', () => {
  it('reads numbers, hex and rgb() without a browser', () => {
    expect(parseColor(undefined)).toBe(0xffffff);
    expect(parseColor(0x123456)).toBe(0x123456);
    expect(parseColor('#ffd166')).toBe(0xffd166);
    expect(parseColor('#fd6')).toBe(0xffdd66);
    expect(parseColor('#ffd16680')).toBe(0xffd166);
    expect(parseColor('rgb(255, 0, 16)')).toBe(0xff0010);
    expect(parseColor('rgba(1 2 3 / 0.5)')).toBe(0x010203);
    expect(parseColor('gold')).toBe(0xffffff);
  });
});
