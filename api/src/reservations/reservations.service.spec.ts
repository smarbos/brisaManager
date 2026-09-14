import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { GuestsService } from '../guests/guests.service';

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
  let emailService: { sendInitialConfirmationEmail: jest.Mock; sendAlert: jest.Mock };
  let confirmationService: { maybeAutoConfirm: jest.Mock };
  let googleCalendarPushService: { pushReservation: jest.Mock };
  let guestsService: { syncFromReservation: jest.Mock };

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
    emailService = { sendInitialConfirmationEmail: jest.fn(), sendAlert: jest.fn() };
    confirmationService = { maybeAutoConfirm: jest.fn() };
    googleCalendarPushService = { pushReservation: jest.fn() };
    guestsService = { syncFromReservation: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: EmailService, useValue: emailService },
        { provide: ReservationConfirmationService, useValue: confirmationService },
        { provide: GoogleCalendarPushService, useValue: googleCalendarPushService },
        { provide: GuestsService, useValue: guestsService },
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
      );
      expect(eventsService.record).toHaveBeenCalledWith('1', 'INITIAL_EMAIL_SENT');
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
});
