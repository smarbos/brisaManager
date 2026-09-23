import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Reservation,
  ReservationSource,
  ReservationStatus,
} from '@prisma/client';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { GuestsService } from '../guests/guests.service';
import { ReservationsService } from '../reservations/reservations.service';
import { ImportReservationDto } from './dto/import-reservation.dto';

export interface ImportStatusResult {
  exists: boolean;
  guestName?: string;
  checkIn?: Date;
  checkOut?: Date;
  status?: ReservationStatus;
}

const SOURCE_MAP: Record<ImportReservationDto['source'], ReservationSource> = {
  'booking.com': 'BOOKING',
  airbnb: 'AIRBNB',
};

const EXTERNAL_REFERENCE_PREFIX: Record<
  ImportReservationDto['source'],
  string
> = {
  'booking.com': 'booking-extranet',
  airbnb: 'airbnb-thread',
};

// Best-effort only: a badly-scraped phone string from Booking.com's/Airbnb's page must never
// block an import the way an invalid number blocks admin-web's manual form or guest-web's
// check-in wizard (both hard-reject via IsValidPhoneNumber). If it doesn't parse as a real
// number, it's stored exactly as scraped instead, for a human to clean up later.
function normalizePhoneBestEffort(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw, 'AR');
  return parsed?.isValid() ? parsed.number : raw;
}

const STATUS_MAP: Record<string, ReservationStatus> = {
  confirmed: 'CONFIRMED',
  ok: 'CONFIRMED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  completed: 'COMPLETED',
};

function mapStatus(raw: string | null): ReservationStatus {
  if (!raw) return 'PENDING';
  return STATUS_MAP[raw.trim().toLowerCase()] ?? 'PENDING';
}

// Best-effort only: Booking.com's actual price formatting on the extranet page is unknown
// until real Phase 2 selectors are confirmed, and total_price is always in unverified_fields
// until then anyway. Handles the common "45.000" (thousands dot) and "45,50" (decimal comma)
// shapes; refine once a real captured sample is available.
function parseAmount(raw: string | null): number {
  if (!raw) return 0;
  const withoutThousandsDot = raw.replace(/\.(?=\d{3}(?:\D|$))/g, '');
  const normalized = withoutThousandsDot
    .replace(/[^\d,.-]/g, '')
    .replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function buildNotes(dto: ImportReservationDto): string {
  const base =
    dto.source === 'airbnb'
      ? `Creada desde la extensión de Chrome (mensajes de Airbnb, thread ${dto.res_id}).`
      : `Creada desde la extensión de Chrome (Booking.com extranet, res_id ${dto.res_id}, hotel_id ${dto.hotel_id}).`;
  if (dto.unverified_fields.length === 0) {
    return base;
  }
  return `${base} Campos sin verificar, revisar y corregir manualmente: ${dto.unverified_fields.join(', ')}.`;
}

export interface ChannelImportResult {
  reservation: Reservation;
  created: boolean;
}

@Injectable()
export class ChannelImportService {
  private readonly logger = new Logger(ChannelImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
    private readonly googleCalendarPushService: GoogleCalendarPushService,
    private readonly guestsService: GuestsService,
    private readonly reservationsService: ReservationsService,
  ) {}

  async import(dto: ImportReservationDto): Promise<ChannelImportResult> {
    // The hotel_id pin only applies to Booking.com — we only ever operate one property
    // there, so a valid API key paired with a hotel_id that isn't ours is either a
    // misconfigured extension or a leaked key being probed against other data. Airbnb's
    // messages page has no equivalent identifier to pin against in this flow.
    if (dto.source === 'booking.com') {
      const expectedHotelId = process.env.BOOKING_HOTEL_ID;
      if (!expectedHotelId || dto.hotel_id !== expectedHotelId) {
        this.logger.warn(
          `Rejected import for unexpected hotel_id "${dto.hotel_id}" (res_id ${dto.res_id})`,
        );
        throw new ForbiddenException('Unexpected hotel_id');
      }
    }

    const source = SOURCE_MAP[dto.source];
    const externalReference = `${EXTERNAL_REFERENCE_PREFIX[dto.source]}-${dto.res_id}`;

    const existing = await this.prisma.reservation.findUnique({
      where: { source_externalReference: { source, externalReference } },
    });

    if (existing && existing.status !== 'CANCELLED') {
      // The operator explicitly re-ran the extension against this same thread — treat that
      // as "refresh this from what Airbnb/Booking.com shows now" (e.g. the guest changed
      // dates after the first import), not a no-op. Only fields this scrape actually found a
      // value for are touched (see updateFromRescan()), so a field the scrape came back empty
      // on this time — including guest_email, which Airbnb never provides — never gets
      // clobbered with a blank.
      return this.updateFromRescan(existing, dto);
    }

    if (existing) {
      // A cancelled reservation shouldn't permanently claim this res_id/thread — e.g. a
      // guest cancels and then rebooks through the very same Airbnb message thread, or a
      // Booking.com reservation is cancelled and re-created with the same res_id. Free up
      // the externalReference so the new reservation created below can claim it; the old
      // cancelled row is kept as-is for history, just renamed off the live slot.
      await this.prisma.reservation.update({
        where: { id: existing.id },
        data: {
          externalReference: `${externalReference}-superseded-${existing.id}`,
        },
      });
    }

    const now = new Date();
    const checkIn = dto.check_in ? new Date(dto.check_in) : now;
    const checkOut = dto.check_out
      ? new Date(dto.check_out)
      : new Date(checkIn.getTime() + 24 * 60 * 60 * 1000);

    if (checkOut <= checkIn) {
      throw new BadRequestException('check_out must be after check_in');
    }

    const guestEmail = dto.guest_email?.trim().toLowerCase() || null;
    const trimmedPhone = dto.guest_phone?.trim() || null;
    const guestPhone = trimmedPhone
      ? normalizePhoneBestEffort(trimmedPhone)
      : null;

    // Sending the confirmation email invites the guest into the confirmation flow (accept
    // dates, accept the contract, etc.) — the reservation is, by definition, awaiting that
    // action, so it's forced to PENDING whenever we're about to email regardless of
    // whatever mapStatus(dto.status) would otherwise say. In practice dto.status is always
    // null today (Booking.com's extranet doesn't expose it as scrapeable text — see the
    // file-header comment), so mapStatus(null) already returns PENDING anyway; this makes
    // that invariant explicit and intentional rather than an accident of today's data gap.
    const status = guestEmail ? 'PENDING' : mapStatus(dto.status);

    const reservation = await this.prisma.reservation.create({
      data: {
        guestName:
          dto.guest_name?.trim() ||
          (dto.source === 'airbnb'
            ? 'Huésped de Airbnb (pendiente de completar)'
            : 'Huésped de Booking.com (pendiente de completar)'),
        guestEmail,
        guestPhone,
        checkIn,
        checkOut,
        paxCount: dto.guests ?? 1,
        source,
        externalReference,
        totalAmount: parseAmount(dto.total_price),
        currency: dto.currency?.trim() || 'ARS',
        status,
        notes: buildNotes(dto),
      },
    });

    await this.eventsService.record(
      reservation.id,
      'RESERVATION_CREATED',
      buildNotes(dto),
    );

    // Link to (or create) the Guest record whenever we have an email or phone — this is
    // just CRM bookkeeping, not guest-facing, so it's safe even if other fields are still
    // unverified: a later correction to name/dates doesn't invalidate the guest link.
    // Airbnb's hosting messages page never exposes an email, only a phone, so this must not
    // be gated on email alone or Airbnb-only guests never get a Guest record at all.
    if (guestEmail || guestPhone) {
      void this.guestsService.syncFromReservation(reservation.id, {
        email: guestEmail,
        name: reservation.guestName,
        phone: guestPhone,
      });
    }

    // The confirmation email is sent whenever we have an email at all, independent of
    // whether the other scraped fields are verified — it links the guest into the same
    // confirmation flow a manually-created reservation uses, which is exactly where
    // whatever's still missing or wrong (dates, pax count, etc.) gets reviewed and
    // corrected, by the guest or by staff afterward. It's not a claim that the data is
    // already right, just an invitation to complete it.
    if (guestEmail) {
      void this.reservationsService.sendInitialEmail(reservation);
    }

    // Every reservation reaches the shared Google Calendar on creation, regardless of
    // which scraped fields are still unverified — the calendar is a staff-facing
    // visibility/double-booking-prevention tool (per the Google Calendar integration
    // design doc), not something that round-trips back into Booking.com's or Airbnb's own
    // availability feed, so an approximate date is far more useful there than no event at
    // all. Gating this on `unverified_fields` used to make Airbnb-sourced reservations
    // permanently unreachable — every field the Airbnb content script scrapes is always
    // marked unverified by design (see content_script_airbnb.js), so a "dates verified"
    // gate silently dropped every single Airbnb import from ever appearing on the
    // calendar. Once staff correct any wrong dates in the admin app, the next update()
    // call re-pushes the corrected event automatically.
    void this.googleCalendarPushService.pushReservation(reservation);

    return { reservation, created: true };
  }

  // Re-running the extension against a thread that's already imported refreshes whatever
  // this scrape found a value for, and leaves everything else (including anything staff
  // corrected by hand) untouched — see the comment at the call site above.
  private async updateFromRescan(
    existing: Reservation,
    dto: ImportReservationDto,
  ): Promise<ChannelImportResult> {
    const guestName = dto.guest_name?.trim() || undefined;
    const trimmedPhone = dto.guest_phone?.trim() || undefined;
    const guestPhone = trimmedPhone
      ? normalizePhoneBestEffort(trimmedPhone)
      : undefined;
    const checkIn = dto.check_in ? new Date(dto.check_in) : undefined;
    const checkOut = dto.check_out ? new Date(dto.check_out) : undefined;
    const paxCount = dto.guests ?? undefined;
    const totalAmount = dto.total_price
      ? parseAmount(dto.total_price)
      : undefined;
    const currency =
      totalAmount !== undefined
        ? dto.currency?.trim() || existing.currency
        : undefined;

    const resolvedCheckIn = checkIn ?? existing.checkIn;
    const resolvedCheckOut = checkOut ?? existing.checkOut;
    if (resolvedCheckOut <= resolvedCheckIn) {
      throw new BadRequestException('check_out must be after check_in');
    }

    const updated = await this.prisma.reservation.update({
      where: { id: existing.id },
      data: {
        ...(guestName ? { guestName } : {}),
        ...(guestPhone ? { guestPhone } : {}),
        ...(checkIn ? { checkIn } : {}),
        ...(checkOut ? { checkOut } : {}),
        ...(paxCount ? { paxCount } : {}),
        ...(totalAmount !== undefined ? { totalAmount, currency } : {}),
      },
    });

    if (updated.guestEmail || updated.guestPhone) {
      void this.guestsService.syncFromReservation(updated.id, {
        email: updated.guestEmail,
        name: updated.guestName,
        phone: updated.guestPhone,
      });
    }

    // Fire-and-forget: see the comment in ReservationsService.update().
    void this.googleCalendarPushService.pushReservation(updated);

    return { reservation: updated, created: false };
  }

  async checkStatus(
    source: ImportReservationDto['source'],
    resId: string,
  ): Promise<ImportStatusResult> {
    const mappedSource = SOURCE_MAP[source];
    const externalReference = `${EXTERNAL_REFERENCE_PREFIX[source]}-${resId}`;

    const existing = await this.prisma.reservation.findUnique({
      where: {
        source_externalReference: { source: mappedSource, externalReference },
      },
    });

    if (!existing || existing.status === 'CANCELLED') {
      return { exists: false };
    }

    return {
      exists: true,
      guestName: existing.guestName,
      checkIn: existing.checkIn,
      checkOut: existing.checkOut,
      status: existing.status,
    };
  }
}
