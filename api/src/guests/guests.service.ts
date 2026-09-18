import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignFilterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface SyncInput {
  email?: string | null;
  name: string;
  phone?: string | null;
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncFromReservation(reservationId: string, input: SyncInput): Promise<void> {
    try {
      const email = input.email?.trim().toLowerCase() || null;
      const phone = input.phone?.trim() || null;
      if (!email && !phone) {
        return;
      }

      // Airbnb's hosting messages page never exposes the guest's email, only their phone —
      // key the upsert on whichever identifier is actually present.
      const guest = email
        ? await this.prisma.guest.upsert({
            where: { email },
            create: { email, name: input.name, phone: phone ?? undefined },
            update: { name: input.name, phone: phone ?? undefined },
          })
        : await this.prisma.guest.upsert({
            where: { phone: phone as string },
            create: { phone: phone as string, name: input.name },
            update: { name: input.name },
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

  async findOne(id: string) {
    const guest = await this.prisma.guest.findUnique({
      where: { id },
      include: { reservations: { orderBy: { checkIn: 'desc' } } },
    });
    if (!guest) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    return guest;
  }

  findEligibleForCampaign(filterType: CampaignFilterType, filterMonths?: number) {
    // Campaigns are email-only — phone-only guests (e.g. Airbnb imports with no scraped
    // email) have nothing to send to.
    const where: Prisma.GuestWhereInput = { unsubscribedAt: null, email: { not: null } };

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
