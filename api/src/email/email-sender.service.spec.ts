const sendMock = jest.fn();
const forwardMock = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock, receiving: { forward: forwardMock } },
  })),
}));

import { Test } from '@nestjs/testing';
import { EmailSenderService } from './email-sender.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';

describe('EmailSenderService', () => {
  let service: EmailSenderService;
  let prisma: {
    outboundEmail: { update: jest.Mock; create: jest.Mock };
    reservation: { update: jest.Mock };
    campaignRecipient: { update: jest.Mock };
  };
  let eventsService: { record: jest.Mock };
  const savedEnv = { ...process.env };

  const base = {
    id: 'e1',
    kind: 'INITIAL_CONFIRMATION',
    status: 'SENDING',
    to: 'guest@example.com',
    sentTo: null,
    subject: 'Confirmá tu reserva',
    html: '<p>Hola</p>',
    replyTo: 'reservas@inbound.labrisa.com.ar',
    inboundEmailId: null,
    reservationId: 'res-1',
    campaignRecipientId: null,
    attempts: 0,
    lastError: null,
  } as never;

  let current: unknown = base;
  const sendEntry = (entry: unknown) => {
    current = entry;
    return service.send(entry as never);
  };

  beforeEach(async () => {
    current = base;
    process.env.EMAIL_FROM = 'La Brisa <reservas@labrisa.com.ar>';
    process.env.ALERT_EMAIL = 'owner@labrisa.com.ar';
    process.env.DEBUG_MODE = 'false';
    delete process.env.EMAIL_DEBUG_RECIPIENT;
    sendMock.mockReset().mockResolvedValue({ data: { id: 'rs-1' }, error: null });
    forwardMock.mockReset().mockResolvedValue({ data: { id: 'rs-fwd' }, error: null });
    prisma = {
      outboundEmail: {
        // Like Prisma, returns the row being updated (the entry under test) with the changes.
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...(current as object), ...data })),
        create: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      },
      reservation: { update: jest.fn() },
      campaignRecipient: { update: jest.fn() },
    };
    eventsService = { record: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailSenderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
      ],
    }).compile();
    service = moduleRef.get(EmailSenderService);
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  describe('send', () => {
    it('sends through Resend and marks the entry SENT', async () => {
      const result = await sendEntry(base);

      expect(sendMock).toHaveBeenCalledWith({
        from: 'La Brisa <reservas@labrisa.com.ar>',
        to: 'guest@example.com',
        subject: 'Confirmá tu reserva',
        html: '<p>Hola</p>',
        replyTo: 'reservas@inbound.labrisa.com.ar',
      });
      expect(prisma.outboundEmail.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          status: 'SENT',
          sentAt: expect.any(Date),
          sentTo: 'guest@example.com',
          resendId: 'rs-1',
          lastError: null,
          attempts: { increment: 1 },
        },
      });
      expect(result.status).toBe('SENT');
    });

    it('omits Reply-To when the entry has none', async () => {
      await sendEntry({ ...(base as object), replyTo: null } as never);

      expect(sendMock.mock.calls[0][0]).not.toHaveProperty('replyTo');
    });

    it('marks the entry FAILED with Resend’s error', async () => {
      sendMock.mockResolvedValue({ data: null, error: { message: 'Domain not verified' } });

      const result = await sendEntry(base);

      expect(prisma.outboundEmail.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'FAILED', sentTo: 'guest@example.com', lastError: 'Domain not verified', attempts: { increment: 1 } },
      });
      expect(result.status).toBe('FAILED');
    });

    it('marks the entry FAILED when the Resend call throws', async () => {
      sendMock.mockRejectedValue(new Error('network down'));

      const result = await sendEntry(base);

      expect(result.status).toBe('FAILED');
      expect(result.lastError).toBe('network down');
    });

    it('redirects to damian.mantuano@gmail.com in debug mode and marks the real recipient in the subject', async () => {
      process.env.DEBUG_MODE = 'true';

      await sendEntry(base);

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'damian.mantuano@gmail.com',
          subject: '[DEBUG → guest@example.com] Confirmá tu reserva',
        }),
      );
      expect(prisma.outboundEmail.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sentTo: 'damian.mantuano@gmail.com' }) }),
      );
    });

    it('uses EMAIL_DEBUG_RECIPIENT when set', async () => {
      process.env.DEBUG_MODE = 'true';
      process.env.EMAIL_DEBUG_RECIPIENT = 'other@example.com';

      await sendEntry(base);

      expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'other@example.com' }));
    });

    it('forwards an inbound email through Resend’s receiving API, debug mode included', async () => {
      process.env.DEBUG_MODE = 'true';
      const forward = { ...(base as object), kind: 'INBOUND_FORWARD', to: 'staff@labrisa.com.ar', inboundEmailId: 'in-1', replyTo: null, reservationId: null } as never;

      await sendEntry(forward);

      expect(forwardMock).toHaveBeenCalledWith({
        emailId: 'in-1',
        to: 'damian.mantuano@gmail.com',
        from: 'La Brisa <reservas@labrisa.com.ar>',
        passthrough: true,
      });
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('effects', () => {
    it('stamps the reservation and records the event when a confirmation is sent', async () => {
      await sendEntry(base);

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { confirmationEmailSentAt: expect.any(Date) },
      });
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_EMAIL_SENT');
    });

    it('uses each reservation email’s own field and event', async () => {
      await sendEntry({ ...(base as object), kind: 'FINAL_CONFIRMATION' } as never);
      await sendEntry({ ...(base as object), kind: 'CANCELLATION' } as never);

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { finalConfirmationEmailSentAt: expect.any(Date) },
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { cancellationEmailSentAt: expect.any(Date) },
      });
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'FINAL_EMAIL_SENT');
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'CANCELLATION_EMAIL_SENT');
    });

    it('records the failure and queues a staff alert when a guest email fails', async () => {
      sendMock.mockResolvedValue({ data: null, error: { message: 'Domain not verified' } });

      await sendEntry(base);

      expect(prisma.reservation.update).not.toHaveBeenCalled();
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_EMAIL_FAILED', 'Domain not verified');
      expect(prisma.outboundEmail.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'ALERT',
          to: 'owner@labrisa.com.ar',
          subject: expect.stringContaining('[Alert]'),
          html: expect.stringContaining('Domain not verified'),
          sendAt: expect.any(Date),
        }),
      });
    });

    it('never queues an alert about a failed alert or a failed forward', async () => {
      sendMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
      forwardMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

      await sendEntry({ ...(base as object), kind: 'ALERT', reservationId: null } as never);
      await sendEntry({ ...(base as object), kind: 'INBOUND_FORWARD', inboundEmailId: 'in-1', reservationId: null } as never);

      expect(prisma.outboundEmail.create).not.toHaveBeenCalled();
    });

    it('records the abort on the reservation', async () => {
      await service.applyEffects({ ...(base as object), status: 'ABORTED' } as never, 'ABORTED');

      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_EMAIL_ABORTED');
    });

    it('updates the campaign recipient for a marketing email', async () => {
      const marketing = { ...(base as object), kind: 'MARKETING', reservationId: null, campaignRecipientId: 'cr-1' } as never;

      await service.applyEffects(marketing, 'SENT');
      await service.applyEffects({ ...(marketing as object), lastError: 'boom' } as never, 'FAILED');
      await service.applyEffects(marketing, 'ABORTED');

      expect(prisma.campaignRecipient.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'cr-1' },
        data: { status: 'SENT', error: null },
      });
      expect(prisma.campaignRecipient.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'cr-1' },
        data: { status: 'FAILED', error: 'boom' },
      });
      expect(prisma.campaignRecipient.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'cr-1' },
        data: { status: 'ABORTED', error: null },
      });
    });

    it('keeps the send result when an effect throws', async () => {
      prisma.reservation.update.mockRejectedValue(new Error('db down'));

      const result = await sendEntry(base);

      expect(result.status).toBe('SENT');
    });
  });
});
