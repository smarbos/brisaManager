import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { GuestsService } from '../guests/guests.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';
import { Reservation } from '@prisma/client';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
    private readonly emailService: EmailService,
    private readonly confirmationService: ReservationConfirmationService,
    private readonly googleCalendarPushService: GoogleCalendarPushService,
    private readonly guestsService: GuestsService,
  ) {}

  private validateDates(checkIn: string, checkOut: string) {
    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('checkOut must be after checkIn');
    }
  }

  async create(dto: CreateReservationDto) {
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

    // Fire-and-forget: pushReservation never throws (all failures are caught and logged
    // internally), but it makes a network round-trip to Google with no timeout — awaiting it
    // would needlessly hold the HTTP response open on every reservation create.
    void this.googleCalendarPushService.pushReservation(reservation);

    if (reservation.guestEmail) {
      void this.guestsService.syncFromReservation(reservation.id, {
        email: reservation.guestEmail,
        name: reservation.guestName,
        phone: reservation.guestPhone,
      });
    }

    return reservation;
  }

  // Public (not just used internally by create()) so ChannelImportService can send the
  // same confirmation email once a scraped reservation's core fields are all verified,
  // and so resendInitialEmail() below can retry it on demand. Returns whether it actually
  // sent — existing fire-and-forget callers (`void this.sendInitialEmail(...)`) simply
  // discard that, so this is not a breaking change for them.
  async sendInitialEmail(reservation: Reservation): Promise<boolean> {
    const confirmationUrl = `${process.env.GUEST_WEB_ORIGIN}/r/${reservation.confirmationToken}`;

    try {
      await this.emailService.sendInitialConfirmationEmail(
        reservation.guestEmail as string,
        reservation.guestName,
        confirmationUrl,
      );
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { confirmationEmailSentAt: new Date() },
      });
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_SENT');
      return true;
    } catch (error) {
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Falló el email de confirmación inicial',
        `Se creó la reserva ${reservation.id} para ${reservation.guestName} pero falló el envío del email de confirmación inicial: ${(error as Error).message}`,
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

  async findAll(query: QueryReservationDto) {
    return this.prisma.reservation.findMany({
      where: {
        source: query.source,
        status: query.status,
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }

  async update(id: string, dto: UpdateReservationDto) {
    await this.findOne(id);

    if (dto.checkIn && dto.checkOut) {
      this.validateDates(dto.checkIn, dto.checkOut);
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: {
        ...dto,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
        externalReference:
          dto.externalReference !== undefined
            ? dto.externalReference?.trim()
              ? dto.externalReference.trim()
              : null
            : undefined,
      },
    });

    // Fire-and-forget: see the comment in create() above.
    void this.googleCalendarPushService.pushReservation(updated);

    if (updated.guestEmail) {
      void this.guestsService.syncFromReservation(updated.id, {
        email: updated.guestEmail,
        name: updated.guestName,
        phone: updated.guestPhone,
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

    // Removes the reservation from the shared Google Calendar: pushReservation already
    // treats CANCELLED (and COMPLETED) as inactive and deletes the event instead of
    // upserting it — same as any other status update, see update() above.
    void this.googleCalendarPushService.pushReservation(updated);

    if (updated.guestEmail) {
      void this.sendCancellationEmail(updated);
    }

    return updated;
  }

  // Public (not just used internally by cancel()) so resendCancellationEmail() below can
  // retry it on demand. Returns whether it actually sent, matching sendInitialEmail()'s and
  // ReservationConfirmationService.sendFinalEmail()'s same contract.
  async sendCancellationEmail(reservation: Reservation): Promise<boolean> {
    try {
      await this.emailService.sendCancellationEmail(
        reservation.guestEmail as string,
        reservation.guestName,
        reservation.checkIn,
        reservation.checkOut,
      );
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { cancellationEmailSentAt: new Date() },
      });
      await this.eventsService.record(reservation.id, 'CANCELLATION_EMAIL_SENT');
      return true;
    } catch (error) {
      await this.eventsService.record(reservation.id, 'CANCELLATION_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Falló el email de cancelación',
        `Se canceló la reserva ${reservation.id} para ${reservation.guestName} pero falló el envío del email de cancelación: ${(error as Error).message}`,
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
