// Shared by ReservationsService.update() (staff edits via the admin app) and
// ChannelImportService.updateFromRescan() (Booking.com/Airbnb re-scrapes) — both paths can
// change price, dates, and guest contact info, and both need the same FIELD_CHANGED
// history entries recorded the same way.

const FIELD_LABELS: Record<string, string> = {
  guestName: 'Nombre del huésped',
  guestPhone: 'Teléfono del huésped',
  guestEmail: 'Email del huésped',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  paxCount: 'Cantidad de pasajeros',
  source: 'Canal',
  externalReference: 'Referencia externa',
  totalAmount: 'Monto total',
  currency: 'Moneda',
  notes: 'Notas',
  status: 'Estado',
};

export function reservationFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export interface ReservationFieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

// The reservation as it was before the update — checkIn/checkOut are real Date objects
// (as Prisma returns them), totalAmount is whatever Prisma's Decimal or a plain number.
export interface ReservationSnapshot {
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  checkIn: Date;
  checkOut: Date;
  paxCount: number;
  source: string;
  externalReference: string | null;
  totalAmount: unknown;
  currency: string;
  notes: string | null;
  status: string;
}

// What's actually changing — undefined means "not part of this update, leave it out of the
// diff"; null means "explicitly cleared". checkIn/checkOut are ISO date strings (YYYY-MM-DD),
// matching what CreateReservationDto/UpdateReservationDto already carry.
export interface ReservationFieldInput {
  guestName?: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  checkIn?: string;
  checkOut?: string;
  paxCount?: number;
  source?: string;
  externalReference?: string | null;
  totalAmount?: number;
  currency?: string;
  notes?: string | null;
  status?: string;
}

export function diffReservationFields(
  existing: ReservationSnapshot,
  next: ReservationFieldInput,
): ReservationFieldChange[] {
  const changes: ReservationFieldChange[] = [];

  const addString = (field: string, oldValue: string | null, newValue: string | null | undefined) => {
    if (newValue === undefined) return;
    if ((oldValue ?? '') === (newValue ?? '')) return;
    changes.push({ field, oldValue: oldValue ?? '(vacío)', newValue: newValue ?? '(vacío)' });
  };

  addString('guestName', existing.guestName, next.guestName);
  addString('guestPhone', existing.guestPhone, next.guestPhone);
  addString('guestEmail', existing.guestEmail, next.guestEmail);
  addString('externalReference', existing.externalReference, next.externalReference);
  addString('currency', existing.currency, next.currency);
  addString('notes', existing.notes, next.notes);
  addString('source', existing.source, next.source);
  addString('status', existing.status, next.status);

  if (next.checkIn !== undefined) {
    const oldIso = existing.checkIn.toISOString().slice(0, 10);
    if (oldIso !== next.checkIn) {
      changes.push({ field: 'checkIn', oldValue: oldIso, newValue: next.checkIn });
    }
  }

  if (next.checkOut !== undefined) {
    const oldIso = existing.checkOut.toISOString().slice(0, 10);
    if (oldIso !== next.checkOut) {
      changes.push({ field: 'checkOut', oldValue: oldIso, newValue: next.checkOut });
    }
  }

  if (next.paxCount !== undefined && existing.paxCount !== next.paxCount) {
    changes.push({ field: 'paxCount', oldValue: String(existing.paxCount), newValue: String(next.paxCount) });
  }

  if (next.totalAmount !== undefined && Number(existing.totalAmount) !== next.totalAmount) {
    changes.push({ field: 'totalAmount', oldValue: String(existing.totalAmount), newValue: String(next.totalAmount) });
  }

  return changes;
}
