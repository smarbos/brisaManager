import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignFilterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuestEventsService } from '../guest-events/guest-events.service';

interface SyncInput {
  email?: string | null;
  name: string;
  phone?: string | null;
}

interface GuestSnapshot {
  name: string;
  phone: string | null;
  email: string | null;
}

function formatPreviousValue(value: string | null): string {
  return value === null ? '(vacío)' : `"${value}"`;
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestEventsService: GuestEventsService,
  ) {}

  async syncFromReservation(reservationId: string, input: SyncInput): Promise<void> {
    try {
      const email = input.email?.trim().toLowerCase() || null;
      const phone = input.phone?.trim() || null;
      const name = input.name.trim();
      if (!email && !phone) {
        return;
      }

      // Airbnb's hosting messages page never exposes the guest's email, only their phone —
      // key the upsert on whichever identifier is actually present.
      const existing = email
        ? await this.prisma.guest.findUnique({ where: { email } })
        : await this.prisma.guest.findUnique({ where: { phone: phone as string } });

      const guest = email
        ? await this.prisma.guest.upsert({
            where: { email },
            create: { email, name, phone: phone ?? undefined },
            update: { name, phone: phone ?? undefined },
          })
        : await this.prisma.guest.upsert({
            where: { phone: phone as string },
            create: { phone: phone as string, name },
            update: { name },
          });

      if (existing) {
        await this.recordFieldChanges(guest.id, existing, { name, phone, email });
      }

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

  // Only compares/records a field as changed when this sync's input actually supplies a
  // value for it — when phone/email is omitted this time, Prisma's `?? undefined` in the
  // upsert above leaves the stored value untouched, so there is nothing to diff for it.
  // `name` is always present (required on SyncInput), so it's always compared.
  private async recordFieldChanges(
    guestId: string,
    existing: GuestSnapshot,
    next: { name: string; phone: string | null; email: string | null },
  ): Promise<void> {
    if (existing.name !== next.name) {
      await this.guestEventsService.record(
        guestId,
        'NAME_CHANGED',
        `Nombre: "${existing.name}" → "${next.name}"`,
      );
    }
    if (next.phone !== null && existing.phone !== next.phone) {
      await this.guestEventsService.record(
        guestId,
        'PHONE_CHANGED',
        `Teléfono: ${formatPreviousValue(existing.phone)} → "${next.phone}"`,
      );
    }
    if (next.email !== null && existing.email !== next.email) {
      await this.guestEventsService.record(
        guestId,
        'EMAIL_CHANGED',
        `Email: ${formatPreviousValue(existing.email)} → "${next.email}"`,
      );
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
    // A findFirst-then-update (rather than the previous anonymous updateMany) is what gives
    // us a guest id to attach the GuestEvent to — the "never leak whether a token is valid"
    // behavior is unchanged: an unknown token still silently no-ops with no error either way.
    const guest = await this.prisma.guest.findFirst({ where: { unsubscribeToken: token } });
    if (!guest) {
      return;
    }
    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { unsubscribedAt: new Date() },
    });
    await this.guestEventsService.record(guest.id, 'UNSUBSCRIBED');
  }
}
