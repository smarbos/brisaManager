import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe('create', () => {
    it('creates a notification with all fields', async () => {
      await service.create({
        type: 'CALENDAR_MISMATCH',
        message: 'Booking.com muestra un día bloqueado sin reserva cargada.',
        reservationId: 'res-1',
        dedupeKey: 'calendar-mismatch:BOOKING:2026-11-06',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          type: 'CALENDAR_MISMATCH',
          message: 'Booking.com muestra un día bloqueado sin reserva cargada.',
          reservationId: 'res-1',
          dedupeKey: 'calendar-mismatch:BOOKING:2026-11-06',
        },
      });
    });

    it('defaults reservationId and dedupeKey to null when omitted', async () => {
      await service.create({
        type: 'PAYMENT_RECEIPT_UPLOADED',
        message: 'Nuevo comprobante subido.',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          type: 'PAYMENT_RECEIPT_UPLOADED',
          message: 'Nuevo comprobante subido.',
          reservationId: null,
          dedupeKey: null,
        },
      });
    });
  });

  describe('hasOpen', () => {
    it('returns true when an unread notification with that dedupeKey exists', async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: 'n-1' });

      const result = await service.hasOpen(
        'calendar-mismatch:BOOKING:2026-11-06',
      );

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'calendar-mismatch:BOOKING:2026-11-06',
          readAt: null,
        },
        select: { id: true },
      });
      expect(result).toBe(true);
    });

    it('returns false when no unread notification with that dedupeKey exists', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      const result = await service.hasOpen(
        'calendar-mismatch:BOOKING:2026-11-06',
      );

      expect(result).toBe(false);
    });
  });

  describe('unreadCount', () => {
    it('counts only unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.unreadCount();

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { readAt: null },
      });
      expect(result).toBe(3);
    });
  });

  describe('markRead', () => {
    it('sets readAt to now', async () => {
      await service.markRead('n-1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n-1' },
        data: { readAt: expect.any(Date) },
      });
    });
  });
});
