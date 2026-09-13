import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ReservationConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
    private readonly emailService: EmailService,
  ) {}

  async maybeAutoConfirm(reservationId: string): Promise<void> {
    const reservation = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    });

    const allStepsComplete = Boolean(
      reservation.datesConfirmedAt &&
      reservation.contractAcceptedAt &&
      reservation.confirmationPaymentReceivedAt &&
      reservation.depositReceivedAt,
    );

    if (!allStepsComplete || reservation.status !== 'PENDING') {
      return;
    }

    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'CONFIRMED' },
    });
    await this.eventsService.record(reservationId, 'RESERVATION_CONFIRMED');

    if (reservation.finalConfirmationEmailSentAt || !reservation.guestEmail) {
      return;
    }

    try {
      await this.emailService.sendFinalConfirmationEmail(
        reservation.guestEmail,
        reservation.guestName,
      );
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { finalConfirmationEmailSentAt: new Date() },
      });
      await this.eventsService.record(reservationId, 'FINAL_EMAIL_SENT');
    } catch (error) {
      await this.eventsService.record(
        reservationId,
        'FINAL_EMAIL_FAILED',
        (error as Error).message,
      );
      await this.emailService.sendAlert(
        'Final confirmation email failed',
        `Reservation ${reservationId} for ${reservation.guestName} auto-confirmed but the final email failed to send: ${(error as Error).message}`,
      );
    }
  }
}
