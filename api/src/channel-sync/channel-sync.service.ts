import { Injectable } from '@nestjs/common';
import * as ical from 'node-ical';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { ReservationSource } from '@prisma/client';

interface PlatformConfig {
  source: ReservationSource;
  icalUrl: string | null;
  guestNamePlaceholder: string;
  displayName: string;
}

// Guard against a slow/hanging feed provider blocking the sync (and, on the cron path, the
// next scheduled tick) indefinitely.
const ICAL_FETCH_TIMEOUT_MS = 15_000;

@Injectable()
export class ChannelSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
    private readonly googleCalendarPushService: GoogleCalendarPushService,
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

    // node-ical's .d.ts mistypes the 2-argument (url, options) call as returning `void` — it
    // resolves to the callback-style overload even though the runtime always returns a Promise
    // when no callback is passed. Cast the function reference to the signature it actually has.
    const fromURLWithOptions = ical.async.fromURL as (
      url: string,
      options: { signal: AbortSignal },
    ) => Promise<ical.CalendarResponse>;
    const parsed = await fromURLWithOptions(config.icalUrl, { signal: AbortSignal.timeout(ICAL_FETCH_TIMEOUT_MS) });

    const events = Object.values(parsed).filter(
      (component): component is ical.VEvent => component !== undefined && component.type === 'VEVENT',
    );
    const currentUids = new Set(events.map((event) => event.uid));

    for (const event of events) {
      // Atomic upsert keyed on the (source, externalReference) unique constraint: this both
      // avoids a race between overlapping sync runs (cron tick vs. manual "Sync now") for the
      // same UID, and un-flags the reservation if it had been marked missing and reappeared.
      const upserted = await this.prisma.reservation.upsert({
        where: {
          source_externalReference: { source: config.source, externalReference: event.uid },
        },
        create: {
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
        update: {
          missingFromChannelAt: null,
        },
      });

      // BOOKING/AIRBNB reservations are written directly through Prisma here (bypassing
      // ReservationsService, intentionally — see this module's plan), so they'd otherwise never
      // reach Google Calendar at all. pushReservation is idempotent and never throws, so it's
      // safe to call unconditionally for every event in the feed.
      await this.googleCalendarPushService.pushReservation(upserted);
    }

    const existingSynced = await this.prisma.reservation.findMany({
      where: {
        source: config.source,
        externalReference: { not: null },
        // Only flag reservations that are still operationally relevant: don't keep flagging a
        // stay that's already over, or one that's already cancelled/completed.
        checkOut: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
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
