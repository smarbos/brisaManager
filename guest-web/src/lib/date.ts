// Calendar dates (check-in/check-out) are stored as midnight UTC with no meaningful time
// component. Formatting them in the viewer's local timezone would shift the displayed day
// backward for any timezone behind UTC (e.g. Argentina, UTC-3) — pin to UTC so the date shown
// always matches the date stored.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' });

// Real point-in-time timestamps (sync times, event history) are shown in the viewer's own
// local time, which is what "when did this happen" should mean to them.
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' });

// For a guest-facing "accepted on <date>" note — a real timestamp, so shown in the viewer's
// own local time, same reasoning as DATE_TIME_FORMATTER above.
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

export function formatDate(value: string | Date): string {
  return DATE_FORMATTER.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDateTime(value: string | Date): string {
  return DATE_TIME_FORMATTER.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatLongDate(value: string | Date): string {
  return LONG_DATE_FORMATTER.format(typeof value === 'string' ? new Date(value) : value);
}
