import { EmailService } from './email.service';

// EmailService renders each email and queues it in the outbox (EmailOutboxService). Sending,
// debug-mode redirection and failure handling happen later, in EmailSenderService — see its spec.
describe('EmailService', () => {
  let service: EmailService;
  let settingsService: { get: jest.Mock };
  let outbox: { enqueue: jest.Mock };
  const savedEnv = { ...process.env };

  const baseSettings = {
    initialEmailTemplate: 'Hola {{guestName}}, confirmá acá: {{confirmationUrl}}',
    finalEmailTemplate:
      'Hola {{guestName}}, dirección: {{propertyAddress}} — mapa: {{googleMapsUrl}} — más info: {{confirmationUrl}}',
    cancellationEmailTemplate: 'Hola {{guestName}}, se canceló tu reserva del {{checkIn}} al {{checkOut}}',
    propertyAddress: 'Calle Falsa 123, Mar del Plata',
    googleMapsUrl: 'https://maps.example/labrisa',
  };

  afterAll(() => {
    process.env = savedEnv;
  });

  beforeEach(() => {
    process.env.ALERT_EMAIL = 'owner@labrisa.com.ar';
    process.env.EMAIL_INBOUND_ADDRESS = 'reservas@inbound.labrisa.com.ar';
    settingsService = { get: jest.fn().mockResolvedValue(baseSettings) };
    outbox = { enqueue: jest.fn().mockImplementation((input) => Promise.resolve({ id: 'e1', ...input })) };
    service = new EmailService(settingsService as never, outbox as never);
  });

  it('queues the initial confirmation email, rendered, linked to the reservation, with Reply-To', async () => {
    const entry = await service.sendInitialConfirmationEmail(
      'guest@example.com',
      'Jane Doe',
      'https://reservas.labrisa.com.ar/r/abc',
      'res-1',
    );

    expect(outbox.enqueue).toHaveBeenCalledWith({
      kind: 'INITIAL_CONFIRMATION',
      to: 'guest@example.com',
      subject: 'Confirmá tu reserva en La Brisa de Mar del Plata',
      html: 'Hola Jane Doe, confirmá acá: https://reservas.labrisa.com.ar/r/abc',
      replyTo: 'reservas@inbound.labrisa.com.ar',
      reservationId: 'res-1',
    });
    expect(entry.id).toBe('e1');
  });

  it('leaves Reply-To empty when no inbound address is configured', async () => {
    delete process.env.EMAIL_INBOUND_ADDRESS;

    await service.sendInitialConfirmationEmail('guest@example.com', 'Jane Doe', 'https://x/r/abc', 'res-1');

    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ replyTo: null }));
  });

  it('queues the final confirmation email with the address, maps link, and check-in link', async () => {
    await service.sendFinalConfirmationEmail('guest@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc', 'res-1');

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'FINAL_CONFIRMATION',
        subject: '¡Tu reserva está confirmada!',
        html: 'Hola Jane Doe, dirección: Calle Falsa 123, Mar del Plata — mapa: https://maps.example/labrisa — más info: https://reservas.labrisa.com.ar/r/abc',
        reservationId: 'res-1',
      }),
    );
  });

  it('queues the cancellation email with the dates formatted DD/MM/YYYY', async () => {
    await service.sendCancellationEmail(
      'guest@example.com',
      'Jane Doe',
      new Date('2026-11-06T00:00:00.000Z'),
      new Date('2026-11-08T00:00:00.000Z'),
      'res-1',
    );

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CANCELLATION',
        subject: 'Tu reserva fue cancelada',
        html: 'Hola Jane Doe, se canceló tu reserva del 06/11/2026 al 08/11/2026',
        reservationId: 'res-1',
      }),
    );
  });

  it('queues a marketing email linked to its campaign recipient', async () => {
    await service.sendMarketingEmail('guest@example.com', 'Come back!', '<p>We miss you</p>', 'cr-1');

    expect(outbox.enqueue).toHaveBeenCalledWith({
      kind: 'MARKETING',
      to: 'guest@example.com',
      subject: 'Come back!',
      html: '<p>We miss you</p>',
      replyTo: 'reservas@inbound.labrisa.com.ar',
      campaignRecipientId: 'cr-1',
    });
  });

  it('queues a staff alert to ALERT_EMAIL with the message HTML-escaped', async () => {
    await service.sendAlert('Falló algo', 'Reserva para <img src=x onerror=alert(1)>');

    expect(outbox.enqueue).toHaveBeenCalledWith({
      kind: 'ALERT',
      to: 'owner@labrisa.com.ar',
      subject: '[Alert] Falló algo',
      html: '<p>Reserva para &lt;img src=x onerror=alert(1)&gt;</p>',
    });
  });

  it('skips the alert when no alert address is configured', async () => {
    delete process.env.ALERT_EMAIL;
    delete process.env.ADMIN_SEED_EMAIL;

    await service.sendAlert('Falló algo', 'details');

    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('sendAlert never throws, even if queueing fails', async () => {
    outbox.enqueue.mockRejectedValue(new Error('db down'));

    await expect(service.sendAlert('Something failed', 'details here')).resolves.toBeUndefined();
  });

  it('HTML-escapes the guest name before inserting it into an email template', async () => {
    await service.sendInitialConfirmationEmail(
      'guest@example.com',
      '<a href="https://evil.example">Jane</a>',
      'https://reservas.labrisa.com.ar/r/abc',
      'res-1',
    );

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        html: 'Hola &lt;a href=&quot;https://evil.example&quot;&gt;Jane&lt;/a&gt;, confirmá acá: https://reservas.labrisa.com.ar/r/abc',
      }),
    );
  });
});
