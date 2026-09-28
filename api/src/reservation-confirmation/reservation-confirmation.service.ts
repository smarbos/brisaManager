import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Reservation } from '@prisma/client';
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

    await this.sendFinalEmail(reservation);
  }

  // Public (not just used internally by maybeAutoConfirm()) so resendFinalEmail() below can
  // retry it on demand. Returns whether it actually sent, matching
  // ReservationsService.sendInitialEmail()'s same contract.
  async sendFinalEmail(reservation: Reservation): Promise<boolean> {
    try {
      const confirmationUrl = `${process.env.GUEST_WEB_ORIGIN}/r/${reservation.confirmationToken}`;
      await this.emailService.sendFinalConfirmationEmail(
        reservation.guestEmail as string,
        reservation.guestName,
        confirmationUrl,
      );
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { finalConfirmationEmailSentAt: new Date() },
      });
      await this.eventsService.record(reservation.id, 'FINAL_EMAIL_SENT');
      return true;
    } catch (error) {
      await this.eventsService.record(reservation.id, 'FINAL_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Falló el email de confirmación final',
        `La reserva ${reservation.id} para ${reservation.guestName} está confirmada pero falló el envío del email final: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Explicit staff-triggered retry — always attempts the send regardless of whether one was
  // already tried, same as ReservationsService.resendInitialEmail(). Only allowed once the
  // reservation is actually CONFIRMED, since the email itself says the stay is fully
  // confirmed — sending it earlier would be misleading regardless of guest-email presence.
  async resendFinalEmail(id: string): Promise<{ sent: boolean; reservation: Reservation }> {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    if (!reservation.guestEmail) {
      throw new BadRequestException('This reservation has no guest email to send to');
    }
    if (reservation.status !== 'CONFIRMED') {
      throw new BadRequestException('This reservation is not confirmed yet');
    }

    const sent = await this.sendFinalEmail(reservation);
    return { sent, reservation: (await this.prisma.reservation.findUnique({ where: { id } })) as Reservation };
  }
}
