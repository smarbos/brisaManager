import { isWithinSoundAlertWindow, parseSoundAlertWindows, TimeWindow } from './sound-alert-windows';

// Buenos Aires is UTC-3 year-round (no DST) - each helper below builds a UTC Date for a given
// Buenos Aires local time on 2026-01-15, so tests read in the time zone that actually matters.
function baTime(hour: number, minute: number): Date {
  const utcHour = (hour + 3) % 24;
  const dayOffset = hour + 3 >= 24 ? 1 : 0;
  return new Date(Date.UTC(2026, 0, 15 + dayOffset, utcHour, minute));
}

describe('parseSoundAlertWindows', () => {
  it('returns an empty list for an empty string', () => {
    expect(parseSoundAlertWindows('')).toEqual([]);
    expect(parseSoundAlertWindows('   ')).toEqual([]);
  });

  it('parses a single range', () => {
    expect(parseSoundAlertWindows('22:00-08:00')).toEqual([{ startMinutes: 1320, endMinutes: 480 }]);
  });

  it('parses multiple comma-separated ranges', () => {
    expect(parseSoundAlertWindows('22:00-08:00,13:00-15:00')).toEqual([
      { startMinutes: 1320, endMinutes: 480 },
      { startMinutes: 780, endMinutes: 900 },
    ]);
  });

  it('trims whitespace around ranges', () => {
    expect(parseSoundAlertWindows(' 22:00-08:00 , 13:00-15:00 ')).toEqual([
      { startMinutes: 1320, endMinutes: 480 },
      { startMinutes: 780, endMinutes: 900 },
    ]);
  });

  it('silently skips a malformed entry rather than throwing', () => {
    expect(parseSoundAlertWindows('not-a-range')).toEqual([]);
    expect(parseSoundAlertWindows('25:00-08:00')).toEqual([]);
    expect(parseSoundAlertWindows('22:00-08:00,garbage')).toEqual([{ startMinutes: 1320, endMinutes: 480 }]);
  });
});

describe('isWithinSoundAlertWindow', () => {
  it('is never within a window when none are configured', () => {
    expect(isWithinSoundAlertWindow([], baTime(23, 0))).toBe(false);
  });

  const daytimeWindow: TimeWindow[] = [{ startMinutes: 13 * 60, endMinutes: 15 * 60 }]; // 13:00-15:00
  const overnightWindow: TimeWindow[] = [{ startMinutes: 22 * 60, endMinutes: 8 * 60 }]; // 22:00-08:00

  it('matches inside a same-day window', () => {
    expect(isWithinSoundAlertWindow(daytimeWindow, baTime(14, 0))).toBe(true);
  });

  it('does not match before a same-day window starts', () => {
    expect(isWithinSoundAlertWindow(daytimeWindow, baTime(12, 59))).toBe(false);
  });

  it('matches exactly at a same-day window\'s start (inclusive)', () => {
    expect(isWithinSoundAlertWindow(daytimeWindow, baTime(13, 0))).toBe(true);
  });

  it('does not match exactly at a same-day window\'s end (exclusive)', () => {
    expect(isWithinSoundAlertWindow(daytimeWindow, baTime(15, 0))).toBe(false);
  });

  it('matches late at night inside an overnight window', () => {
    expect(isWithinSoundAlertWindow(overnightWindow, baTime(23, 0))).toBe(true);
  });

  it('matches early morning inside an overnight window', () => {
    expect(isWithinSoundAlertWindow(overnightWindow, baTime(3, 0))).toBe(true);
  });

  it('does not match at midday, outside an overnight window', () => {
    expect(isWithinSoundAlertWindow(overnightWindow, baTime(12, 0))).toBe(false);
  });

  it('does not match exactly at an overnight window\'s end (exclusive)', () => {
    expect(isWithinSoundAlertWindow(overnightWindow, baTime(8, 0))).toBe(false);
  });

  it('matches if inside any one of several configured windows', () => {
    const both = [...daytimeWindow, ...overnightWindow];
    expect(isWithinSoundAlertWindow(both, baTime(14, 0))).toBe(true);
    expect(isWithinSoundAlertWindow(both, baTime(23, 0))).toBe(true);
    expect(isWithinSoundAlertWindow(both, baTime(10, 0))).toBe(false);
  });

  it('treats a zero-length window (start equals end) as never matching', () => {
    const zeroLength: TimeWindow[] = [{ startMinutes: 600, endMinutes: 600 }];
    expect(isWithinSoundAlertWindow(zeroLength, baTime(10, 0))).toBe(false);
  });
});
