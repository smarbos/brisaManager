import { Injectable } from '@nestjs/common';
import { ReservationEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReservationEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(reservationId: string, type: ReservationEventType, detail?: string) {
    return this.prisma.reservationEvent.create({
      data: { reservationId, type, detail },
    });
  }

  listForReservation(reservationId: string) {
    return this.prisma.reservationEvent.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
