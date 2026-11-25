import { WhatsappIncomingService } from './whatsapp-incoming.service';

describe('WhatsappIncomingService', () => {
  const originalEnv = process.env;
  let prisma: { reservation: { findMany: jest.Mock } };
  let emailService: { sendStaffNotice: jest.Mock };
  let service: WhatsappIncomingService;

  const jane = {
    id: 'res-1',
    guestName: 'Jane <b>Doe</b>',
    guestPhone: '+54 9 223 555-0101',
    checkIn: new Date('2026-12-10'),
    checkOut: new Date('2026-12-14'),
    status: 'CONFIRMED',
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMAIL_INBOUND_ADDRESS: 'contacto@example.com',
      ALERT_EMAIL: 'alerts@example.com',
      ADMIN_WEB_ORIGIN: 'https://admin.example.com',
    };
    prisma = { reservation: { findMany: jest.fn().mockResolvedValue([]) } };
    emailService = { sendStaffNotice: jest.fn().mockResolvedValue(undefined) };
    service = new WhatsappIncomingService(prisma as never, emailService as never);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('emails the reply to the contact address, matched to the guest reservation by phone', async () => {
    prisma.reservation.findMany.mockResolvedValue([
      { ...jane, id: 'other', guestPhone: '+54 9 11 5555-0000' },
      jane,
    ]);

    await service.forwardReply({ From: 'whatsapp:+5492235550101', Body: 'Hola, ¿a qué hora es el check-in?', ProfileName: 'Jane' });

    expect(emailService.sendStaffNotice).toHaveBeenCalledTimes(1);
    const [to, subject, html, reservationId] = emailService.sendStaffNotice.mock.calls[0];
    expect(to).toBe('contacto@example.com');
    expect(subject).toBe('WhatsApp de Jane <b>Doe</b> (+5492235550101)');
    expect(reservationId).toBe('res-1');
    expect(html).toContain('Hola, ¿a qué hora es el check-in?');
    expect(html).toContain('10/12/2026');
    expect(html).toContain('https://admin.example.com/reservations/res-1');
    // Guest-controlled text never becomes markup in the staff email.
    expect(html).toContain('Jane &lt;b&gt;Doe&lt;/b&gt;');
    expect(html).not.toContain('<b>Doe</b>');
  });

  it('prefers a current reservation over a cancelled one for the same phone', async () => {
    prisma.reservation.findMany.mockResolvedValue([
      { ...jane, id: 'cancelled', status: 'CANCELLED', checkIn: new Date('2027-01-10') },
      jane,
    ]);

    await service.forwardReply({ From: 'whatsapp:+5492235550101', Body: 'Hola' });

    expect(emailService.sendStaffNotice.mock.calls[0][3]).toBe('res-1');
  });

  it('still forwards a message from an unknown number, using the WhatsApp profile name', async () => {
    await service.forwardReply({ From: 'whatsapp:+5491100000000', Body: 'Hola <script>x</script>', ProfileName: 'Desconocido' });

    const [, subject, html, reservationId] = emailService.sendStaffNotice.mock.calls[0];
    expect(subject).toBe('WhatsApp de Desconocido (+5491100000000)');
    expect(reservationId).toBeNull();
    expect(html).toContain('No encontramos una reserva con este número');
    expect(html).toContain('&lt;script&gt;');
  });

  it('mentions attachments, which are only viewable in Twilio', async () => {
    await service.forwardReply({ From: 'whatsapp:+5491100000000', Body: '', NumMedia: '2' });

    expect(emailService.sendStaffNotice.mock.calls[0][2]).toContain('2 archivo(s) adjunto(s)');
  });

  it('falls back to the alert address when no contact address is set', async () => {
    delete process.env.EMAIL_INBOUND_ADDRESS;

    await service.forwardReply({ From: 'whatsapp:+5491100000000', Body: 'Hola' });

    expect(emailService.sendStaffNotice.mock.calls[0][0]).toBe('alerts@example.com');
  });

  it('ignores a request without a sender', async () => {
    await service.forwardReply({ Body: 'Hola' });

    expect(emailService.sendStaffNotice).not.toHaveBeenCalled();
  });
});
