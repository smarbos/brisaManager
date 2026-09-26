// Calendar dates (check-in/check-out) are stored as midnight UTC with no meaningful time
// component. Formatting them in the viewer's local timezone would shift the displayed day
// backward for any timezone behind UTC (e.g. Argentina, UTC-3) — pin to UTC so the date shown
// always matches the date stored.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' });

// Real point-in-time timestamps (sync times, event history) are shown in the viewer's own
// local time, which is what "when did this happen" should mean to them.
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' });

export function formatDate(value: string | Date): string {
  return DATE_FORMATTER.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDateTime(value: string | Date): string {
  return DATE_TIME_FORMATTER.format(typeof value === 'string' ? new Date(value) : value);
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

// Largest-unit-first, so "hace 2 horas" is shown instead of "hace 120 minutos".
const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

// "Hace 5 minutos" style - for a live status display (e.g. a device's last heartbeat) where
// how recent something is matters more than the exact clock time.
export function formatRelativeTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();

  const { unit, ms } = RELATIVE_TIME_UNITS.find(({ ms }) => Math.abs(diffMs) >= ms) ?? RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1];
  return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / ms), unit);
}
