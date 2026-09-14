import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from '@googleapis/calendar';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

function stripSourceSuffix(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function eventDate(dateTime?: calendar_v3.Schema$EventDateTime | null): Date | null {
  const value = dateTime?.date ?? dateTime?.dateTime;
  return value ? new Date(value) : null;
}

@Injectable()
export class GoogleCalendarPullService {
  private readonly logger = new Logger(GoogleCalendarPullService.name);

  constructor(
    private readonly authService: GoogleCalendarAuthService,
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async pull(): Promise<void> {
    const authorized = await this.authService.getAuthorizedCalendarClient();
    if (!authorized) {
      return;
    }
    const { client, calendarId } = authorized;

    try {
      const settings = await this.settingsService.get();
      const events = await this.listChangedEvents(client, calendarId, settings.googleSyncToken ?? undefined);

      for (const event of events.items) {
        if (event.id) {
          await this.applyEvent(event);
        }
      }

      await this.prisma.settings.update({
        where: { id: 'singleton' },
        data: {
          googleSyncToken: events.nextSyncToken ?? null,
          lastCalendarSyncAt: new Date(),
          lastCalendarSyncError: null,
        },
      });
    } catch (error) {
      this.logger.error(`Google Calendar pull failed: ${(error as Error).message}`);
      await this.prisma.settings.update({
        where: { id: 'singleton' },
        data: { lastCalendarSyncAt: new Date(), lastCalendarSyncError: (error as Error).message },
      });
      if (this.authService.isInvalidGrantError(error)) {
        // Google has revoked/expired our refresh token — clear the stored credentials so
        // Settings correctly shows "not connected" / prompts reconnecting.
        await this.authService.disconnect().catch(() => undefined);
      }
    }
  }

  private async listChangedEvents(
    client: calendar_v3.Calendar,
    calendarId: string,
    initialSyncToken: string | undefined,
  ): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null | undefined }> {
    let syncToken = initialSyncToken;
    let pageToken: string | undefined;
    let nextSyncToken: string | null | undefined;
    const items: calendar_v3.Schema$Event[] = [];

    do {
      let response;
      try {
        response = await client.events.list({ calendarId, syncToken, pageToken, showDeleted: true, singleEvents: true });
      } catch (error) {
        if ((error as { code?: number }).code === 410) {
          // The stored sync token expired or was invalidated — drop it and do a full resync.
          syncToken = undefined;
          pageToken = undefined;
          response = await client.events.list({ calendarId, showDeleted: true, singleEvents: true });
        } else {
          throw error;
        }
      }

      items.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
      nextSyncToken = response.data.nextSyncToken;
    } while (pageToken);

    return { items, nextSyncToken };
  }

  private parseEventDetails(
    event: calendar_v3.Schema$Event,
  ): { checkIn: Date; checkOut: Date; guestName: string } | null {
    const checkIn = eventDate(event.start);
    const checkOut = eventDate(event.end);
    if (!checkIn || !checkOut || !event.summary) {
      return null;
    }
    return { checkIn, checkOut, guestName: stripSourceSuffix(event.summary) };
  }

  private async applyEvent(event: calendar_v3.Schema$Event): Promise<void> {
    // Defense in depth: pull() already only calls applyEvent for events with an id, but this
    // function guards the sub-project's most important invariant (never mutate BOOKING/AIRBNB),
    // and its very first line does a findFirst keyed on event.id — an undefined id there would
    // make the filter absent and could match an arbitrary reservation. Guard here too.
    if (!event.id) {
      return;
    }

    const existing = await this.prisma.reservation.findFirst({ where: { googleEventId: event.id } });
    const isCancelled = event.status === 'cancelled';

    if (existing) {
      // Channel-sourced reservations are pull-immune: their iCal feed is the source of truth.
      if (existing.source !== 'DIRECT') {
        return;
      }

      if (isCancelled) {
        await this.prisma.reservation.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED', googleEventId: null },
        });
        return;
      }

      const details = this.parseEventDetails(event);
      if (!details) {
        return;
      }

      await this.prisma.reservation.update({
        where: { id: existing.id },
        data: { guestName: details.guestName, checkIn: details.checkIn, checkOut: details.checkOut },
      });
      return;
    }

    if (isCancelled) {
      return;
    }

    const details = this.parseEventDetails(event);
    if (!details) {
      return;
    }

    await this.prisma.reservation.create({
      data: {
        guestName: details.guestName,
        checkIn: details.checkIn,
        checkOut: details.checkOut,
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        status: 'PENDING',
        googleEventId: event.id,
        notes: 'Auto-created from a Google Calendar event. Please review pax count, price, and contact details.',
      },
    });
  }
}
