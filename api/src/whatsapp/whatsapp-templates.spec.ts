import { checkinLinkMessage, depositReminderMessage, reservationReminderMessage } from './whatsapp-templates';

describe('whatsapp templates', () => {
  const reservation = {
    guestName: 'María',
    checkIn: new Date('2026-12-12T00:00:00Z'),
    checkOut: new Date('2026-12-15T00:00:00Z'),
    confirmationToken: 'tok-123',
  };
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_WEB_ORIGIN = 'https://reservas.example';
    process.env.TWILIO_TEMPLATE_CHECKIN_LINK = 'HXcheckin';
    process.env.TWILIO_TEMPLATE_RESERVATION_REMINDER = 'HXreminder';
    process.env.TWILIO_TEMPLATE_DEPOSIT_REMINDER = 'HXdeposit';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds the check-in link message with numbered variables and the token last', () => {
    expect(checkinLinkMessage(reservation)).toEqual({
      templateSid: 'HXcheckin',
      variables: { '1': 'María', '2': '12/12/2026', '3': '15/12/2026', '4': 'tok-123' },
      fallbackBody: expect.stringContaining('https://reservas.example/r/tok-123'),
    });
  });

  it('builds the reservation reminder with the same variable layout', () => {
    expect(reservationReminderMessage(reservation)).toEqual({
      templateSid: 'HXreminder',
      variables: { '1': 'María', '2': '12/12/2026', '3': '15/12/2026', '4': 'tok-123' },
      fallbackBody: expect.stringContaining('https://reservas.example/r/tok-123'),
    });
  });

  it('builds the deposit reminder with the token as variable 3', () => {
    expect(depositReminderMessage(reservation)).toEqual({
      templateSid: 'HXdeposit',
      variables: { '1': 'María', '2': '12/12/2026', '3': 'tok-123' },
      fallbackBody: expect.stringContaining('https://reservas.example/r/tok-123'),
    });
  });

  it('leaves templateSid undefined when its env var is unset or empty', () => {
    delete process.env.TWILIO_TEMPLATE_CHECKIN_LINK;
    process.env.TWILIO_TEMPLATE_DEPOSIT_REMINDER = '';

    expect(checkinLinkMessage(reservation).templateSid).toBeUndefined();
    expect(depositReminderMessage(reservation).templateSid).toBeUndefined();
  });

  it('includes the guest name and dates in the fallback text', () => {
    expect(checkinLinkMessage(reservation).fallbackBody).toBe(
      'Hola María, ¡gracias por reservar en La Brisa de Mar del Plata! Tu estadía del 12/12/2026 al 15/12/2026 ya está registrada. Para completar el check-in, entrá acá: https://reservas.example/r/tok-123',
    );
  });
});
