import { Test } from '@nestjs/testing';
import { ReservationEventsService } from './reservation-events.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationEventsService', () => {
  let service: ReservationEventsService;
  let prisma: {
    reservationEvent: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = { reservationEvent: { create: jest.fn(), findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [ReservationEventsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ReservationEventsService);
  });

  it('records an event', async () => {
    prisma.reservationEvent.create.mockResolvedValue({ id: '1' });

    await service.record('res-1', 'DATES_CONFIRMED');

    expect(prisma.reservationEvent.create).toHaveBeenCalledWith({
      data: { reservationId: 'res-1', type: 'DATES_CONFIRMED', detail: undefined },
    });
  });

  it('records an event with a detail message', async () => {
    prisma.reservationEvent.create.mockResolvedValue({ id: '1' });

    await service.record('res-1', 'FINAL_EMAIL_FAILED', 'Resend timeout');

    expect(prisma.reservationEvent.create).toHaveBeenCalledWith({
      data: { reservationId: 'res-1', type: 'FINAL_EMAIL_FAILED', detail: 'Resend timeout' },
    });
  });

  it('lists events for a reservation ordered most-recent-first', async () => {
    prisma.reservationEvent.findMany.mockResolvedValue([]);

    await service.listForReservation('res-1');

    expect(prisma.reservationEvent.findMany).toHaveBeenCalledWith({
      where: { reservationId: 'res-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('lists every event across all reservations, most-recent-first, with the reservation it belongs to', async () => {
    prisma.reservationEvent.findMany.mockResolvedValue([]);

    await service.listAll();

    expect(prisma.reservationEvent.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { reservation: { select: { guestName: true, source: true } } },
    });
  });
});
