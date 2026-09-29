import { diffReservationFields, reservationFieldLabel, ReservationSnapshot } from './reservation-field-changes';

const baseSnapshot: ReservationSnapshot = {
  guestName: 'Jane Doe',
  guestPhone: '+5491100000000',
  guestEmail: 'jane@example.com',
  checkIn: new Date('2026-01-10T00:00:00.000Z'),
  checkOut: new Date('2026-01-15T00:00:00.000Z'),
  paxCount: 2,
  source: 'DIRECT',
  externalReference: null,
  totalAmount: 100000,
  currency: 'ARS',
  notes: null,
  status: 'PENDING',
};

describe('diffReservationFields', () => {
  it('returns no changes when nothing in the input differs', () => {
    expect(diffReservationFields(baseSnapshot, { guestName: 'Jane Doe' })).toEqual([]);
  });

  it('returns no changes for fields the update omits entirely', () => {
    expect(diffReservationFields(baseSnapshot, {})).toEqual([]);
  });

  it('detects a changed guest name', () => {
    expect(diffReservationFields(baseSnapshot, { guestName: 'Jane Smith' })).toEqual([
      { field: 'guestName', oldValue: 'Jane Doe', newValue: 'Jane Smith' },
    ]);
  });

  it('detects a changed total amount, comparing numerically', () => {
    expect(diffReservationFields(baseSnapshot, { totalAmount: 120000 })).toEqual([
      { field: 'totalAmount', oldValue: '100000', newValue: '120000' },
    ]);
  });

  it('does not flag totalAmount as changed when the numeric value is the same but formatted differently', () => {
    const decimalLikeSnapshot: ReservationSnapshot = { ...baseSnapshot, totalAmount: '100000.00' };
    expect(diffReservationFields(decimalLikeSnapshot, { totalAmount: 100000 })).toEqual([]);
  });

  it('detects a changed check-in date, comparing against the ISO date only', () => {
    expect(diffReservationFields(baseSnapshot, { checkIn: '2026-01-12' })).toEqual([
      { field: 'checkIn', oldValue: '2026-01-10', newValue: '2026-01-12' },
    ]);
  });

  it('detects a changed check-out date', () => {
    expect(diffReservationFields(baseSnapshot, { checkOut: '2026-01-20' })).toEqual([
      { field: 'checkOut', oldValue: '2026-01-15', newValue: '2026-01-20' },
    ]);
  });

  it('detects a changed pax count', () => {
    expect(diffReservationFields(baseSnapshot, { paxCount: 4 })).toEqual([
      { field: 'paxCount', oldValue: '2', newValue: '4' },
    ]);
  });

  it('detects a changed guest phone', () => {
    expect(diffReservationFields(baseSnapshot, { guestPhone: '+5492200000000' })).toEqual([
      { field: 'guestPhone', oldValue: '+5491100000000', newValue: '+5492200000000' },
    ]);
  });

  it('renders "(vacío)" for a previously-empty field that gets its first value', () => {
    const snapshotWithoutPhone: ReservationSnapshot = { ...baseSnapshot, guestPhone: null };
    expect(diffReservationFields(snapshotWithoutPhone, { guestPhone: '+5491100000000' })).toEqual([
      { field: 'guestPhone', oldValue: '(vacío)', newValue: '+5491100000000' },
    ]);
  });

  it('renders "(vacío)" for a field explicitly cleared to null', () => {
    expect(diffReservationFields(baseSnapshot, { notes: null })).toEqual([]);
    const snapshotWithNotes: ReservationSnapshot = { ...baseSnapshot, notes: 'Llega tarde' };
    expect(diffReservationFields(snapshotWithNotes, { notes: null })).toEqual([
      { field: 'notes', oldValue: 'Llega tarde', newValue: '(vacío)' },
    ]);
  });

  it('detects a changed status', () => {
    expect(diffReservationFields(baseSnapshot, { status: 'CONFIRMED' })).toEqual([
      { field: 'status', oldValue: 'PENDING', newValue: 'CONFIRMED' },
    ]);
  });

  it('detects a changed source', () => {
    expect(diffReservationFields(baseSnapshot, { source: 'AIRBNB' })).toEqual([
      { field: 'source', oldValue: 'DIRECT', newValue: 'AIRBNB' },
    ]);
  });

  it('detects a changed currency', () => {
    expect(diffReservationFields(baseSnapshot, { currency: 'USD' })).toEqual([
      { field: 'currency', oldValue: 'ARS', newValue: 'USD' },
    ]);
  });

  it('detects a changed external reference', () => {
    const snapshotWithRef: ReservationSnapshot = { ...baseSnapshot, externalReference: 'booking-1' };
    expect(diffReservationFields(snapshotWithRef, { externalReference: 'booking-2' })).toEqual([
      { field: 'externalReference', oldValue: 'booking-1', newValue: 'booking-2' },
    ]);
  });

  it('detects multiple simultaneous changes in one call', () => {
    expect(
      diffReservationFields(baseSnapshot, { guestName: 'Jane Smith', totalAmount: 150000, paxCount: 3 }),
    ).toEqual([
      { field: 'guestName', oldValue: 'Jane Doe', newValue: 'Jane Smith' },
      { field: 'paxCount', oldValue: '2', newValue: '3' },
      { field: 'totalAmount', oldValue: '100000', newValue: '150000' },
    ]);
  });
});

describe('reservationFieldLabel', () => {
  it('returns the Spanish label for a known field', () => {
    expect(reservationFieldLabel('totalAmount')).toBe('Monto total');
  });

  it('falls back to the raw field name for an unknown field', () => {
    expect(reservationFieldLabel('somethingNew')).toBe('somethingNew');
  });
});
