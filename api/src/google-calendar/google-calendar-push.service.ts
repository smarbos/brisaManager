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

// Google Calendar's colorId is a string '1'-'11' picked from a fixed, unchangeable
// palette (no custom hex) — see https://developers.google.com/calendar/api/v3/reference/colors.
const STATUS_COLOR_IDS: Record<Reservation['status'], string> = {
  PENDING: '5', // Banana (yellow) — still awaiting guest/staff confirmation
  CONFIRMED: '10', // Basil (green) — confirmed, nothing pending
  CANCELLED: '11', // Tomato (red)
  COMPLETED: '8', // Graphite (gray) — stay in the past, out of the way visually
};

// A short bracketed tag prepended to the event title (e.g. "[Esperando pago] Jane Doe
// (Booking.com)") so staff can tell a reservation's state at a glance without opening it.
// CANCELLED/COMPLETED map directly from status; everything else is PENDING, where the plain
// status alone can't distinguish "hasn't started the guest wizard" from "just needs to pay" —
// that instead comes from which guest-confirmation step has actually completed. A reservation
// can be CONFIRMED without ever going through the wizard at all (e.g. a DIRECT booking staff
// mark confirmed by hand), so that check short-circuits ahead of the granular ones.
function statusTag(reservation: Reservation): string {
  if (reservation.status === 'CANCELLED') return 'Cancelada';
  if (reservation.status === 'COMPLETED') return 'Completada';
  if (reservation.status === 'CONFIRMED') return 'Confirmada';
  if (reservation.confirmationPaymentReceivedAt) return 'Confirmada';
  if (reservation.contractAcceptedAt) return 'Esperando pago';
  return 'Esperando confirmación';
}

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

  // Staff-triggered bulk retry — covers reservations whose one-time push at create/update
  // time was silently skipped (e.g. created before Google Calendar was ever connected, or
  // while a misconfigured OAuth client made every push fail) and never got a second
  // attempt. Sequential, not parallel — Google's Calendar API has per-user rate limits and a
  // single property's reservation count is small enough that this finishes quickly either way.
  async pushAllReservations(): Promise<{ pushed: number }> {
    const reservations = await this.prisma.reservation.findMany();
    for (const reservation of reservations) {
      await this.pushReservation(reservation);
    }
    return { pushed: reservations.length };
  }

  async pushReservation(reservation: Reservation): Promise<void> {
    try {
      const authorized = await this.authService.getAuthorizedCalendarClient();
      if (!authorized) {
        return;
      }
      const { client, calendarId } = authorized;

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

  private async upsertEvent(client: calendar_v3.Calendar, calendarId: string, reservation: Reservation): Promise<void> {
    const requestBody: calendar_v3.Schema$Event = {
      summary: `[${statusTag(reservation)}] ${reservation.guestName} (${SOURCE_LABELS[reservation.source]})`,
      description: `Huéspedes: ${reservation.paxCount}\nTotal: ${Number(reservation.totalAmount)} ${reservation.currency}\nEstado: ${STATUS_LABELS[reservation.status]}`,
      start: { date: toDateOnly(reservation.checkIn) },
      end: { date: toDateOnly(reservation.checkOut) },
      colorId: STATUS_COLOR_IDS[reservation.status],
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
