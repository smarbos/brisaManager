import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface CreateNotificationInput {
  type: NotificationType;
  message: string;
  reservationId?: string;
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        type: input.type,
        message: input.message,
        reservationId: input.reservationId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  }

  // Used before creating a CALENDAR_MISMATCH notification so a sync run every 30 minutes
  // doesn't pile up duplicates for a gap staff hasn't dealt with yet — see the schema
  // comment on Notification.dedupeKey for why this only checks *unread* ones.
  async hasOpen(dedupeKey: string): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({
      where: { dedupeKey, readAt: null },
      select: { id: true },
    });
    return existing !== null;
  }

  listAll() {
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      include: { reservation: { select: { id: true, guestName: true } } },
    });
  }

  unreadCount() {
    return this.prisma.notification.count({ where: { readAt: null } });
  }

  markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
