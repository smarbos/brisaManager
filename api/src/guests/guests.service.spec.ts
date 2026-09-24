import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GuestsService } from './guests.service';
import { PrismaService } from '../prisma/prisma.service';
import { GuestEventsService } from '../guest-events/guest-events.service';

describe('GuestsService', () => {
  let service: GuestsService;
  let prisma: {
    guest: {
      upsert: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    reservation: { update: jest.Mock; aggregate: jest.Mock };
  };
  let guestEventsService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      guest: {
        upsert: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      reservation: { update: jest.fn(), aggregate: jest.fn() },
    };
    guestEventsService = { record: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GuestEventsService, useValue: guestEventsService },
      ],
    }).compile();

    service = moduleRef.get(GuestsService);
  });

  describe('syncFromReservation', () => {
    it('upserts a Guest by lowercased email, links the reservation, and recomputes stats', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1', email: 'jane@example.com' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 3 }, _max: { checkOut: new Date('2026-05-01') } });

      await service.syncFromReservation('res-1', { email: 'Jane@Example.com', name: 'Jane Doe', phone: '+54911' });

      expect(prisma.guest.findUnique).toHaveBeenCalledWith({ where: { email: 'jane@example.com' } });
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
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('does nothing when neither email nor phone is present', async () => {
      await service.syncFromReservation('res-1', { email: '', name: 'Jane Doe' });

      expect(prisma.guest.upsert).not.toHaveBeenCalled();
    });

    it('does nothing when email and phone are whitespace only', async () => {
      await service.syncFromReservation('res-1', { email: '   ', name: 'Jane Doe', phone: '   ' });

      expect(prisma.guest.upsert).not.toHaveBeenCalled();
    });

    it('upserts a Guest by phone when there is no email, keyed on phone', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-2', phone: '+591 75278095' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: new Date('2026-11-08') } });

      await service.syncFromReservation('res-2', { email: null, name: 'María Laura', phone: '+591 75278095' });

      expect(prisma.guest.findUnique).toHaveBeenCalledWith({ where: { phone: '+591 75278095' } });
      expect(prisma.guest.upsert).toHaveBeenCalledWith({
        where: { phone: '+591 75278095' },
        create: { phone: '+591 75278095', name: 'María Laura' },
        update: { name: 'María Laura' },
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-2' },
        data: { guestId: 'guest-2' },
      });
    });

    it('never throws when a database call fails', async () => {
      prisma.guest.upsert.mockRejectedValue(new Error('db down'));

      await expect(
        service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe' }),
      ).resolves.toBeUndefined();
    });

    it('records NAME_CHANGED when an existing guest is re-synced with a different name', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane', phone: '+54911', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+54911' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'guest-1',
        'NAME_CHANGED',
        'Nombre: "Jane" → "Jane Doe"',
      );
    });

    it('records PHONE_CHANGED when an existing guest is re-synced with a different phone', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+5491100000000', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+5492200000000' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'guest-1',
        'PHONE_CHANGED',
        'Teléfono: "+5491100000000" → "+5492200000000"',
      );
    });

    it('records PHONE_CHANGED with "(vacío)" for the previous value when the guest had no phone on file', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: null, email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+5492200000000' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'guest-1',
        'PHONE_CHANGED',
        'Teléfono: (vacío) → "+5492200000000"',
      );
    });

    it('does not record PHONE_CHANGED when this sync has no phone at all, even if the guest previously had one', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+5491100000000', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('records nothing when nothing actually changed', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+54911', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+54911' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('trims the input name before comparing and storing, so incidental whitespace is not logged as a change', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+54911', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: '  Jane Doe  ', phone: '+54911' });

      expect(prisma.guest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ name: 'Jane Doe' }) }),
      );
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('records no event for a brand-new guest, since there is nothing to diff against', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-new' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'new@example.com', name: 'New Guest' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the guest with their reservation history', async () => {
      const guest = { id: 'guest-1', email: 'jane@example.com', reservations: [{ id: 'res-1' }] };
      prisma.guest.findUnique.mockResolvedValue(guest);

      const result = await service.findOne('guest-1');

      expect(prisma.guest.findUnique).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        include: { reservations: { orderBy: { checkIn: 'desc' } } },
      });
      expect(result).toBe(guest);
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findEligibleForCampaign', () => {
    it('excludes unsubscribed guests for the ALL filter', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('ALL');

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: { unsubscribedAt: null, email: { not: null } },
      });
    });

    it('filters to guests who stayed within N months', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: { unsubscribedAt: null, email: { not: null }, lastStayAt: { gte: expect.any(Date) } },
      });
    });

    it('filters to guests who have not stayed within N months', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('NOT_STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: {
          unsubscribedAt: null,
          email: { not: null },
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
