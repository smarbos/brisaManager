import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicReservationsService } from './public-reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';

describe('PublicReservationsService', () => {
  let service: PublicReservationsService;
  let prisma: { reservation: { findUnique: jest.Mock; update: jest.Mock } };
  let settingsService: { get: jest.Mock };
  let eventsService: { record: jest.Mock };
  let confirmationService: { maybeAutoConfirm: jest.Mock };

  const baseReservation = {
    id: 'res-1',
    confirmationToken: 'tok-1',
    guestName: 'Jane Doe',
    checkIn: new Date('2026-03-01'),
    checkOut: new Date('2026-03-05'),
    paxCount: 2,
    totalAmount: 100000,
    currency: 'ARS',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
  };

  beforeEach(async () => {
    prisma = { reservation: { findUnique: jest.fn(), update: jest.fn() } };
    settingsService = {
      get: jest.fn().mockResolvedValue({
        houseRulesText: 'No parties.',
        paymentInstructions: 'Bank X.',
      }),
    };
    eventsService = { record: jest.fn() };
    confirmationService = { maybeAutoConfirm: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: ReservationEventsService, useValue: eventsService },
        {
          provide: ReservationConfirmationService,
          useValue: confirmationService,
        },
      ],
    }).compile();

    service = moduleRef.get(PublicReservationsService);
  });

  it('throws NotFoundException for an unknown token', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.getByToken('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns reservation details plus house rules and payment instructions', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });

    const result = await service.getByToken('tok-1');

    expect(result.guestName).toBe('Jane Doe');
    expect(result.houseRulesText).toBe('No parties.');
    expect(result.paymentInstructions).toBe('Bank X.');
  });

  it('confirms dates, records an event, and checks auto-confirmation', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
    });

    await service.confirmDates('tok-1');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { datesConfirmedAt: expect.any(Date) },
    });
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'DATES_CONFIRMED',
    );
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });

  it('accepts the contract, snapshotting the current house rules text', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      contractAcceptedAt: new Date(),
    });

    await service.acceptContract('tok-1', 'Jane Doe');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        contractAcceptedAt: expect.any(Date),
        contractAcceptedName: 'Jane Doe',
        contractSnapshot: 'No parties.',
      },
    });
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'CONTRACT_ACCEPTED',
    );
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });
});
