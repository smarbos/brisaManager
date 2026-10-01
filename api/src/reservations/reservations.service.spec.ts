import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { GuestsService } from '../guests/guests.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let prisma: {
    reservation: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let eventsService: { record: jest.Mock };
  let emailService: { sendInitialConfirmationEmail: jest.Mock; sendCancellationEmail: jest.Mock; sendAlert: jest.Mock };
  let confirmationService: { maybeAutoConfirm: jest.Mock };
  let googleCalendarPushService: { pushReservation: jest.Mock };
  let guestsService: { syncFromReservation: jest.Mock };
  let whatsappService: { sendTemplate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      reservation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    eventsService = { record: jest.fn() };
    emailService = {
      sendInitialConfirmationEmail: jest.fn(),
      sendCancellationEmail: jest.fn(),
      sendAlert: jest.fn(),
    };
    confirmationService = { maybeAutoConfirm: jest.fn() };
    googleCalendarPushService = { pushReservation: jest.fn() };
    guestsService = { syncFromReservation: jest.fn() };
    whatsappService = { sendTemplate: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: EmailService, useValue: emailService },
        { provide: ReservationConfirmationService, useValue: confirmationService },
        { provide: GoogleCalendarPushService, useValue: googleCalendarPushService },
        { provide: GuestsService, useValue: guestsService },
        { provide: WhatsappService, useValue: whatsappService },
      ],
    }).compile();

    service = moduleRef.get(ReservationsService);
  });

  const validDto = {
    guestName: 'Jane Doe',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'DIRECT' as const,
    totalAmount: 100000,
    currency: 'ARS',
  };

  it('rejects a reservation where checkOut is not after checkIn', async () => {
    await expect(
      service.create({ ...validDto, checkIn: '2026-01-15', checkOut: '2026-01-10' }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('creates a reservation with valid dates', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto });

    const result = await service.create(validDto);

    expect(result).toEqual({ id: '1', ...validDto });
    expect(prisma.reservation.create).toHaveBeenCalled();
  });

  it('records a RESERVATION_CREATED event on create', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto });

    await service.create(validDto);

    expect(eventsService.record).toHaveBeenCalledWith('1', 'RESERVATION_CREATED', 'Creada manualmente por el personal');
  });

  it('normalizes an empty-string externalReference to null on create', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto, externalReference: null });

    await service.create({ ...validDto, externalReference: '' });

    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalReference: null }),
    });
  });

  it('normalizes a whitespace-only externalReference to null on create', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto, externalReference: null });

    await service.create({ ...validDto, externalReference: '   ' });

    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalReference: null }),
    });
  });

  it('trims and keeps a real externalReference on create', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto, externalReference: 'uid-1' });

    await service.create({ ...validDto, externalReference: '  uid-1  ' });

    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalReference: 'uid-1' }),
    });
  });

  it('throws NotFoundException when updating a reservation that does not exist', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.update('missing-id', { guestName: 'New Name' })).rejects.toThrow(NotFoundException);
  });

  it('pushes the reservation to Google Calendar after creating it', async () => {
    const created = { id: '1', ...validDto };
    prisma.reservation.create.mockResolvedValue(created);

    await service.create(validDto);

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(created);
  });

  it('pushes the reservation to Google Calendar after updating it', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
    const updated = { id: '1', ...validDto, guestName: 'Updated Name' };
    prisma.reservation.update.mockResolvedValue(updated);

    await service.update('1', { guestName: 'Updated Name' });

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(updated);
  });

  it('syncs the guest after creating a reservation with a guestEmail', async () => {
    const created = { id: '1', ...validDto, guestEmail: 'jane@example.com', guestPhone: '+54911' };
    prisma.reservation.create.mockResolvedValue(created);

    await service.create({ ...validDto, guestEmail: 'jane@example.com', guestPhone: '+54911' });

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('1', {
      email: 'jane@example.com',
      name: created.guestName,
      phone: '+54911',
      guestId: undefined,
    });
  });

  it('does not sync a guest when guestEmail is absent on create', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto, guestEmail: null });

    await service.create(validDto);

    expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
  });

  it('syncs the guest after updating a reservation with a guestEmail', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
    const updated = { id: '1', ...validDto, guestEmail: 'jane@example.com', guestName: 'Updated Name', guestPhone: null };
    prisma.reservation.update.mockResolvedValue(updated);

    await service.update('1', { guestName: 'Updated Name' });

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('1', {
      email: 'jane@example.com',
      name: 'Updated Name',
      phone: null,
      guestId: undefined,
    });
  });

  describe('field change tracking on update', () => {
    it('records a FIELD_CHANGED event with the field, old value, and new value', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto, guestName: 'Updated Name' });

      await service.update('1', { guestName: 'Updated Name' });

      expect(eventsService.record).toHaveBeenCalledWith(
        '1',
        'FIELD_CHANGED',
        'Nombre del huésped: "Jane Doe" → "Updated Name"',
        'guestName',
        'Jane Doe',
        'Updated Name',
        undefined,
      );
    });

    it('passes the given actor through to the recorded event', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto, guestName: 'Updated Name' });

      await service.update('1', { guestName: 'Updated Name' }, 'staff@labrisa.com.ar');

      expect(eventsService.record).toHaveBeenCalledWith(
        '1',
        'FIELD_CHANGED',
        'Nombre del huésped: "Jane Doe" → "Updated Name"',
        'guestName',
        'Jane Doe',
        'Updated Name',
        'staff@labrisa.com.ar',
      );
    });

    it('records one FIELD_CHANGED event per changed field', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto, totalAmount: 150000, paxCount: 4 });

      await service.update('1', { totalAmount: 150000, paxCount: 4 });

      expect(eventsService.record).toHaveBeenCalledWith('1', 'FIELD_CHANGED', expect.stringContaining('Cantidad de pasajeros'), 'paxCount', '2', '4', undefined);
      expect(eventsService.record).toHaveBeenCalledWith('1', 'FIELD_CHANGED', expect.stringContaining('Monto total'), 'totalAmount', '100000', '150000', undefined);
    });

    it('records a changed check-in date against its stored ISO date', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: '1',
        ...validDto,
        checkIn: new Date('2026-01-10T00:00:00.000Z'),
        checkOut: new Date('2026-01-15T00:00:00.000Z'),
      });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto, checkIn: '2026-01-12' });

      await service.update('1', { checkIn: '2026-01-12' });

      expect(eventsService.record).toHaveBeenCalledWith(
        '1',
        'FIELD_CHANGED',
        'Check-in: "2026-01-10" → "2026-01-12"',
        'checkIn',
        '2026-01-10',
        '2026-01-12',
        undefined,
      );
    });

    it('does not record a FIELD_CHANGED event when nothing actually changed', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto });

      await service.update('1', { guestName: validDto.guestName });

      expect(eventsService.record).not.toHaveBeenCalled();
    });

    it('does not record a FIELD_CHANGED event for a field the update omits entirely', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto, notes: 'unrelated update' });

      await service.update('1', { notes: undefined });

      expect(eventsService.record).not.toHaveBeenCalled();
    });
  });

  describe('externalReference normalization on update', () => {
    beforeEach(() => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
      prisma.reservation.update.mockResolvedValue({ id: '1', ...validDto, externalReference: null });
    });

    it('normalizes an empty-string externalReference to null on update', async () => {
      await service.update('1', { externalReference: '' });

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({ externalReference: null }),
      });
    });

    it('normalizes a whitespace-only externalReference to null on update', async () => {
      await service.update('1', { externalReference: '   ' });

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({ externalReference: null }),
      });
    });

    it('leaves externalReference untouched (undefined) on update when omitted from the dto', async () => {
      await service.update('1', { guestName: 'New Name' });

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({ externalReference: undefined }),
      });
    });

    it('trims and keeps a real externalReference on update', async () => {
      await service.update('1', { externalReference: '  uid-2  ' });

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({ externalReference: 'uid-2' }),
      });
    });
  });

  describe('onboarding actions', () => {
    it('sends the initial email when a reservation is created with a guestEmail', async () => {
      prisma.reservation.create.mockResolvedValue({
        id: '1',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        confirmationToken: 'tok-1',
        ...validDto,
      });
      emailService.sendInitialConfirmationEmail.mockResolvedValue(undefined);

      await service.create({ ...validDto, guestEmail: 'jane@example.com' });

      expect(emailService.sendInitialConfirmationEmail).toHaveBeenCalledWith(
        'jane@example.com',
        'Jane Doe',
        expect.stringContaining('tok-1'),
        '1',
      );
      // Queued, not sent: "sent" (confirmationEmailSentAt, INITIAL_EMAIL_SENT) is recorded by
      // EmailSenderService once the 5-minute wait is over and it actually goes out.
      expect(eventsService.record).toHaveBeenCalledWith('1', 'INITIAL_EMAIL_QUEUED');
      expect(prisma.reservation.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmationEmailSentAt: expect.anything() }) }),
      );
    });

    it('does not attempt to send an email when guestEmail is absent', async () => {
      prisma.reservation.create.mockResolvedValue({ id: '1', guestName: 'Jane Doe', guestEmail: null, ...validDto });

      await service.create(validDto);

      expect(emailService.sendInitialConfirmationEmail).not.toHaveBeenCalled();
    });

    it('marks the 30% payment as received and checks auto-confirmation', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', confirmationPaymentReceivedAt: null });
      prisma.reservation.update.mockResolvedValue({ id: '1', confirmationPaymentReceivedAt: new Date() });

      await service.markPaymentReceived('1');

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { confirmationPaymentReceivedAt: expect.any(Date) },
      });
      expect(eventsService.record).toHaveBeenCalledWith('1', 'PAYMENT_RECEIVED');
      expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('1');
    });

    it('marking payment received is idempotent', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', confirmationPaymentReceivedAt: new Date() });

      await service.markPaymentReceived('1');

      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('marks the reservation as cancelled, records an event, and pushes the removal to the calendar', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', status: 'PENDING' });
      const cancelled = { id: '1', status: 'CANCELLED' };
      prisma.reservation.update.mockResolvedValue(cancelled);

      const result = await service.cancel('1');

      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'CANCELLED' },
      });
      expect(eventsService.record).toHaveBeenCalledWith('1', 'RESERVATION_CANCELLED');
      expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(cancelled);
      expect(result).toBe(cancelled);
    });

    it('is a no-op when the reservation is already cancelled', async () => {
      const existing = { id: '1', status: 'CANCELLED' };
      prisma.reservation.findUnique.mockResolvedValue(existing);

      const result = await service.cancel('1');

      expect(prisma.reservation.update).not.toHaveBeenCalled();
      expect(eventsService.record).not.toHaveBeenCalled();
      expect(googleCalendarPushService.pushReservation).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('sends a cancellation email when the reservation has a guest email', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', status: 'PENDING' });
      const checkIn = new Date('2026-11-06');
      const checkOut = new Date('2026-11-08');
      const cancelled = { id: '1', status: 'CANCELLED', guestName: 'Jane Doe', guestEmail: 'jane@example.com', checkIn, checkOut };
      prisma.reservation.update.mockResolvedValue(cancelled);
      emailService.sendCancellationEmail.mockResolvedValue(undefined);

      await service.cancel('1');
      // sendCancellationEmail is fire-and-forget from cancel()'s perspective, and itself
      // awaits before recording the event — flush the microtask queue so that inner
      // continuation has actually run before asserting on it.
      await Promise.resolve();
      await Promise.resolve();

      expect(emailService.sendCancellationEmail).toHaveBeenCalledWith('jane@example.com', 'Jane Doe', checkIn, checkOut, '1');
      expect(eventsService.record).toHaveBeenCalledWith('1', 'CANCELLATION_EMAIL_QUEUED');
    });

    it('does not attempt a cancellation email when the reservation has no guest email', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', status: 'PENDING' });
      const cancelled = { id: '1', status: 'CANCELLED', guestName: 'Jane Doe', guestEmail: null };
      prisma.reservation.update.mockResolvedValue(cancelled);

      await service.cancel('1');

      expect(emailService.sendCancellationEmail).not.toHaveBeenCalled();
    });

    it('records a failure event and sends an alert when the cancellation email fails', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', status: 'PENDING' });
      const cancelled = {
        id: '1',
        status: 'CANCELLED',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        checkIn: new Date('2026-11-06'),
        checkOut: new Date('2026-11-08'),
      };
      prisma.reservation.update.mockResolvedValue(cancelled);
      emailService.sendCancellationEmail.mockRejectedValue(new Error('bounced'));

      await service.cancel('1');
      // The failure handling is inside a fire-and-forget call — flush the microtask queue.
      await Promise.resolve();
      await Promise.resolve();

      expect(eventsService.record).toHaveBeenCalledWith('1', 'CANCELLATION_EMAIL_FAILED', 'bounced');
      expect(emailService.sendAlert).toHaveBeenCalledWith(
        'Falló el email de cancelación',
        expect.stringContaining('bounced'),
      );
    });
  });

  describe('resendInitialEmail', () => {
    it('resends the email and reports success', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: '1',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        confirmationToken: 'tok-1',
      });
      emailService.sendInitialConfirmationEmail.mockResolvedValue(undefined);

      const result = await service.resendInitialEmail('1');

      expect(emailService.sendInitialConfirmationEmail).toHaveBeenCalledWith(
        'jane@example.com',
        'Jane Doe',
        expect.stringContaining('tok-1'),
        '1',
      );
      // Queued, not sent: "sent" (confirmationEmailSentAt, INITIAL_EMAIL_SENT) is recorded by
      // EmailSenderService once the 5-minute wait is over and it actually goes out.
      expect(eventsService.record).toHaveBeenCalledWith('1', 'INITIAL_EMAIL_QUEUED');
      expect(prisma.reservation.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmationEmailSentAt: expect.anything() }) }),
      );
      expect(result.sent).toBe(true);
    });

    it('reports failure without throwing when the email provider rejects the send', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: '1',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        confirmationToken: 'tok-1',
      });
      emailService.sendInitialConfirmationEmail.mockRejectedValue(new Error('domain not verified'));

      const result = await service.resendInitialEmail('1');

      expect(eventsService.record).toHaveBeenCalledWith('1', 'INITIAL_EMAIL_FAILED', 'domain not verified');
      expect(result.sent).toBe(false);
    });

    it('refuses to resend when the reservation has no guest email', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', guestName: 'Jane Doe', guestEmail: null });

      await expect(service.resendInitialEmail('1')).rejects.toBeInstanceOf(BadRequestException);
      expect(emailService.sendInitialConfirmationEmail).not.toHaveBeenCalled();
    });
  });

  describe('resendCancellationEmail', () => {
    const checkIn = new Date('2026-11-06');
    const checkOut = new Date('2026-11-08');

    it('resends the email and reports success', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: '1',
        status: 'CANCELLED',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        checkIn,
        checkOut,
      });
      emailService.sendCancellationEmail.mockResolvedValue(undefined);

      const result = await service.resendCancellationEmail('1');

      expect(emailService.sendCancellationEmail).toHaveBeenCalledWith('jane@example.com', 'Jane Doe', checkIn, checkOut, '1');
      expect(eventsService.record).toHaveBeenCalledWith('1', 'CANCELLATION_EMAIL_QUEUED');
      expect(result.sent).toBe(true);
    });

    it('reports failure without throwing when the email provider rejects the send', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: '1',
        status: 'CANCELLED',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        checkIn,
        checkOut,
      });
      emailService.sendCancellationEmail.mockRejectedValue(new Error('bounced'));

      const result = await service.resendCancellationEmail('1');

      expect(eventsService.record).toHaveBeenCalledWith('1', 'CANCELLATION_EMAIL_FAILED', 'bounced');
      expect(result.sent).toBe(false);
    });

    it('refuses to resend when the reservation has no guest email', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', status: 'CANCELLED', guestEmail: null });

      await expect(service.resendCancellationEmail('1')).rejects.toBeInstanceOf(BadRequestException);
      expect(emailService.sendCancellationEmail).not.toHaveBeenCalled();
    });

    it('refuses to resend when the reservation is not cancelled', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: '1',
        status: 'PENDING',
        guestEmail: 'jane@example.com',
      });

      await expect(service.resendCancellationEmail('1')).rejects.toBeInstanceOf(BadRequestException);
      expect(emailService.sendCancellationEmail).not.toHaveBeenCalled();
    });
  });

  describe('checkOverlap', () => {
    it('queries for non-cancelled reservations overlapping the given range', async () => {
      prisma.reservation.findMany.mockResolvedValue([{ id: 'res-1' }]);

      const result = await service.checkOverlap('2026-05-02', '2026-05-04');

      expect(prisma.reservation.findMany).toHaveBeenCalledWith({
        where: {
          id: undefined,
          status: { not: 'CANCELLED' },
          checkIn: { lt: new Date('2026-05-04') },
          checkOut: { gt: new Date('2026-05-02') },
        },
      });
      expect(result).toEqual([{ id: 'res-1' }]);
    });

    it('excludes the given id when editing an existing reservation', async () => {
      prisma.reservation.findMany.mockResolvedValue([]);

      await service.checkOverlap('2026-05-02', '2026-05-04', 'res-1');

      expect(prisma.reservation.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: { not: 'res-1' } }),
      });
    });
  });
  describe('sendInitialWhatsapp', () => {
    const reservation = {
      id: 'res-1',
      guestName: 'Jane Doe',
      guestPhone: '+5491122334455',
      checkIn: new Date('2026-12-12T00:00:00Z'),
      checkOut: new Date('2026-12-15T00:00:00Z'),
      confirmationToken: 'tok-1',
    } as never;

    it('sends the check-in link template, stamps confirmationWhatsappSentAt and records the event', async () => {
      const result = await service.sendInitialWhatsapp(reservation);

      expect(result).toBe(true);
      expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
        '+5491122334455',
        expect.objectContaining({
          variables: { '1': 'Jane Doe', '2': '12/12/2026', '3': '15/12/2026', '4': 'tok-1' },
        }),
      );
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { confirmationWhatsappSentAt: expect.any(Date) },
      });
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_WHATSAPP_SENT');
    });

    it('records a failure without stamping when Twilio does not accept the message', async () => {
      whatsappService.sendTemplate.mockResolvedValue(false);

      const result = await service.sendInitialWhatsapp(reservation);

      expect(result).toBe(false);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
      expect(eventsService.record).toHaveBeenCalledWith('res-1', 'INITIAL_WHATSAPP_FAILED', expect.any(String));
    });

    it('records an invalid phone as the failure reason and never calls Twilio', async () => {
      const result = await service.sendInitialWhatsapp({ ...(reservation as object), guestPhone: '12345' } as never);

      expect(result).toBe(false);
      expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
      expect(eventsService.record).toHaveBeenCalledWith(
        'res-1',
        'INITIAL_WHATSAPP_FAILED',
        expect.stringContaining('12345'),
      );
    });

    it('resolves to false instead of rejecting when recording the event fails', async () => {
      eventsService.record.mockRejectedValue(new Error('db down'));

      await expect(service.sendInitialWhatsapp(reservation)).resolves.toBe(false);
    });
  });

  describe('WhatsApp on create', () => {
    it('sends the check-in link when the new reservation has a phone', async () => {
      const created = {
        id: '1',
        ...validDto,
        guestPhone: '+5491122334455',
        confirmationToken: 'tok-1',
        checkIn: new Date('2026-01-10'),
        checkOut: new Date('2026-01-15'),
      };
      prisma.reservation.create.mockResolvedValue(created);

      await service.create({ ...validDto, guestPhone: '+5491122334455' });

      expect(whatsappService.sendTemplate).toHaveBeenCalledWith('+5491122334455', expect.anything());
    });

    it('does not send when the new reservation has no phone', async () => {
      prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto });

      await service.create(validDto);

      expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
    });
  });

  describe('sendInitialWhatsappById', () => {
    it('rejects a reservation with no phone', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: '1', guestPhone: null });

      await expect(service.sendInitialWhatsappById('1')).rejects.toBeInstanceOf(BadRequestException);
      expect(whatsappService.sendTemplate).not.toHaveBeenCalled();
    });

    it('sends even if one was already sent, and returns the refreshed reservation', async () => {
      const existing = {
        id: '1',
        guestName: 'Jane Doe',
        guestPhone: '+5491122334455',
        checkIn: new Date('2026-12-12T00:00:00Z'),
        checkOut: new Date('2026-12-15T00:00:00Z'),
        confirmationToken: 'tok-1',
        confirmationWhatsappSentAt: new Date('2026-09-01'),
      };
      prisma.reservation.findUnique.mockResolvedValue(existing);

      const result = await service.sendInitialWhatsappById('1');

      expect(whatsappService.sendTemplate).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ sent: true, reservation: existing });
    });
  });
});
