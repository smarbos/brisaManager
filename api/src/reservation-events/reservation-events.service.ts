import { Injectable } from '@nestjs/common';
import { ReservationEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReservationEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    reservationId: string,
    type: ReservationEventType,
    detail?: string,
    field?: string,
    oldValue?: string | null,
    newValue?: string | null,
    actor?: string | null,
  ) {
    return this.prisma.reservationEvent.create({
      data: { reservationId, type, detail, field, oldValue, newValue, actor },
    });
  }

  listForReservation(reservationId: string) {
    return this.prisma.reservationEvent.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll() {
    return this.prisma.reservationEvent.findMany({
      orderBy: { createdAt: 'desc' },
      include: { reservation: { select: { guestName: true, source: true } } },
    });
  }
}
