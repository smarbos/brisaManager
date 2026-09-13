import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
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
      },
    });

    if (reservation.guestEmail) {
      await this.sendInitialEmail(reservation);
    }

    return reservation;
  }

  private async sendInitialEmail(reservation: Reservation): Promise<void> {
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
    } catch (error) {
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Initial confirmation email failed',
        `Reservation ${reservation.id} for ${reservation.guestName} was created but the initial email failed to send: ${(error as Error).message}`,
      );
    }
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

    return this.prisma.reservation.update({
      where: { id },
      data: {
        ...dto,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
      },
    });
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

  listEvents(id: string) {
    return this.eventsService.listForReservation(id);
  }
}
