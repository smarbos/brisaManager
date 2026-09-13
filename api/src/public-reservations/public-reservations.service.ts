import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';

@Injectable()
export class PublicReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: ReservationEventsService,
    private readonly confirmationService: ReservationConfirmationService,
  ) {}

  private async findByToken(token: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { confirmationToken: token },
    });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  async getByToken(token: string) {
    const reservation = await this.findByToken(token);
    const settings = await this.settingsService.get();

    return {
      guestName: reservation.guestName,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      paxCount: reservation.paxCount,
      totalAmount: reservation.totalAmount,
      currency: reservation.currency,
      datesConfirmedAt: reservation.datesConfirmedAt,
      contractAcceptedAt: reservation.contractAcceptedAt,
      contractAcceptedName: reservation.contractAcceptedName,
      confirmationPaymentReceivedAt: reservation.confirmationPaymentReceivedAt,
      depositReceivedAt: reservation.depositReceivedAt,
      houseRulesText: settings.houseRulesText,
      paymentInstructions: settings.paymentInstructions,
    };
  }

  async confirmDates(token: string) {
    const reservation = await this.findByToken(token);

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { datesConfirmedAt: reservation.datesConfirmedAt ?? new Date() },
    });

    await this.eventsService.record(reservation.id, 'DATES_CONFIRMED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    return { datesConfirmedAt: updated.datesConfirmedAt };
  }

  async acceptContract(token: string, fullName: string) {
    const reservation = await this.findByToken(token);
    const settings = await this.settingsService.get();

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        contractAcceptedAt: reservation.contractAcceptedAt ?? new Date(),
        contractAcceptedName: fullName,
        contractSnapshot: settings.houseRulesText,
      },
    });

    await this.eventsService.record(reservation.id, 'CONTRACT_ACCEPTED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    return { contractAcceptedAt: updated.contractAcceptedAt };
  }
}
