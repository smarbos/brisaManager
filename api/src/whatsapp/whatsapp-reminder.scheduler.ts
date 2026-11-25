import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsappService } from './whatsapp.service';
import { depositReminderMessage, reservationReminderMessage } from './whatsapp-templates';

function startOfUtcDayOffset(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

@Injectable()
export class WhatsappReminderSchedulerService {
  private readonly logger = new Logger(WhatsappReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly settingsService: SettingsService,
  ) {}

  // Pinned to Argentina: the server runs in UTC, where 9 AM was 6 AM for guests.
  @Cron('0 10 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async handleDailyReminders(): Promise<void> {
    try {
      const settings = await this.settingsService.get();

      await this.sendReservationReminders(settings);
      await this.sendDepositReminders(settings);
    } catch (error) {
      this.logger.error(`Scheduled WhatsApp reminders failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  private async sendReservationReminders(settings: { reservationReminderDaysBefore: number }): Promise<void> {
    // checkIn/checkOut are stored as UTC midnight with no time-of-day component (same
    // convention EmailService's cancellation email relies on), but that's not
    // structurally guaranteed (e.g. channel-sync's node-ical import could construct
    // local-not-UTC midnight depending on process TZ), so match the whole target day
    // as a range rather than relying on exact equality against a computed midnight.
    const targetCheckIn = startOfUtcDayOffset(settings.reservationReminderDaysBefore);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        guestPhone: { not: null },
        reservationReminderSentAt: null,
        checkIn: { gte: targetCheckIn, lt: startOfUtcDayOffset(settings.reservationReminderDaysBefore + 1) },
      },
    });

    for (const reservation of reservations) {
      try {
        const sent = await this.whatsappService.sendTemplate(
          reservation.guestPhone as string,
          reservationReminderMessage(reservation),
          { reservationId: reservation.id, kind: 'RESERVATION_REMINDER' },
        );
        if (sent) {
          await this.prisma.reservation.update({
            where: { id: reservation.id },
            data: { reservationReminderSentAt: new Date() },
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to send reservation reminder for ${reservation.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async sendDepositReminders(settings: { depositReminderDaysAfter: number }): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - settings.depositReminderDaysAfter);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        guestPhone: { not: null },
        askForPayment: true,
        confirmationPaymentReceivedAt: null,
        depositReminderSentAt: null,
        // Counted from the first message, email or WhatsApp, so guests with only a phone get it too.
        OR: [
          { confirmationEmailSentAt: { not: null, lte: cutoff } },
          { confirmationWhatsappSentAt: { not: null, lte: cutoff } },
        ],
        checkIn: { gte: startOfUtcDayOffset(0) },
      },
    });

    for (const reservation of reservations) {
      try {
        const sent = await this.whatsappService.sendTemplate(
          reservation.guestPhone as string,
          depositReminderMessage(reservation),
          { reservationId: reservation.id, kind: 'DEPOSIT_REMINDER' },
        );
        if (sent) {
          await this.prisma.reservation.update({
            where: { id: reservation.id },
            data: { depositReminderSentAt: new Date() },
          });
        }
      } catch (error) {
        this.logger.error(`Failed to send deposit reminder for ${reservation.id}: ${(error as Error).message}`);
      }
    }
  }
}
