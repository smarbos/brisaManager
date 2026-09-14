import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './date';

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
