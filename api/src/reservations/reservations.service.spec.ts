import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let prisma: {
    reservation: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      reservation: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ReservationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ReservationsService);
  });

  const validDto = {
    guestName: 'Jane Doe',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'DIRECT' as const,
    totalAmount: 100000,
    currency: 'ARS',
  };

  it('rejects a reservation where checkOut is not after checkIn', async () => {
    await expect(
      service.create({ ...validDto, checkIn: '2026-01-15', checkOut: '2026-01-10' }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('creates a reservation with valid dates', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto });

    const result = await service.create(validDto);

    expect(result).toEqual({ id: '1', ...validDto });
    expect(prisma.reservation.create).toHaveBeenCalled();
  });

  it('throws NotFoundException when updating a reservation that does not exist', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.update('missing-id', { guestName: 'New Name' })).rejects.toThrow(NotFoundException);
  });
});
