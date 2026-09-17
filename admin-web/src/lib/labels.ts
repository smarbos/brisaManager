import { ReservationSource, ReservationStatus } from '../reservations/types';

const SOURCE_LABELS: Record<ReservationSource, string> = {
  BOOKING: 'Booking.com',
  AIRBNB: 'Airbnb',
  DIRECT: 'Directo',
  OTHER: 'Otro',
};

const STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
};

export function sourceLabel(source: ReservationSource): string {
  return SOURCE_LABELS[source];
}

export function statusLabel(status: ReservationStatus): string {
  return STATUS_LABELS[status];
}

const STATUS_BADGE_TONES: Record<ReservationStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
  COMPLETED: 'neutral',
};

export function statusBadgeTone(status: ReservationStatus): 'warning' | 'success' | 'danger' | 'neutral' {
  return STATUS_BADGE_TONES[status];
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  RESERVATION_CREATED: 'Reserva creada',
  DATES_CONFIRMED: 'Fechas confirmadas',
  CONTRACT_ACCEPTED: 'Contrato aceptado',
  PAYMENT_RECEIVED: 'Pago recibido',
  DEPOSIT_RECEIVED: 'Depósito recibido',
  DEPOSIT_RETURNED: 'Depósito devuelto',
  RESERVATION_CONFIRMED: 'Reserva confirmada',
  RESERVATION_CANCELLED: 'Reserva cancelada',
  INITIAL_EMAIL_SENT: 'Email inicial enviado',
  INITIAL_EMAIL_FAILED: 'Falló el email inicial',
  FINAL_EMAIL_SENT: 'Email final enviado',
  FINAL_EMAIL_FAILED: 'Falló el email final',
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  SENT: 'Enviado',
  FAILED: 'Fallido',
};

export function recipientStatusLabel(status: string): string {
  return RECIPIENT_STATUS_LABELS[status] ?? status;
}
