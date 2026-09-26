import { describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, formatRelativeTime } from './date';

describe('formatDate', () => {
  it('formats an ISO date string as DD/MM/YYYY', () => {
    expect(formatDate('2026-03-05T00:00:00.000Z')).toBe('05/03/2026');
  });

  it('formats a Date object as DD/MM/YYYY', () => {
    expect(formatDate(new Date('2026-12-01T00:00:00.000Z'))).toBe('01/12/2026');
  });
});

describe('formatDateTime', () => {
  it('formats an ISO date string as DD/MM/YYYY plus the time', () => {
    // The date component is timezone-dependent (this formats in the viewer's local time,
    // unlike formatDate), so only the overall DD/MM/YYYY, HH:mm shape is asserted here.
    expect(formatDateTime('2026-03-05T14:30:00.000Z')).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}$/);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-03-05T12:00:00.000Z');

  it('formats a few minutes ago in minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60 * 1000))).toBe('hace 5 minutos');
    vi.useRealTimers();
  });

  it('formats a couple hours ago in hours, not minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 60 * 60 * 1000))).toBe('hace 2 horas');
    vi.useRealTimers();
  });

  it('formats two days ago using the special-cased Spanish word, not a raw number', () => {
    // numeric: 'auto' prefers idiomatic phrasing ("anteayer") over "hace 2 días", the same
    // way English prefers "yesterday" over "1 day ago".
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000))).toBe('anteayer');
    vi.useRealTimers();
  });

  it('accepts an ISO string the same as a Date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60 * 1000).toISOString())).toBe('hace 5 minutos');
    vi.useRealTimers();
  });
});
