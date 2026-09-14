import { describe, expect, it } from 'vitest';
import { sourceLabel, statusLabel, eventTypeLabel, recipientStatusLabel } from './labels';

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
