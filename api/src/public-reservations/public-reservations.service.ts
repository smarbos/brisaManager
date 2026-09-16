import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GuestsService } from '../guests/guests.service';

@Injectable()
export class PublicReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: ReservationEventsService,
    private readonly confirmationService: ReservationConfirmationService,
    private readonly guestsService: GuestsService,
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
      confirmationPaymentAmount:
        Math.round(Number(reservation.totalAmount) * (settings.confirmationPaymentPercentage / 100) * 100) / 100,
      confirmationPaymentPercentage: settings.confirmationPaymentPercentage,
      currency: reservation.currency,
      datesConfirmedAt: reservation.datesConfirmedAt,
      contractAcceptedAt: reservation.contractAcceptedAt,
      contractAcceptedName: reservation.contractAcceptedName,
      confirmationPaymentReceivedAt: reservation.confirmationPaymentReceivedAt,
      depositReceivedAt: reservation.depositReceivedAt,
      houseRulesText: settings.houseRulesText,
      paymentInstructions: settings.paymentInstructions,
      depositInstructions: settings.depositInstructions,
      bankAccountHolder: settings.bankAccountHolder,
      bankCuil: settings.bankCuil,
      bankAccountNumber: settings.bankAccountNumber,
      bankCbu: settings.bankCbu,
      bankAlias: settings.bankAlias,
      bankName: settings.bankName,
      securityDepositAmount:
        Math.round(Number(reservation.totalAmount) * (settings.securityDepositPercentage / 100) * 100) / 100,
    };
  }

  async confirmDates(token: string, fullName: string, phone: string, email: string) {
    const reservation = await this.findByToken(token);

    if (reservation.datesConfirmedAt) {
      return { datesConfirmedAt: reservation.datesConfirmedAt };
    }

    const normalizedEmail = email.trim().toLowerCase();

    // The guest is the authoritative source for their own name/contact info at this point —
    // this overwrites whatever was there before (a Booking.com placeholder, a typo from
    // manual entry, or nothing at all), not just fills a gap.
    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        datesConfirmedAt: new Date(),
        guestName: fullName,
        guestPhone: phone,
        guestEmail: normalizedEmail,
      },
    });

    await this.eventsService.record(reservation.id, 'DATES_CONFIRMED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    void this.guestsService.syncFromReservation(updated.id, {
      email: normalizedEmail,
      name: fullName,
      phone,
    });

    return { datesConfirmedAt: updated.datesConfirmedAt };
  }

  async acceptContract(token: string) {
    const reservation = await this.findByToken(token);

    if (reservation.contractAcceptedAt) {
      return { contractAcceptedAt: reservation.contractAcceptedAt };
    }

    const settings = await this.settingsService.get();

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        contractAcceptedAt: new Date(),
        contractAcceptedName: reservation.guestName,
        contractSnapshot: settings.houseRulesText,
      },
    });

    await this.eventsService.record(reservation.id, 'CONTRACT_ACCEPTED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    return { contractAcceptedAt: updated.contractAcceptedAt };
  }
}
