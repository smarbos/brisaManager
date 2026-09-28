import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationConfirmationService } from './reservation-confirmation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';

describe('ReservationConfirmationService', () => {
  let service: ReservationConfirmationService;
  let prisma: {
    reservation: { findUniqueOrThrow: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let eventsService: { record: jest.Mock };
  let emailService: {
    sendFinalConfirmationEmail: jest.Mock;
    sendAlert: jest.Mock;
  };

  const baseReservation = {
    id: 'res-1',
    guestName: 'Jane Doe',
    guestEmail: 'jane@example.com',
    confirmationToken: 'tok-1',
    status: 'PENDING',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
    finalConfirmationEmailSentAt: null,
  };

  beforeEach(async () => {
    prisma = {
      reservation: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    eventsService = { record: jest.fn() };
    emailService = {
      sendFinalConfirmationEmail: jest.fn(),
      sendAlert: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationConfirmationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(ReservationConfirmationService);
  });

  it('does nothing when a step is still missing', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
    });

    await service.maybeAutoConfirm('res-1');

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('does nothing when status is not PENDING', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      status: 'CANCELLED',
      datesConfirmedAt: new Date(),
      contractAcceptedAt: new Date(),
      confirmationPaymentReceivedAt: new Date(),
      depositReceivedAt: new Date(),
    });

    await service.maybeAutoConfirm('res-1');

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('confirms and sends the final email once all 4 steps are complete', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      contractAcceptedAt: new Date(),
      confirmationPaymentReceivedAt: new Date(),
      depositReceivedAt: new Date(),
    });
    emailService.sendFinalConfirmationEmail.mockResolvedValue(undefined);

    await service.maybeAutoConfirm('res-1');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'CONFIRMED' },
    });
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'RESERVATION_CONFIRMED',
    );
    expect(emailService.sendFinalConfirmationEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'Jane Doe',
      expect.stringContaining('tok-1'),
    );
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'FINAL_EMAIL_SENT',
    );
  });

  it('logs a failure event and sends an alert when the final email fails', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      contractAcceptedAt: new Date(),
      confirmationPaymentReceivedAt: new Date(),
      depositReceivedAt: new Date(),
    });
    emailService.sendFinalConfirmationEmail.mockRejectedValue(
      new Error('Resend down'),
    );

    await service.maybeAutoConfirm('res-1');

    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'FINAL_EMAIL_FAILED',
      'Resend down',
    );
    expect(emailService.sendAlert).toHaveBeenCalled();
  });

  describe('resendFinalEmail', () => {
    it('resends the final email for a confirmed reservation', async () => {
      const confirmed = { ...baseReservation, status: 'CONFIRMED' };
      prisma.reservation.findUnique.mockResolvedValue(confirmed);
      emailService.sendFinalConfirmationEmail.mockResolvedValue(undefined);

      const { sent, reservation } = await service.resendFinalEmail('res-1');

      expect(sent).toBe(true);
      expect(reservation).toBe(confirmed);
      expect(emailService.sendFinalConfirmationEmail).toHaveBeenCalledWith(
        'jane@example.com',
        'Jane Doe',
        expect.stringContaining('tok-1'),
      );
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { finalConfirmationEmailSentAt: expect.any(Date) },
      });
    });

    it('reports sent: false when the resend fails', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation, status: 'CONFIRMED' });
      emailService.sendFinalConfirmationEmail.mockRejectedValue(new Error('Resend down'));

      const { sent } = await service.resendFinalEmail('res-1');

      expect(sent).toBe(false);
      expect(emailService.sendAlert).toHaveBeenCalled();
    });

    it('throws when the reservation does not exist', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(service.resendFinalEmail('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the reservation has no guest email', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        status: 'CONFIRMED',
        guestEmail: null,
      });

      await expect(service.resendFinalEmail('res-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when the reservation is not confirmed yet', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation, status: 'PENDING' });

      await expect(service.resendFinalEmail('res-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
