import { Test } from '@nestjs/testing';
import { GuestEventsService } from './guest-events.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GuestEventsService', () => {
  let service: GuestEventsService;
  let prisma: {
    guestEvent: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = { guestEvent: { create: jest.fn(), findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [GuestEventsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(GuestEventsService);
  });

  it('records an event', async () => {
    prisma.guestEvent.create.mockResolvedValue({ id: '1' });

    await service.record('guest-1', 'UNSUBSCRIBED');

    expect(prisma.guestEvent.create).toHaveBeenCalledWith({
      data: { guestId: 'guest-1', type: 'UNSUBSCRIBED', detail: undefined },
    });
  });

  it('records an event with a detail message', async () => {
    prisma.guestEvent.create.mockResolvedValue({ id: '1' });

    await service.record('guest-1', 'NAME_CHANGED', 'Nombre: "Jane" → "Jane Doe"');

    expect(prisma.guestEvent.create).toHaveBeenCalledWith({
      data: { guestId: 'guest-1', type: 'NAME_CHANGED', detail: 'Nombre: "Jane" → "Jane Doe"' },
    });
  });

  it('lists events for a guest ordered most-recent-first', async () => {
    prisma.guestEvent.findMany.mockResolvedValue([]);

    await service.listForGuest('guest-1');

    expect(prisma.guestEvent.findMany).toHaveBeenCalledWith({
      where: { guestId: 'guest-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('lists every event across all guests, most-recent-first, with the guest it belongs to', async () => {
    prisma.guestEvent.findMany.mockResolvedValue([]);

    await service.listAll();

    expect(prisma.guestEvent.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { guest: { select: { name: true, email: true } } },
    });
  });
});
