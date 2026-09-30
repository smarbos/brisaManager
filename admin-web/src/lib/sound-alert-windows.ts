// Mirrors api/src/ambient/sound-alert-windows.ts's serialized format (comma-separated
// "HH:MM-HH:MM" ranges) — this file only turns that string into/from rows for the Settings
// page's add/remove picker; the actual time-window matching logic lives server-side.

export interface SoundAlertWindowRow {
  start: string;
  end: string;
}

export function parseSoundAlertWindows(raw: string): SoundAlertWindowRow[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const [start, end] = piece.split('-');
      return { start: start ?? '', end: end ?? '' };
    });
}

// Rows missing a start or end (e.g. a freshly-added row not filled in yet) are dropped rather
// than sent as a malformed range the API would reject.
export function serializeSoundAlertWindows(rows: SoundAlertWindowRow[]): string {
  return rows
    .filter((row) => row.start && row.end)
    .map((row) => `${row.start}-${row.end}`)
    .join(',');
}
