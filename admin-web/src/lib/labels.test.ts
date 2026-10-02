import { describe, expect, it } from 'vitest';
import {
  sourceLabel,
  statusLabel,
  statusBadgeTone,
  eventTypeLabel,
  recipientStatusLabel,
  ambientSensorLabel,
  guestEventTypeLabel,
  getReservationWarnings,
  whatsappStatusLabel,
} from './labels';
import { Reservation } from '../reservations/types';

describe('sourceLabel', () => {
  it('translates each reservation source to Spanish', () => {
    expect(sourceLabel('BOOKING')).toBe('Booking.com');
    expect(sourceLabel('AIRBNB')).toBe('Airbnb');
    expect(sourceLabel('DIRECT')).toBe('Directo');
    expect(sourceLabel('OTHER')).toBe('Otro');
  });
});

describe('statusLabel', () => {
  it('translates each reservation status to Spanish', () => {
    expect(statusLabel('PENDING')).toBe('Pendiente');
    expect(statusLabel('CONFIRMED')).toBe('Confirmada');
    expect(statusLabel('CANCELLED')).toBe('Cancelada');
    expect(statusLabel('COMPLETED')).toBe('Completada');
  });
});

describe('statusBadgeTone', () => {
  it('maps each reservation status to a badge tone', () => {
    expect(statusBadgeTone('PENDING')).toBe('warning');
    expect(statusBadgeTone('CONFIRMED')).toBe('success');
    expect(statusBadgeTone('CANCELLED')).toBe('danger');
    expect(statusBadgeTone('COMPLETED')).toBe('neutral');
  });
});

describe('eventTypeLabel', () => {
  it('translates a known event type to Spanish', () => {
    expect(eventTypeLabel('RESERVATION_CREATED')).toBe('Reserva creada');
    expect(eventTypeLabel('DATES_CONFIRMED')).toBe('Fechas confirmadas');
  });

  it('falls back to the raw type for an unrecognized value', () => {
    expect(eventTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('recipientStatusLabel', () => {
  it('translates each campaign recipient status to Spanish', () => {
    expect(recipientStatusLabel('SENT')).toBe('Enviado');
    expect(recipientStatusLabel('FAILED')).toBe('Fallido');
  });
});

describe('ambientSensorLabel', () => {
  it('translates each known ambient sensor type to Spanish', () => {
    expect(ambientSensorLabel('sound')).toBe('Sonido');
    expect(ambientSensorLabel('smoke')).toBe('Humo');
    expect(ambientSensorLabel('temperature')).toBe('Temperatura');
    expect(ambientSensorLabel('co')).toBe('Monóxido de carbono');
    expect(ambientSensorLabel('humidity')).toBe('Humedad');
  });

  it('falls back to the raw sensor string for an unknown type', () => {
    expect(ambientSensorLabel('vibration')).toBe('vibration');
  });
});

describe('guestEventTypeLabel', () => {
  it('returns the Spanish label for a known type', () => {
    expect(guestEventTypeLabel('NAME_CHANGED')).toBe('Nombre modificado');
    expect(guestEventTypeLabel('PHONE_CHANGED')).toBe('Teléfono modificado');
    expect(guestEventTypeLabel('EMAIL_CHANGED')).toBe('Email modificado');
    expect(guestEventTypeLabel('UNSUBSCRIBED')).toBe('Se dio de baja');
    expect(guestEventTypeLabel('CONTACT_INFO_NOT_APPLIED')).toBe('Dato de contacto no aplicado');
    expect(guestEventTypeLabel('DOCUMENT_CHANGED')).toBe('Documento modificado');
  });

  it('falls back to the raw type for an unknown value', () => {
    expect(guestEventTypeLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });
});

describe('getReservationWarnings — WhatsApp', () => {
  const base = {
    id: 'res-1',
    guestName: 'Jane',
    guestPhone: '+5491122334455',
    checkIn: '2099-01-10',
    checkOut: '2099-01-15',
    paxCount: 2,
    source: 'AIRBNB',
    totalAmount: 1000,
    currency: 'ARS',
    status: 'PENDING',
    confirmationToken: 'tok',
  } as Reservation;

  it('adds one line per undelivered WhatsApp message', () => {
    const warnings = getReservationWarnings({
      ...base,
      whatsappIssues: [
        { kind: 'CHECKIN_LINK', status: 'undelivered', errorCode: '63016' },
        { kind: 'DEPOSIT_REMINDER', status: 'rejected', errorCode: null },
      ],
    });

    expect(warnings).toContain('El link de check-in por WhatsApp no se entregó');
    expect(warnings).toContain('El recordatorio de depósito por WhatsApp no se entregó');
  });

  it('adds nothing without WhatsApp issues', () => {
    expect(getReservationWarnings({ ...base, whatsappIssues: [] })).toEqual([]);
  });

  it('never warns on a cancelled reservation', () => {
    expect(
      getReservationWarnings({
        ...base,
        status: 'CANCELLED',
        whatsappIssues: [{ kind: 'CHECKIN_LINK', status: 'undelivered', errorCode: null }],
      }),
    ).toEqual([]);
  });
});

describe('whatsappStatusLabel', () => {
  it('maps Twilio statuses and our own rejection to Spanish', () => {
    expect(whatsappStatusLabel('delivered')).toBe('Entregado');
    expect(whatsappStatusLabel('undelivered')).toBe('No entregado');
    expect(whatsappStatusLabel('rejected')).toBe('Rechazado, no se envió');
  });

  it('falls back to the raw status for an unknown value', () => {
    expect(whatsappStatusLabel('something-new')).toBe('something-new');
  });
});

describe('eventTypeLabel — WhatsApp delivery', () => {
  it('labels the undelivered event', () => {
    expect(eventTypeLabel('WHATSAPP_UNDELIVERED')).toBe('WhatsApp no entregado');
  });
});
