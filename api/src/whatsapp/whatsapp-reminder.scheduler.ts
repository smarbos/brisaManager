import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsappService } from './whatsapp.service';
import { renderTemplate } from '../common/render-template';

function startOfUtcDayOffset(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

@Injectable()
export class WhatsappReminderSchedulerService {
  private readonly logger = new Logger(WhatsappReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleDailyReminders(): Promise<void> {
    const settings = await this.settingsService.get();

    await this.sendReservationReminders(settings);
    await this.sendDepositReminders(settings);
  }

  private async sendReservationReminders(settings: {
    reservationReminderDaysBefore: number;
    reservationReminderWhatsappTemplate: string;
  }): Promise<void> {
    // checkIn/checkOut are stored as UTC midnight with no time-of-day component (same
    // convention EmailService's cancellation email relies on), so an exact-date match
    // is a plain equality check against that midnight timestamp.
    const targetCheckIn = startOfUtcDayOffset(settings.reservationReminderDaysBefore);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        guestPhone: { not: null },
        reservationReminderSentAt: null,
        checkIn: targetCheckIn,
      },
    });

    for (const reservation of reservations) {
      try {
        const body = renderTemplate(settings.reservationReminderWhatsappTemplate, {
          guestName: reservation.guestName,
          checkIn: formatDateOnly(reservation.checkIn),
          checkOut: formatDateOnly(reservation.checkOut),
        });
        const sent = await this.whatsappService.sendMessage(reservation.guestPhone as string, body);
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

  private async sendDepositReminders(settings: {
    depositReminderDaysAfter: number;
    depositReminderWhatsappTemplate: string;
    paymentInstructions: string;
  }): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - settings.depositReminderDaysAfter);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: { not: 'CANCELLED' },
        guestPhone: { not: null },
        confirmationPaymentReceivedAt: null,
        depositReminderSentAt: null,
        confirmationEmailSentAt: { not: null, lte: cutoff },
      },
    });

    for (const reservation of reservations) {
      try {
        const body = renderTemplate(settings.depositReminderWhatsappTemplate, {
          guestName: reservation.guestName,
          checkIn: formatDateOnly(reservation.checkIn),
          paymentInstructions: settings.paymentInstructions,
        });
        const sent = await this.whatsappService.sendMessage(reservation.guestPhone as string, body);
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
