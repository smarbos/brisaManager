import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GuestsService } from '../guests/guests.service';
import { parsePercentage, resolveFeeAmount } from '../settings/fee-value';

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
      // Cast from Prisma's Decimal: left as-is, it serializes to a JSON *string*, which
      // silently breaks guest-web's `amount.toLocaleString('es-AR')` (a string's
      // toLocaleString() just falls back to toString(), no thousands separators) —
      // confirmationPaymentAmount/securityDepositAmount below never had this problem since
      // resolveFeeAmount() already returns a real number.
      totalAmount: Number(reservation.totalAmount),
      confirmationPaymentAmount: resolveFeeAmount(settings.confirmationPaymentValue, Number(reservation.totalAmount)),
      confirmationPaymentPercentage: parsePercentage(settings.confirmationPaymentValue),
      currency: reservation.currency,
      datesConfirmedAt: reservation.datesConfirmedAt,
      contractAcceptedAt: reservation.contractAcceptedAt,
      contractAcceptedName: reservation.contractAcceptedName,
      contractSnapshot: reservation.contractSnapshot,
      confirmationPaymentReceivedAt: reservation.confirmationPaymentReceivedAt,
      depositReceivedAt: reservation.depositReceivedAt,
      houseRulesText: settings.houseRulesText,
      paymentInstructions: settings.paymentInstructions,
      depositInstructions: settings.depositInstructions,
      confirmationStepText: settings.confirmationStepText,
      bankAccountHolder: settings.bankAccountHolder,
      bankCuil: settings.bankCuil,
      bankAccountNumber: settings.bankAccountNumber,
      bankCbu: settings.bankCbu,
      bankAlias: settings.bankAlias,
      bankName: settings.bankName,
      securityDepositAmount: resolveFeeAmount(settings.securityDepositValue, Number(reservation.totalAmount)),
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
