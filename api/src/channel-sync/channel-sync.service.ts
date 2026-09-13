import { Injectable } from '@nestjs/common';
import * as ical from 'node-ical';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { ReservationSource } from '@prisma/client';

interface PlatformConfig {
  source: ReservationSource;
  icalUrl: string | null;
  guestNamePlaceholder: string;
  displayName: string;
}

@Injectable()
export class ChannelSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  async syncAll(): Promise<void> {
    const settings = await this.settingsService.get();
    const errors: string[] = [];

    const platforms: PlatformConfig[] = [
      {
        source: 'BOOKING',
        icalUrl: settings.bookingIcalUrl,
        guestNamePlaceholder: 'Booking.com Guest',
        displayName: 'Booking.com',
      },
      {
        source: 'AIRBNB',
        icalUrl: settings.airbnbIcalUrl,
        guestNamePlaceholder: 'Airbnb Guest',
        displayName: 'Airbnb',
      },
    ];

    for (const platform of platforms) {
      try {
        await this.syncPlatform(platform);
      } catch (error) {
        errors.push(`${platform.displayName}: ${(error as Error).message}`);
      }
    }

    const errorMessage = errors.length > 0 ? errors.join('; ') : null;

    await this.prisma.settings.update({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: new Date(), lastChannelSyncError: errorMessage },
    });

    if (errorMessage) {
      await this.emailService.sendAlert('Channel sync failed', errorMessage);
    }
  }

  private async syncPlatform(config: PlatformConfig): Promise<void> {
    if (!config.icalUrl) {
      return;
    }

    const parsed = await ical.async.fromURL(config.icalUrl);

    const events = Object.values(parsed).filter(
      (component): component is ical.VEvent => component !== undefined && component.type === 'VEVENT',
    );
    const currentUids = new Set(events.map((event) => event.uid));

    for (const event of events) {
      const existing = await this.prisma.reservation.findFirst({
        where: { source: config.source, externalReference: event.uid },
      });

      if (existing) {
        if (existing.missingFromChannelAt) {
          await this.prisma.reservation.update({
            where: { id: existing.id },
            data: { missingFromChannelAt: null },
          });
        }
        continue;
      }

      await this.prisma.reservation.create({
        data: {
          guestName: config.guestNamePlaceholder,
          checkIn: event.start,
          // Some feeds omit DTEND for a zero-duration/one-day event; fall back to checkIn.
          checkOut: event.end ?? event.start,
          paxCount: 1,
          source: config.source,
          externalReference: event.uid,
          totalAmount: 0,
          currency: 'ARS',
          status: 'PENDING',
          notes: `Auto-created from ${config.displayName} calendar sync. Please add the guest's real contact info.`,
        },
      });
    }

    const existingSynced = await this.prisma.reservation.findMany({
      where: { source: config.source, externalReference: { not: null } },
    });

    for (const reservation of existingSynced) {
      const stillPresent = reservation.externalReference && currentUids.has(reservation.externalReference);
      if (!stillPresent && !reservation.missingFromChannelAt) {
        await this.prisma.reservation.update({
          where: { id: reservation.id },
          data: { missingFromChannelAt: new Date() },
        });
      }
    }
  }
}
