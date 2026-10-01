import { Reservation, ReservationSource, ReservationStatus, WhatsappMessageKind } from '../reservations/types';

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
  INITIAL_EMAIL_QUEUED: 'Email inicial programado',
  INITIAL_EMAIL_ABORTED: 'Email inicial abortado',
  FINAL_EMAIL_QUEUED: 'Email final programado',
  FINAL_EMAIL_ABORTED: 'Email final abortado',
  CANCELLATION_EMAIL_QUEUED: 'Email de cancelación programado',
  CANCELLATION_EMAIL_ABORTED: 'Email de cancelación abortado',
  INITIAL_WHATSAPP_SENT: 'WhatsApp con el link enviado',
  INITIAL_WHATSAPP_FAILED: 'Falló el WhatsApp con el link',
  WHATSAPP_UNDELIVERED: 'WhatsApp no entregado',
  FINAL_EMAIL_SENT: 'Email final enviado',
  FINAL_EMAIL_FAILED: 'Falló el email final',
  CANCELLATION_EMAIL_SENT: 'Email de cancelación enviado',
  CANCELLATION_EMAIL_FAILED: 'Falló el email de cancelación',
  FIELD_CHANGED: 'Dato modificado',
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

const EXTENSION_ERROR_OPERATION_LABELS: Record<string, string> = {
  check_status: 'Verificar estado',
  submit_reservation: 'Enviar reserva',
};

export function extensionErrorOperationLabel(operation: string): string {
  return EXTENSION_ERROR_OPERATION_LABELS[operation] ?? operation;
}

// The extension reports its own literal 'booking.com' | 'airbnb' source strings (see
// ImportReservationDto), distinct from the ReservationSource enum above.
const EXTENSION_ERROR_SOURCE_LABELS: Record<string, string> = {
  'booking.com': 'Booking.com',
  airbnb: 'Airbnb',
};

export function extensionErrorSourceLabel(source: string): string {
  return EXTENSION_ERROR_SOURCE_LABELS[source] ?? source;
}

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  SENT: 'Enviado',
  FAILED: 'Fallido',
  SCHEDULED: 'Programado',
  ABORTED: 'Abortado',
};

export function recipientStatusLabel(status: string): string {
  return RECIPIENT_STATUS_LABELS[status] ?? status;
}

const WHATSAPP_KIND_LABELS: Record<WhatsappMessageKind, string> = {
  CHECKIN_LINK: 'El link de check-in',
  RESERVATION_REMINDER: 'El recordatorio de reserva',
  DEPOSIT_REMINDER: 'El recordatorio de depósito',
};

const WHATSAPP_KIND_TITLES: Record<WhatsappMessageKind, string> = {
  CHECKIN_LINK: 'Link de check-in',
  RESERVATION_REMINDER: 'Recordatorio de reserva',
  DEPOSIT_REMINDER: 'Recordatorio de depósito',
};

export function whatsappKindTitle(kind: WhatsappMessageKind): string {
  return WHATSAPP_KIND_TITLES[kind];
}

const WHATSAPP_STATUS_LABELS: Record<string, string> = {
  accepted: 'En cola',
  scheduled: 'En cola',
  queued: 'En cola',
  sending: 'Enviándose',
  sent: 'Enviado, sin confirmación de entrega',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'No entregado',
  undelivered: 'No entregado',
  canceled: 'No entregado',
  rejected: 'Rechazado, no se envió',
};

export function whatsappStatusLabel(status: string): string {
  return WHATSAPP_STATUS_LABELS[status] ?? status;
}

// Campaign recipients go SCHEDULED → SENT/FAILED/ABORTED as their outbox email is sent.
export function recipientStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'SENT') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'SCHEDULED') return 'warning';
  return 'neutral';
}

// A cancelled reservation needs no further action, so it's never flagged here even if it's
// still missing data from whenever it was created.
export function getReservationWarnings(reservation: Reservation): string[] {
  if (reservation.status === 'CANCELLED') {
    return [];
  }

  const warnings: string[] = [];

  if (!reservation.guestEmail && !reservation.guestPhone) {
    warnings.push('Falta el email y el teléfono del huésped');
  }

  if (reservation.guestEmail && !reservation.confirmationEmailSentAt) {
    warnings.push('El email de confirmación no se envió');
  }

  for (const issue of reservation.whatsappIssues ?? []) {
    warnings.push(`${WHATSAPP_KIND_LABELS[issue.kind]} por WhatsApp no se entregó`);
  }

  if (Number(reservation.totalAmount) === 0) {
    warnings.push('Falta el monto de la reserva');
  }

  // Channel imports (Booking.com/Airbnb) record unverified scraped fields as raw DTO field
  // names inside notes — see channel-import.service.ts's buildNotes().
  if (reservation.notes?.includes('check_in') || reservation.notes?.includes('check_out')) {
    warnings.push('Las fechas no están verificadas');
  }

  return warnings;
}

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  CALENDAR_MISMATCH: 'Calendario sin coincidencia',
  PAYMENT_RECEIPT_UPLOADED: 'Comprobante subido',
  GUEST_MESSAGE: 'Mensaje del huésped',
  AMBIENT_ALERT: 'Alerta ambiental',
  DEVICE_OFFLINE: 'Dispositivo sin conexión',
};

export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

// Reported by an ambient-control device (see AmbientEventEntry) as a free string, so a new
// sensor type on the firmware side shows up as its raw value here until a label is added.
const AMBIENT_SENSOR_LABELS: Record<string, string> = {
  sound: 'Sonido',
  smoke: 'Humo',
  temperature: 'Temperatura',
  co: 'Monóxido de carbono',
  humidity: 'Humedad',
};

export function ambientSensorLabel(sensor: string): string {
  return AMBIENT_SENSOR_LABELS[sensor] ?? sensor;
}

const GUEST_EVENT_TYPE_LABELS: Record<string, string> = {
  NAME_CHANGED: 'Nombre modificado',
  PHONE_CHANGED: 'Teléfono modificado',
  EMAIL_CHANGED: 'Email modificado',
  UNSUBSCRIBED: 'Se dio de baja',
};

export function guestEventTypeLabel(type: string): string {
  return GUEST_EVENT_TYPE_LABELS[type] ?? type;
}

const OUTBOUND_EMAIL_KIND_LABELS: Record<string, string> = {
  INITIAL_CONFIRMATION: 'Confirmación inicial',
  FINAL_CONFIRMATION: 'Confirmación final',
  CANCELLATION: 'Cancelación',
  MARKETING: 'Campaña',
  ALERT: 'Alerta interna',
  INBOUND_FORWARD: 'Reenvío de email recibido',
};

export function outboundEmailKindLabel(kind: string): string {
  return OUTBOUND_EMAIL_KIND_LABELS[kind] ?? kind;
}

const OUTBOUND_EMAIL_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  SCHEDULED: { label: 'Programado', tone: 'warning' },
  SENDING: { label: 'Enviando', tone: 'warning' },
  SENT: { label: 'Enviado', tone: 'success' },
  FAILED: { label: 'Falló', tone: 'danger' },
  ABORTED: { label: 'Abortado', tone: 'neutral' },
};

export function outboundEmailStatusLabel(status: string): string {
  return OUTBOUND_EMAIL_STATUS[status]?.label ?? status;
}

export function outboundEmailStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  return OUTBOUND_EMAIL_STATUS[status]?.tone ?? 'neutral';
}
