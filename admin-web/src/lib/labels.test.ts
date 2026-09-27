import { describe, expect, it } from 'vitest';
import { sourceLabel, statusLabel, statusBadgeTone, eventTypeLabel, recipientStatusLabel, ambientSensorLabel } from './labels';

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
