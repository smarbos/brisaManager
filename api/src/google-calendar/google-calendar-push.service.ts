import { Injectable, Logger } from '@nestjs/common';
import { Reservation, ReservationSource } from '@prisma/client';
import { calendar_v3 } from '@googleapis/calendar';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { PrismaService } from '../prisma/prisma.service';

const SOURCE_LABELS: Record<ReservationSource, string> = {
  BOOKING: 'Booking.com',
  AIRBNB: 'Airbnb',
  DIRECT: 'Directo',
  OTHER: 'Otro',
};

const STATUS_LABELS: Record<Reservation['status'], string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
};

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isNotFoundError(error: unknown): boolean {
  return (error as { code?: number }).code === 404;
}

@Injectable()
export class GoogleCalendarPushService {
  private readonly logger = new Logger(GoogleCalendarPushService.name);

  constructor(
    private readonly authService: GoogleCalendarAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async pushReservation(reservation: Reservation): Promise<void> {
    try {
      const authorized = await this.authService.getAuthorizedCalendarClient();
      if (!authorized) {
        return;
      }
      const { client, calendarId } = authorized;
      const isActive = reservation.status !== 'CANCELLED' && reservation.status !== 'COMPLETED';

      if (!isActive) {
        await this.removeEvent(client, calendarId, reservation);
        return;
      }

      await this.upsertEvent(client, calendarId, reservation);
      await this.prisma.settings.update({ where: { id: 'singleton' }, data: { lastCalendarSyncError: null } });
    } catch (error) {
      this.logger.error(`Google Calendar push failed for reservation ${reservation.id}: ${(error as Error).message}`);
      try {
        await this.prisma.settings.update({
          where: { id: 'singleton' },
          data: { lastCalendarSyncError: (error as Error).message },
        });
      } catch {
        // Swallow: recording the sync error must never itself throw.
      }
      if (this.authService.isInvalidGrantError(error)) {
        // Google has revoked/expired our refresh token — clear the stored credentials so
        // Settings correctly shows "not connected" / prompts reconnecting, instead of silently
        // failing every push forever.
        await this.authService.disconnect().catch(() => undefined);
      }
    }
  }

  private async removeEvent(
    client: calendar_v3.Calendar,
    calendarId: string,
    reservation: Reservation,
  ): Promise<void> {
    if (!reservation.googleEventId) {
      return;
    }
    try {
      await client.events.delete({ calendarId, eventId: reservation.googleEventId });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    await this.prisma.reservation.update({ where: { id: reservation.id }, data: { googleEventId: null } });
  }

  private async upsertEvent(client: calendar_v3.Calendar, calendarId: string, reservation: Reservation): Promise<void> {
    const requestBody: calendar_v3.Schema$Event = {
      summary: `${reservation.guestName} (${SOURCE_LABELS[reservation.source]})`,
      description: `Huéspedes: ${reservation.paxCount}\nTotal: ${Number(reservation.totalAmount)} ${reservation.currency}\nEstado: ${STATUS_LABELS[reservation.status]}`,
      start: { date: toDateOnly(reservation.checkIn) },
      end: { date: toDateOnly(reservation.checkOut) },
    };

    if (reservation.googleEventId) {
      try {
        await client.events.update({ calendarId, eventId: reservation.googleEventId, requestBody });
        return;
      } catch (error) {
        // The stored event id no longer exists on the (possibly new, post-reconnect) calendar —
        // fall back to creating a fresh event, same as the "never pushed yet" branch below, so
        // the reservation's calendar sync recovers instead of failing forever.
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }

    const created = await client.events.insert({ calendarId, requestBody });
    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { googleEventId: created.data.id ?? null },
    });
  }
}
