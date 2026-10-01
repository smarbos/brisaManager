import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { GuestsService } from '../guests/guests.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappDeliveryService } from '../whatsapp/whatsapp-delivery.service';
import { computeWhatsappIssues } from '../whatsapp/whatsapp-issues';
import { checkinLinkMessage } from '../whatsapp/whatsapp-templates';
import { normalizePhoneForWhatsapp } from '../whatsapp/phone-normalizer';
import { diffReservationFields, reservationFieldLabel } from './reservation-field-changes';
import { CreateReservationDto, GUEST_CONTACT_REQUIRED_MESSAGE } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';
import { Reservation } from '@prisma/client';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
    private readonly emailService: EmailService,
    private readonly confirmationService: ReservationConfirmationService,
    private readonly googleCalendarPushService: GoogleCalendarPushService,
    private readonly guestsService: GuestsService,
    private readonly whatsappService: WhatsappService,
    private readonly whatsappDeliveryService: WhatsappDeliveryService,
  ) {}

  private validateDates(checkIn: string, checkOut: string) {
    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('checkOut must be after checkIn');
    }
  }

  async create(dto: CreateReservationDto, actor?: string | null) {
    this.validateDates(dto.checkIn, dto.checkOut);

    const reservation = await this.prisma.reservation.create({
      data: {
        ...dto,
        checkIn: new Date(dto.checkIn),
        checkOut: new Date(dto.checkOut),
        externalReference: dto.externalReference?.trim() ? dto.externalReference.trim() : null,
      },
    });

    await this.eventsService.record(reservation.id, 'RESERVATION_CREATED', 'Creada manualmente por el personal');

    if (reservation.guestEmail) {
      await this.sendInitialEmail(reservation);
    }

    // Awaited like the email above (rather than fire-and-forget), so its event row is
    // written before the response — same reason the email is.
    if (reservation.guestPhone) {
      await this.sendInitialWhatsapp(reservation);
    }

    // Fire-and-forget: pushReservation never throws (all failures are caught and logged
    // internally), but it makes a network round-trip to Google with no timeout — awaiting it
    // would needlessly hold the HTTP response open on every reservation create.
    void this.googleCalendarPushService.pushReservation(reservation);

    if (reservation.guestEmail || reservation.guestPhone) {
      void this.guestsService.syncFromReservation(reservation.id, {
        email: reservation.guestEmail,
        name: reservation.guestName,
        phone: reservation.guestPhone,
        guestId: reservation.guestId,
        actor,
      });
    }

    return reservation;
  }

  // Public (not just used internally by create()) so ChannelImportService can send the
  // same confirmation email once a scraped reservation's core fields are all verified,
  // and so resendInitialEmail() below can retry it on demand. Returns whether the email was
  // queued — it goes out after the outbox's 5-minute wait (and can be aborted until then);
  // confirmationEmailSentAt and INITIAL_EMAIL_SENT/FAILED are recorded by EmailSenderService
  // when it actually sends. Fire-and-forget callers (`void this.sendInitialEmail(...)`) simply
  // discard the result.
  async sendInitialEmail(reservation: Reservation): Promise<boolean> {
    const confirmationUrl = `${process.env.GUEST_WEB_ORIGIN}/r/${reservation.confirmationToken}`;

    try {
      await this.emailService.sendInitialConfirmationEmail(
        reservation.guestEmail as string,
        reservation.guestName,
        confirmationUrl,
        reservation.id,
      );
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_QUEUED');
      return true;
    } catch (error) {
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Falló el email de confirmación inicial',
        `Se creó la reserva ${reservation.id} para ${reservation.guestName} pero no se pudo preparar el email de confirmación inicial: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Explicit staff-triggered retry — unlike the automatic send in create()/channel-import,
  // this always attempts the send regardless of whether one was already tried, since a
  // prior failure (e.g. an unverified sender domain) may since have been fixed.
  async resendInitialEmail(id: string): Promise<{ sent: boolean; reservation: Reservation }> {
    const reservation = await this.findOne(id);
    if (!reservation.guestEmail) {
      throw new BadRequestException('This reservation has no guest email to send to');
    }

    const sent = await this.sendInitialEmail(reservation);
    return { sent, reservation: await this.findOne(id) };
  }

  // The same guest link as sendInitialEmail(), over WhatsApp, using the Meta-approved
  // `checkin_link` template (see whatsapp-templates.ts). Public so ChannelImportService can
  // send it for imported reservations and sendInitialWhatsappById() can retry on demand.
  // Never rejects — channel-import calls it fire-and-forget — and returns whether it sent.
  // A failure is recorded as a reservation event, without a staff alert email: WhatsApp is
  // an additional channel, same handling as the daily reminders.
  async sendInitialWhatsapp(reservation: Reservation): Promise<boolean> {
    try {
      const phone = reservation.guestPhone as string;
      if (!normalizePhoneForWhatsapp(phone)) {
        await this.eventsService.record(
          reservation.id,
          'INITIAL_WHATSAPP_FAILED',
          `El teléfono "${phone}" no es un número válido para WhatsApp`,
        );
        // Tracked like any other rejected send, so the admin list flags it too.
        await this.whatsappDeliveryService.recordSend(
          { reservationId: reservation.id, kind: 'CHECKIN_LINK' },
          { accepted: false, errorCode: null, errorMessage: 'Teléfono inválido para WhatsApp' },
        );
        return false;
      }

      const sent = await this.whatsappService.sendTemplate(phone, checkinLinkMessage(reservation), {
        reservationId: reservation.id,
        kind: 'CHECKIN_LINK',
      });
      if (!sent) {
        await this.eventsService.record(
          reservation.id,
          'INITIAL_WHATSAPP_FAILED',
          'Twilio no aceptó el mensaje (ver los logs del API)',
        );
        return false;
      }

      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { confirmationWhatsappSentAt: new Date() },
      });
      await this.eventsService.record(reservation.id, 'INITIAL_WHATSAPP_SENT');
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send the check-in link over WhatsApp for ${reservation.id}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Explicit staff-triggered send/resend — always attempts it, even if one already went out.
  async sendInitialWhatsappById(id: string): Promise<{ sent: boolean; reservation: Reservation }> {
    const reservation = await this.findOne(id);
    if (!reservation.guestPhone) {
      throw new BadRequestException('This reservation has no guest phone to send to');
    }

    const sent = await this.sendInitialWhatsapp(reservation);
    return { sent, reservation: await this.findOne(id) };
  }

  // Each reservation carries `whatsappIssues`: the WhatsApp messages whose latest send was
  // rejected or undelivered and still matter — what the list's warning icon shows.
  async findAll(query: QueryReservationDto) {
    const reservations = await this.prisma.reservation.findMany({
      where: {
        source: query.source,
        ...(query.status?.length ? { status: { in: query.status } } : {}),
      },
      orderBy: { checkIn: 'desc' },
    });

    const latest = await this.whatsappDeliveryService.latestByReservation(reservations.map((r) => r.id));
    const now = new Date();
    return reservations.map((reservation) => ({
      ...reservation,
      whatsappIssues: computeWhatsappIssues(reservation, latest.get(reservation.id) ?? [], now),
    }));
  }

  // The staff detail view: findOne() plus WhatsApp delivery state — the latest send of each
  // message kind, and the subset still worth flagging. Separate from findOne() so the many
  // internal callers keep getting a plain Reservation.
  async findOneWithWhatsappStatus(id: string) {
    const reservation = await this.findOne(id);
    const whatsappMessages = (await this.whatsappDeliveryService.latestByReservation([id])).get(id) ?? [];
    return {
      ...reservation,
      whatsappMessages,
      whatsappIssues: computeWhatsappIssues(reservation, whatsappMessages),
    };
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  async update(id: string, dto: UpdateReservationDto, actor?: string | null) {
    const existing = await this.findOne(id);

    if (dto.checkIn && dto.checkOut) {
      this.validateDates(dto.checkIn, dto.checkOut);
    }

    // "At least one way to reach the guest" is checked on the result of an edit that touches
    // the email or phone (whatever it sets, else what's already stored). An edit that leaves
    // them alone isn't blocked, so a reservation imported without either (Booking.com/Airbnb)
    // can still have its dates or amount corrected.
    const touchesContact = dto.guestEmail !== undefined || dto.guestPhone !== undefined;
    const resultingEmail = dto.guestEmail !== undefined ? dto.guestEmail : existing.guestEmail;
    const resultingPhone = dto.guestPhone !== undefined ? dto.guestPhone : existing.guestPhone;
    if (touchesContact && !resultingEmail && !resultingPhone) {
      throw new BadRequestException(GUEST_CONTACT_REQUIRED_MESSAGE);
    }

    const normalizedExternalReference =
      dto.externalReference !== undefined
        ? dto.externalReference?.trim()
          ? dto.externalReference.trim()
          : null
        : undefined;

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        ...dto,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
        externalReference: normalizedExternalReference,
      },
    });

    // Diff against the exact same normalized values just written, not the raw dto, so a
    // no-op edit (e.g. re-submitting the same externalReference with different whitespace)
    // is never recorded as a change.
    const changes = diffReservationFields(existing, { ...dto, externalReference: normalizedExternalReference });
    for (const change of changes) {
      await this.eventsService.record(
        id,
        'FIELD_CHANGED',
        `${reservationFieldLabel(change.field)}: "${change.oldValue}" → "${change.newValue}"`,
        change.field,
        change.oldValue,
        change.newValue,
        actor,
      );
    }

    // Fire-and-forget: see the comment in create() above.
    void this.googleCalendarPushService.pushReservation(updated);

    if (updated.guestEmail || updated.guestPhone) {
      void this.guestsService.syncFromReservation(updated.id, {
        email: updated.guestEmail,
        name: updated.guestName,
        phone: updated.guestPhone,
        guestId: updated.guestId,
        actor,
      });
    }

    return updated;
  }

  async markPaymentReceived(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.confirmationPaymentReceivedAt) {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { confirmationPaymentReceivedAt: new Date() },
    });
    await this.eventsService.record(id, 'PAYMENT_RECEIVED');
    await this.confirmationService.maybeAutoConfirm(id);
    return updated;
  }

  async markDepositReceived(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.depositReceivedAt) {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { depositReceivedAt: new Date() },
    });
    await this.eventsService.record(id, 'DEPOSIT_RECEIVED');
    await this.confirmationService.maybeAutoConfirm(id);
    return updated;
  }

  async markDepositReturned(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.depositReturnedAt) {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { depositReturnedAt: new Date() },
    });
    await this.eventsService.record(id, 'DEPOSIT_RETURNED');
    return updated;
  }

  async cancel(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.status === 'CANCELLED') {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.eventsService.record(id, 'RESERVATION_CANCELLED');

    // Re-pushes to the shared Google Calendar so the event's title/color reflect the
    // cancellation (pushReservation tags it "[Cancelada]" rather than removing it) — same as
    // any other status update, see update() above.
    void this.googleCalendarPushService.pushReservation(updated);

    if (updated.guestEmail) {
      void this.sendCancellationEmail(updated);
    }

    return updated;
  }

  // Public (not just used internally by cancel()) so resendCancellationEmail() below can
  // retry it on demand. Returns whether it was queued, matching sendInitialEmail()'s and
  // ReservationConfirmationService.sendFinalEmail()'s same contract.
  async sendCancellationEmail(reservation: Reservation): Promise<boolean> {
    try {
      await this.emailService.sendCancellationEmail(
        reservation.guestEmail as string,
        reservation.guestName,
        reservation.checkIn,
        reservation.checkOut,
        reservation.id,
      );
      await this.eventsService.record(reservation.id, 'CANCELLATION_EMAIL_QUEUED');
      return true;
    } catch (error) {
      await this.eventsService.record(reservation.id, 'CANCELLATION_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Falló el email de cancelación',
        `Se canceló la reserva ${reservation.id} para ${reservation.guestName} pero no se pudo preparar el email de cancelación: ${(error as Error).message}`,
      );
      return false;
    }
  }

  // Explicit staff-triggered retry — always attempts the send regardless of whether one was
  // already tried, same as resendInitialEmail()/resendFinalEmail(). Only allowed once the
  // reservation is actually CANCELLED, since the email says the stay was cancelled.
  async resendCancellationEmail(id: string): Promise<{ sent: boolean; reservation: Reservation }> {
    const reservation = await this.findOne(id);
    if (!reservation.guestEmail) {
      throw new BadRequestException('This reservation has no guest email to send to');
    }
    if (reservation.status !== 'CANCELLED') {
      throw new BadRequestException('This reservation is not cancelled');
    }

    const sent = await this.sendCancellationEmail(reservation);
    return { sent, reservation: await this.findOne(id) };
  }

  listEvents(id: string) {
    return this.eventsService.listForReservation(id);
  }

  checkOverlap(checkIn: string, checkOut: string, excludeId?: string) {
    return this.prisma.reservation.findMany({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        status: { not: 'CANCELLED' },
        checkIn: { lt: new Date(checkOut) },
        checkOut: { gt: new Date(checkIn) },
      },
    });
  }
}
