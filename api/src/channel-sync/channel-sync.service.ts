import { Injectable } from '@nestjs/common';
import * as ical from 'node-ical';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReservationSource } from '@prisma/client';

interface PlatformConfig {
  source: ReservationSource;
  icalUrl: string | null;
  displayName: string;
}

// Guard against a slow/hanging feed provider blocking the sync (and, on the cron path, the
// next scheduled tick) indefinitely.
const ICAL_FETCH_TIMEOUT_MS = 15_000;

// The Chrome extension (see channel-import.service.ts) is now the source of truth for
// reservation data scraped from Booking.com/Airbnb — richer and more current than an iCal
// feed, which only ever gives a blocked date range, no guest name/contact/price. This
// service no longer creates or upserts Reservation rows from the feed at all; it uses it
// purely as a second opinion: for every date range the feed shows as blocked, check whether
// a real reservation already covers it, and raise a Notification when one doesn't — a sign
// staff imported (or entered) it somewhere else, or haven't gotten to it yet.
@Injectable()
export class ChannelSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async syncAll(): Promise<void> {
    const settings = await this.settingsService.get();
    const errors: string[] = [];

    const platforms: PlatformConfig[] = [
      { source: 'BOOKING', icalUrl: settings.bookingIcalUrl, displayName: 'Booking.com' },
      { source: 'AIRBNB', icalUrl: settings.airbnbIcalUrl, displayName: 'Airbnb' },
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
      await this.emailService.sendAlert('Falló la sincronización de canales', errorMessage);
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
    const today = new Date(new Date().setHours(0, 0, 0, 0));

    for (const event of events) {
      const checkIn = event.start;
      // Some feeds omit DTEND for a zero-duration/one-day event; fall back to checkIn.
      const checkOut = event.end ?? event.start;

      // A blocked range that's already over is history — nothing left for staff to load.
      if (checkOut < today) {
        continue;
      }

      const overlapping = await this.prisma.reservation.findFirst({
        where: {
          source: config.source,
          status: { not: 'CANCELLED' },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
        },
        select: { id: true },
      });

      if (overlapping) {
        continue;
      }

      // Keyed on the feed's own event uid, not the date — stable across re-runs even if the
      // block's dates themselves shift, and immune to two unrelated blocks landing on the
      // same start date.
      const dedupeKey = `calendar-mismatch:${config.source}:${event.uid}`;
      if (await this.notificationsService.hasOpen(dedupeKey)) {
        continue;
      }

      const dateLabel = checkIn.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
      await this.notificationsService.create({
        type: 'CALENDAR_MISMATCH',
        message: `${config.displayName} muestra un día bloqueado el ${dateLabel} sin una reserva cargada que coincida. Revisá el calendario del canal y cargá la reserva si falta.`,
        dedupeKey,
      });
    }
  }
}
