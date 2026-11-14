import { describe, expect, it } from 'vitest';
import { Reservation } from '../reservations/types';
import {
  addDays,
  assignLanes,
  daysBetween,
  getMovements,
  getOccupancySnapshot,
  localTodayKey,
  relativeDayLabel,
} from './occupancy';

function stay(id: string, checkIn: string, checkOut: string, overrides: Partial<Reservation> = {}): Reservation {
  return {
    id,
    guestName: `Guest ${id}`,
    checkIn: `${checkIn}T00:00:00.000Z`,
    checkOut: `${checkOut}T00:00:00.000Z`,
    paxCount: 2,
    source: 'DIRECT',
    totalAmount: 0,
    currency: 'ARS',
    status: 'CONFIRMED',
    confirmationToken: `tok-${id}`,
    ...overrides,
  };
}

describe('day arithmetic', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between two keys', () => {
    expect(daysBetween('2026-10-04', '2026-10-11')).toBe(7);
    expect(daysBetween('2026-10-11', '2026-10-04')).toBe(-7);
  });

  it('uses the local calendar day for today', () => {
    expect(localTodayKey(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
  });

  it('labels days relative to today', () => {
    expect(relativeDayLabel('2026-10-04', '2026-10-04')).toBe('hoy');
    expect(relativeDayLabel('2026-10-04', '2026-10-05')).toBe('mañana');
    expect(relativeDayLabel('2026-10-04', '2026-10-09')).toBe('en 5 días');
    expect(relativeDayLabel('2026-10-04', '2026-10-01')).toBe('hace 3 días');
  });
});

describe('getOccupancySnapshot', () => {
  it('finds the current guest, the next one and the cleaning window between them', () => {
    const snapshot = getOccupancySnapshot(
      [stay('a', '2026-10-01', '2026-10-06'), stay('b', '2026-10-09', '2026-10-12'), stay('c', '2026-10-20', '2026-10-22')],
      '2026-10-04',
    );
    expect(snapshot.current?.id).toBe('a');
    expect(snapshot.next?.id).toBe('b');
    expect(snapshot.cleaning).toEqual({ from: '2026-10-06', until: '2026-10-09', freeNights: 3 });
  });

  it('ignores cancelled reservations', () => {
    const snapshot = getOccupancySnapshot(
      [stay('a', '2026-10-01', '2026-10-06', { status: 'CANCELLED' }), stay('b', '2026-10-09', '2026-10-12')],
      '2026-10-04',
    );
    expect(snapshot.current).toBeNull();
    expect(snapshot.cleaning).toEqual({ from: '2026-10-04', until: '2026-10-09', freeNights: 5 });
  });

  it('flags a same-day turnover today', () => {
    const snapshot = getOccupancySnapshot(
      [stay('a', '2026-10-01', '2026-10-04'), stay('b', '2026-10-04', '2026-10-08'), stay('c', '2026-10-10', '2026-10-12')],
      '2026-10-04',
    );
    expect(snapshot.departingToday?.id).toBe('a');
    expect(snapshot.arrivingToday?.id).toBe('b');
    expect(snapshot.current?.id).toBe('b');
    expect(snapshot.next?.id).toBe('c');
    expect(snapshot.cleaning).toEqual({ from: '2026-10-04', until: '2026-10-04', freeNights: 0 });
  });

  it('leaves the cleaning window open-ended when nobody is booked next', () => {
    const snapshot = getOccupancySnapshot([stay('a', '2026-10-01', '2026-10-06')], '2026-10-04');
    expect(snapshot.next).toBeNull();
    expect(snapshot.cleaning).toEqual({ from: '2026-10-06', until: null, freeNights: null });
  });
});

describe('getMovements', () => {
  it('lists departures before arrivals on the same day, within the range', () => {
    const movements = getMovements(
      [stay('a', '2026-10-01', '2026-10-06'), stay('b', '2026-10-06', '2026-10-09'), stay('c', '2026-11-01', '2026-11-03')],
      '2026-10-04',
      14,
    );
    expect(movements.map((m) => `${m.date} ${m.kind} ${m.reservation.id}`)).toEqual([
      '2026-10-06 out a',
      '2026-10-06 in b',
      '2026-10-09 out b',
    ]);
  });
});

describe('assignLanes', () => {
  it('keeps back-to-back stays on one row and moves overlaps to another', () => {
    const { stays, laneCount } = assignLanes([
      stay('a', '2026-10-01', '2026-10-05'),
      stay('b', '2026-10-05', '2026-10-08'),
      stay('c', '2026-10-07', '2026-10-09'),
    ]);
    expect(stays.map((s) => [s.reservation.id, s.lane])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 1],
    ]);
    expect(laneCount).toBe(2);
  });
});
