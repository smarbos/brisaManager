// A "sound alert window" is a time-of-day range (24h, Buenos Aires local time) during which a
// repeated-loud-noise alert is allowed to notify staff — smoke/CO alerts are unaffected, they're
// always-on regardless of time (see AmbientService.recordAlert). Stored on Settings as a single
// comma-separated string ("22:00-08:00,13:00-15:00") to match every other Settings field's plain
// scalar shape, rather than adding this schema's first Json column. The admin page's UI turns
// that into/from a proper add/remove row picker; this file only deals with the serialized form.

export interface TimeWindow {
  startMinutes: number;
  endMinutes: number;
}

const RANGE_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

export function parseSoundAlertWindows(raw: string): TimeWindow[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const match = RANGE_PATTERN.exec(piece);
      if (!match) {
        return null;
      }
      return {
        startMinutes: Number(match[1]) * 60 + Number(match[2]),
        endMinutes: Number(match[3]) * 60 + Number(match[4]),
      };
    })
    .filter((window): window is TimeWindow => window !== null);
}

// Buenos Aires local minute-of-day for `date` - independent of the server process's own TZ
// (nothing in this project sets one, so it's most likely UTC), since hardcoding a UTC-3 offset
// would silently break if that policy ever changed. `% 24` guards against a known ICU quirk
// where hour 0 can format as "24" in some Node versions even with a 23-hour cycle requested.
function minutesOfDayInBuenosAires(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function isMinuteInWindow(minute: number, window: TimeWindow): boolean {
  if (window.startMinutes === window.endMinutes) {
    return false; // zero-length window never matches
  }
  if (window.startMinutes < window.endMinutes) {
    return minute >= window.startMinutes && minute < window.endMinutes;
  }
  // Wraps past midnight (e.g. 22:00-08:00).
  return minute >= window.startMinutes || minute < window.endMinutes;
}

// No windows configured means no sound alert ever notifies staff - quiet hours must be
// explicitly opted into via the Settings page, never assumed.
export function isWithinSoundAlertWindow(windows: TimeWindow[], date: Date): boolean {
  if (windows.length === 0) {
    return false;
  }
  const minute = minutesOfDayInBuenosAires(date);
  return windows.some((window) => isMinuteInWindow(minute, window));
}
