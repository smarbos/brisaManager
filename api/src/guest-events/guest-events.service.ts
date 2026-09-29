import { Injectable } from '@nestjs/common';
import { GuestEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GuestEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    guestId: string,
    type: GuestEventType,
    detail?: string,
    field?: string,
    oldValue?: string | null,
    newValue?: string | null,
    actor?: string | null,
  ) {
    return this.prisma.guestEvent.create({
      data: { guestId, type, detail, field, oldValue, newValue, actor },
    });
  }

  listForGuest(guestId: string) {
    return this.prisma.guestEvent.findMany({
      where: { guestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll() {
    return this.prisma.guestEvent.findMany({
      orderBy: { createdAt: 'desc' },
      include: { guest: { select: { name: true, email: true } } },
    });
  }
}
