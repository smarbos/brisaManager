import { Injectable } from '@nestjs/common';
import { GuestEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GuestEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(guestId: string, type: GuestEventType, detail?: string) {
    return this.prisma.guestEvent.create({
      data: { guestId, type, detail },
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
