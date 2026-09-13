import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';

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

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: EmailService, useValue: emailService },
        { provide: ReservationConfirmationService, useValue: confirmationService },
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

  it('throws NotFoundException when updating a reservation that does not exist', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.update('missing-id', { guestName: 'New Name' })).rejects.toThrow(NotFoundException);
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
});
