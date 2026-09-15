jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

import { Resend } from 'resend';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let sendMock: jest.Mock;
  let settingsService: { get: jest.Mock };
  const originalDebugMode = process.env.EMAIL_DEBUG_MODE;
  const originalDebugRecipient = process.env.EMAIL_DEBUG_RECIPIENT;

  const baseSettings = {
    initialEmailTemplate: 'Hola {{guestName}}, confirmá acá: {{confirmationUrl}}',
    finalEmailTemplate: 'Hola {{guestName}}, dirección: {{propertyAddress}} — mapa: {{googleMapsUrl}}',
    cancellationEmailTemplate: 'Hola {{guestName}}, se canceló tu reserva del {{checkIn}} al {{checkOut}}',
    propertyAddress: 'Calle Falsa 123, Mar del Plata',
    googleMapsUrl: 'https://maps.example/labrisa',
  };

  afterAll(() => {
    // Restores whatever the real .env had, so these mutations can't leak into another
    // spec file that happens to share this Jest worker and construct its own EmailService.
    process.env.EMAIL_DEBUG_MODE = originalDebugMode;
    process.env.EMAIL_DEBUG_RECIPIENT = originalDebugRecipient;
  });

  beforeEach(() => {
    process.env.EMAIL_FROM = 'reservas@labrisa.com.ar';
    process.env.ALERT_EMAIL = 'owner@labrisa.com.ar';
    // Pinned explicitly so these tests behave the same regardless of the real .env this
    // container loads (which has EMAIL_DEBUG_MODE=true for local guest-safe testing) —
    // the debug-redirect behavior itself is covered by its own tests below, which set
    // these deliberately instead of relying on ambient state.
    process.env.EMAIL_DEBUG_MODE = 'false';
    delete process.env.EMAIL_DEBUG_RECIPIENT;
    settingsService = { get: jest.fn().mockResolvedValue(baseSettings) };
    service = new EmailService(settingsService as never);
    sendMock = (Resend as unknown as jest.Mock).mock.results[
      (Resend as unknown as jest.Mock).mock.results.length - 1
    ].value.emails.send;
  });

  it('sends the initial confirmation email with the template rendered', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(
      service.sendInitialConfirmationEmail('guest@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc'),
    ).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        html: 'Hola Jane Doe, confirmá acá: https://reservas.labrisa.com.ar/r/abc',
      }),
    );
  });

  it('throws when Resend returns an error for the initial email', async () => {
    sendMock.mockResolvedValue({ error: { message: 'bounced' } });

    await expect(
      service.sendInitialConfirmationEmail('bad@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc'),
    ).rejects.toThrow('bounced');
  });

  it('sends the final confirmation email with the address and maps link rendered from settings', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(service.sendFinalConfirmationEmail('guest@example.com', 'Jane Doe')).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        html: 'Hola Jane Doe, dirección: Calle Falsa 123, Mar del Plata — mapa: https://maps.example/labrisa',
      }),
    );
  });

  it('sends a cancellation email with the dates formatted DD/MM/YYYY', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(
      service.sendCancellationEmail(
        'guest@example.com',
        'Jane Doe',
        new Date('2026-11-06T00:00:00.000Z'),
        new Date('2026-11-08T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        html: 'Hola Jane Doe, se canceló tu reserva del 06/11/2026 al 08/11/2026',
      }),
    );
  });

  it('throws when Resend returns an error for the cancellation email', async () => {
    sendMock.mockResolvedValue({ error: { message: 'bounced' } });

    await expect(
      service.sendCancellationEmail('bad@example.com', 'Jane Doe', new Date('2026-11-06'), new Date('2026-11-08')),
    ).rejects.toThrow('bounced');
  });

  it('sendAlert never throws even if Resend fails', async () => {
    sendMock.mockRejectedValue(new Error('network error'));

    await expect(service.sendAlert('Something failed', 'details here')).resolves.toBeUndefined();
  });

  it('sends a marketing email with the given subject and html', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(
      service.sendMarketingEmail('guest@example.com', 'Come back!', '<p>We miss you</p>'),
    ).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledWith({
      from: 'reservas@labrisa.com.ar',
      to: 'guest@example.com',
      subject: 'Come back!',
      html: '<p>We miss you</p>',
    });
  });

  it('throws when Resend returns an error for a marketing email', async () => {
    sendMock.mockResolvedValue({ error: { message: 'bounced' } });

    await expect(service.sendMarketingEmail('bad@example.com', 'Subject', '<p>Body</p>')).rejects.toThrow('bounced');
  });

  describe('debug mode', () => {
    // Fields are read once at construction, so each test builds its own instance after
    // setting the env vars it needs — the shared beforeEach above already pinned
    // EMAIL_DEBUG_MODE/EMAIL_DEBUG_RECIPIENT to a known-off state before this runs.
    function buildDebugService(recipient?: string) {
      process.env.EMAIL_DEBUG_MODE = 'true';
      if (recipient) {
        process.env.EMAIL_DEBUG_RECIPIENT = recipient;
      } else {
        delete process.env.EMAIL_DEBUG_RECIPIENT;
      }
      const debugService = new EmailService(settingsService as never);
      const debugSendMock = (Resend as unknown as jest.Mock).mock.results[
        (Resend as unknown as jest.Mock).mock.results.length - 1
      ].value.emails.send;
      return { debugService, debugSendMock };
    }

    it('redirects the confirmation email to the debug recipient and marks the real one in the subject', async () => {
      const { debugService, debugSendMock } = buildDebugService('debug@example.com');
      debugSendMock.mockResolvedValue({ error: null });

      await debugService.sendInitialConfirmationEmail('real-guest@example.com', 'Jane Doe', 'https://x/r/abc');

      expect(debugSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'debug@example.com',
          subject: expect.stringContaining('real-guest@example.com'),
        }),
      );
    });

    it('redirects sendAlert too, since it goes through the same recipient resolution', async () => {
      const { debugService, debugSendMock } = buildDebugService('debug@example.com');
      debugSendMock.mockResolvedValue({ error: null });

      await debugService.sendAlert('Something failed', 'details');

      expect(debugSendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'debug@example.com' }));
    });

    it('falls back to the real recipient when debug mode is on but no recipient is configured', async () => {
      const { debugService, debugSendMock } = buildDebugService();
      debugSendMock.mockResolvedValue({ error: null });

      await debugService.sendInitialConfirmationEmail('real-guest@example.com', 'Jane Doe', 'https://x/r/abc');

      expect(debugSendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'real-guest@example.com' }));
    });
  });
});
