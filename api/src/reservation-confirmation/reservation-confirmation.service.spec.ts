import { Test } from '@nestjs/testing';
import { ReservationConfirmationService } from './reservation-confirmation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';

describe('ReservationConfirmationService', () => {
  let service: ReservationConfirmationService;
  let prisma: {
    reservation: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
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
    status: 'PENDING',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
    finalConfirmationEmailSentAt: null,
  };

  beforeEach(async () => {
    prisma = {
      reservation: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
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
});
