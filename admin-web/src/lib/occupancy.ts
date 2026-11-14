import { Reservation } from '../reservations/types';

// Occupancy works in whole days, as "YYYY-MM-DD" keys. check-in/check-out are calendar dates
// stored as midnight UTC (see lib/date.ts), so their key is just the UTC date. A stay occupies
// the nights from checkIn up to, but not including, checkOut — the checkOut day is the
// turnover day, when one guest leaves and the house can be cleaned for the next.
export type DayKey = string;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function dayKey(value: string | Date): DayKey {
  return (typeof value === 'string' ? new Date(value) : value).toISOString().slice(0, 10);
}

// "Today" is the viewer's own calendar day (the staff are on site), not the UTC one — at
// 22:00 in Argentina it's already tomorrow in UTC.
export function localTodayKey(now: Date = new Date()): DayKey {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function keyToTime(key: DayKey): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

export function addDays(key: DayKey, days: number): DayKey {
  return new Date(keyToTime(key) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((keyToTime(to) - keyToTime(from)) / MS_PER_DAY);
}

const LONG_DAY_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const SHORT_DAY_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  timeZone: 'UTC',
});

// "sábado, 11 de octubre"
export function formatLongDay(key: DayKey): string {
  return LONG_DAY_FORMATTER.format(new Date(keyToTime(key)));
}

// "sáb, 11/10"
export function formatShortDay(key: DayKey): string {
  return SHORT_DAY_FORMATTER.format(new Date(keyToTime(key)));
}

// "hoy", "mañana", "en 5 días", "ayer", "hace 3 días"
export function relativeDayLabel(today: DayKey, key: DayKey): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return diff > 0 ? `en ${diff} días` : `hace ${-diff} días`;
}

export function nightsLabel(nights: number): string {
  return `${nights} ${nights === 1 ? 'noche' : 'noches'}`;
}

// Everything that actually occupies the house — cancelled reservations never do.
export function occupyingReservations(reservations: Reservation[]): Reservation[] {
  return reservations
    .filter((r) => r.status !== 'CANCELLED')
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut));
}

export interface CleaningWindow {
  // The first day the house is empty and can be cleaned.
  from: DayKey;
  // The day the next guest arrives, or null when nobody is booked yet.
  until: DayKey | null;
  // Nights the house stays empty in between; 0 is a same-day turnover. null when open-ended.
  freeNights: number | null;
}

export interface OccupancySnapshot {
  today: DayKey;
  // Whoever sleeps in the house tonight (includes a guest arriving today).
  current: Reservation | null;
  departingToday: Reservation | null;
  arrivingToday: Reservation | null;
  // The next arrival after today.
  next: Reservation | null;
  // The next cleaning opportunity: after the current guest leaves (or now, if the house is
  // empty), until the following guest arrives.
  cleaning: CleaningWindow;
}

export function getOccupancySnapshot(reservations: Reservation[], today: DayKey): OccupancySnapshot {
  const stays = occupyingReservations(reservations);
  const current = stays.find((r) => dayKey(r.checkIn) <= today && today < dayKey(r.checkOut)) ?? null;
  const departingToday = stays.find((r) => dayKey(r.checkOut) === today) ?? null;
  const arrivingToday = stays.find((r) => dayKey(r.checkIn) === today) ?? null;
  const next = stays.find((r) => dayKey(r.checkIn) > today) ?? null;

  let from: DayKey;
  let until: DayKey | null;
  if (departingToday && arrivingToday) {
    from = today;
    until = today;
  } else if (current) {
    from = dayKey(current.checkOut);
    until = stays.map((r) => dayKey(r.checkIn)).find((checkIn) => checkIn >= from) ?? null;
  } else {
    from = today;
    until = next ? dayKey(next.checkIn) : null;
  }

  return {
    today,
    current,
    departingToday,
    arrivingToday,
    next,
    cleaning: { from, until, freeNights: until === null ? null : daysBetween(from, until) },
  };
}

export interface Movement {
  date: DayKey;
  kind: 'out' | 'in';
  reservation: Reservation;
}

// Every arrival and departure from `from` through `days` days later, in order — a departure
// sorts before an arrival on the same day, which is the order things happen in the house.
export function getMovements(reservations: Reservation[], from: DayKey, days: number): Movement[] {
  const to = addDays(from, days);
  const movements: Movement[] = [];
  for (const reservation of occupyingReservations(reservations)) {
    const checkIn = dayKey(reservation.checkIn);
    const checkOut = dayKey(reservation.checkOut);
    if (checkOut >= from && checkOut <= to) movements.push({ date: checkOut, kind: 'out', reservation });
    if (checkIn >= from && checkIn <= to) movements.push({ date: checkIn, kind: 'in', reservation });
  }
  return movements.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'out' ? -1 : 1));
}

export interface LanedStay {
  reservation: Reservation;
  // 0 for the normal row; anything higher means it overlaps another stay (a double booking).
  lane: number;
}

// Places each stay on the first timeline row where it doesn't overlap the previous one. With a
// single property everything should fit on row 0 — extra rows only appear for double bookings.
export function assignLanes(reservations: Reservation[]): { stays: LanedStay[]; laneCount: number } {
  const laneEnds: DayKey[] = [];
  const stays = occupyingReservations(reservations).map((reservation) => {
    const checkIn = dayKey(reservation.checkIn);
    let lane = laneEnds.findIndex((end) => end <= checkIn);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = dayKey(reservation.checkOut);
    return { reservation, lane };
  });
  return { stays, laneCount: Math.max(1, laneEnds.length) };
}
