import { Test } from '@nestjs/testing';
import { GuestsService } from './guests.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GuestsService', () => {
  let service: GuestsService;
  let prisma: {
    guest: { upsert: jest.Mock; update: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    reservation: { update: jest.Mock; aggregate: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      guest: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      reservation: { update: jest.fn(), aggregate: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [GuestsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(GuestsService);
  });

  describe('syncFromReservation', () => {
    it('upserts a Guest by lowercased email, links the reservation, and recomputes stats', async () => {
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1', email: 'jane@example.com' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 3 }, _max: { checkOut: new Date('2026-05-01') } });

      await service.syncFromReservation('res-1', { email: 'Jane@Example.com', name: 'Jane Doe', phone: '+54911' });

      expect(prisma.guest.upsert).toHaveBeenCalledWith({
        where: { email: 'jane@example.com' },
        create: { email: 'jane@example.com', name: 'Jane Doe', phone: '+54911' },
        update: { name: 'Jane Doe', phone: '+54911' },
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { guestId: 'guest-1' },
      });
      expect(prisma.guest.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: { totalStays: 3, lastStayAt: new Date('2026-05-01') },
      });
    });

    it('does nothing when the email is empty', async () => {
      await service.syncFromReservation('res-1', { email: '', name: 'Jane Doe' });

      expect(prisma.guest.upsert).not.toHaveBeenCalled();
    });

    it('does nothing when the email is whitespace only', async () => {
      await service.syncFromReservation('res-1', { email: '   ', name: 'Jane Doe' });

      expect(prisma.guest.upsert).not.toHaveBeenCalled();
    });

    it('never throws when a database call fails', async () => {
      prisma.guest.upsert.mockRejectedValue(new Error('db down'));

      await expect(
        service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findEligibleForCampaign', () => {
    it('excludes unsubscribed guests for the ALL filter', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('ALL');

      expect(prisma.guest.findMany).toHaveBeenCalledWith({ where: { unsubscribedAt: null } });
    });

    it('filters to guests who stayed within N months', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: { unsubscribedAt: null, lastStayAt: { gte: expect.any(Date) } },
      });
    });

    it('filters to guests who have not stayed within N months', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('NOT_STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: {
          unsubscribedAt: null,
          OR: [{ lastStayAt: { lt: expect.any(Date) } }, { lastStayAt: null }],
        },
      });
    });
  });

  describe('unsubscribeByToken', () => {
    it('sets unsubscribedAt for the matching token', async () => {
      await service.unsubscribeByToken('tok-1');

      expect(prisma.guest.updateMany).toHaveBeenCalledWith({
        where: { unsubscribeToken: 'tok-1' },
        data: { unsubscribedAt: expect.any(Date) },
      });
    });

    it('does not throw for an unknown token', async () => {
      prisma.guest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unsubscribeByToken('unknown')).resolves.toBeUndefined();
    });
  });
});
