import { Injectable, Logger } from '@nestjs/common';
import { CampaignFilterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface SyncInput {
  email: string;
  name: string;
  phone?: string | null;
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncFromReservation(reservationId: string, input: SyncInput): Promise<void> {
    try {
      const email = input.email.trim().toLowerCase();
      if (!email) {
        return;
      }

      const guest = await this.prisma.guest.upsert({
        where: { email },
        create: { email, name: input.name, phone: input.phone ?? undefined },
        update: { name: input.name, phone: input.phone ?? undefined },
      });

      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { guestId: guest.id },
      });

      const stats = await this.prisma.reservation.aggregate({
        where: { guestId: guest.id },
        _count: { _all: true },
        _max: { checkOut: true },
      });

      await this.prisma.guest.update({
        where: { id: guest.id },
        data: { totalStays: stats._count._all, lastStayAt: stats._max.checkOut },
      });
    } catch (error) {
      this.logger.error(`Guest sync failed for reservation ${reservationId}: ${(error as Error).message}`);
    }
  }

  findAll() {
    return this.prisma.guest.findMany({ orderBy: { lastStayAt: 'desc' } });
  }

  findEligibleForCampaign(filterType: CampaignFilterType, filterMonths?: number) {
    const where: Prisma.GuestWhereInput = { unsubscribedAt: null };

    if (filterType === 'STAYED_WITHIN_MONTHS') {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - (filterMonths as number));
      where.lastStayAt = { gte: cutoff };
    } else if (filterType === 'NOT_STAYED_WITHIN_MONTHS') {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - (filterMonths as number));
      where.OR = [{ lastStayAt: { lt: cutoff } }, { lastStayAt: null }];
    }

    return this.prisma.guest.findMany({ where });
  }

  async unsubscribeByToken(token: string): Promise<void> {
    // updateMany silently matches zero rows for an unknown token — intentional: the public
    // endpoint must never leak whether a given token is valid.
    await this.prisma.guest.updateMany({
      where: { unsubscribeToken: token },
      data: { unsubscribedAt: new Date() },
    });
  }
}
