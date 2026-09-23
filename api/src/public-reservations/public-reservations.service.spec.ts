import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicReservationsService } from './public-reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { GuestsService } from '../guests/guests.service';
import { ReservationImagesService } from '../reservation-images/reservation-images.service';

describe('PublicReservationsService', () => {
  let service: PublicReservationsService;
  let prisma: { reservation: { findUnique: jest.Mock; update: jest.Mock } };
  let settingsService: { get: jest.Mock };
  let eventsService: { record: jest.Mock };
  let confirmationService: { maybeAutoConfirm: jest.Mock };
  let guestsService: { syncFromReservation: jest.Mock };
  let reservationImagesService: { upload: jest.Mock; listForReservation: jest.Mock; getOne: jest.Mock; readFile: jest.Mock };

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
        confirmationPaymentValue: '30%',
        securityDepositValue: '15%',
      }),
    };
    eventsService = { record: jest.fn() };
    confirmationService = { maybeAutoConfirm: jest.fn() };
    guestsService = { syncFromReservation: jest.fn() };
    reservationImagesService = {
      upload: jest.fn(),
      listForReservation: jest.fn(),
      getOne: jest.fn(),
      readFile: jest.fn(),
    };

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
        { provide: GuestsService, useValue: guestsService },
        { provide: ReservationImagesService, useValue: reservationImagesService },
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

  it('computes confirmationPaymentAmount as 30% of totalAmount', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(30000);
  });

  it('rounds confirmationPaymentAmount to 2 decimal places for a non-round total', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 123456.78,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(37037.03);
  });

  it('computes confirmationPaymentAmount using the configured percentage, not a hardcoded 30%', async () => {
    settingsService.get.mockResolvedValue({
      houseRulesText: 'No parties.',
      paymentInstructions: 'Bank X.',
      confirmationPaymentValue: '20%',
      securityDepositValue: '15%',
    });
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(20000);
  });

  it('resolves confirmationPaymentAmount as a fixed amount when configured as one', async () => {
    settingsService.get.mockResolvedValue({
      houseRulesText: 'No parties.',
      paymentInstructions: 'Bank X.',
      confirmationPaymentValue: '45000',
      securityDepositValue: '15%',
    });
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.confirmationPaymentAmount).toBe(45000);
    expect(result.confirmationPaymentPercentage).toBeNull();
  });

  it('resolves securityDepositAmount as a fixed amount when configured as one', async () => {
    settingsService.get.mockResolvedValue({
      houseRulesText: 'No parties.',
      paymentInstructions: 'Bank X.',
      confirmationPaymentValue: '30%',
      securityDepositValue: '150000',
    });
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.securityDepositAmount).toBe(150000);
  });

  it('computes securityDepositAmount as the configured percentage of totalAmount', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      totalAmount: 100000,
    });

    const result = await service.getByToken('tok-1');

    expect(result.securityDepositAmount).toBe(15000);
  });

  it('confirms dates, saves the guest-provided name/phone/email, records an event, and checks auto-confirmation', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      guestName: 'Jane Doe',
      guestPhone: '+54 9 223 555-1234',
      guestEmail: 'jane@example.com',
    });

    await service.confirmDates('tok-1', 'Jane Doe', '+54 9 223 555-1234', 'Jane@Example.com');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        datesConfirmedAt: expect.any(Date),
        guestName: 'Jane Doe',
        guestPhone: '+54 9 223 555-1234',
        // Normalized to lowercase, same as every other place this app stores a guest email.
        guestEmail: 'jane@example.com',
      },
    });
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'DATES_CONFIRMED',
    );
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });

  it('does not re-update or re-record an event when dates are already confirmed', async () => {
    const alreadyConfirmedAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: alreadyConfirmedAt,
    });

    const result = await service.confirmDates('tok-1', 'A Different Name', '+54911', 'a@example.com');

    expect(result).toEqual({ datesConfirmedAt: alreadyConfirmedAt });
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    expect(confirmationService.maybeAutoConfirm).not.toHaveBeenCalled();
  });

  it('syncs the guest with the self-provided name, phone, and email when dates are confirmed', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      guestEmail: 'jane@example.com',
      guestPhone: '+54911',
    });

    await service.confirmDates('tok-1', 'Jane Q. Doe', '+54911', 'jane@example.com');

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('res-1', {
      email: 'jane@example.com',
      name: 'Jane Q. Doe',
      phone: '+54911',
    });
  });

  it('does not sync a guest when dates were already confirmed', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date('2026-01-01'),
      guestEmail: 'jane@example.com',
    });

    await service.confirmDates('tok-1', 'A Different Name', '+54911', 'a@example.com');

    expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
  });

  it('accepts the contract, snapshotting the house rules and using the already-confirmed guest name', async () => {
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      guestName: 'Jane Doe',
      datesConfirmedAt: new Date('2026-01-01'),
    });
    prisma.reservation.update.mockResolvedValue({
      ...baseReservation,
      contractAcceptedAt: new Date(),
      contractAcceptedName: 'Jane Doe',
    });

    await service.acceptContract('tok-1');

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

  it('does not re-update or re-record an event when the contract is already accepted', async () => {
    const alreadyAcceptedAt = new Date('2026-01-01T00:00:00.000Z');
    prisma.reservation.findUnique.mockResolvedValue({
      ...baseReservation,
      contractAcceptedAt: alreadyAcceptedAt,
      contractAcceptedName: 'Original Name',
    });

    const result = await service.acceptContract('tok-1');

    expect(result).toEqual({ contractAcceptedAt: alreadyAcceptedAt });
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    expect(confirmationService.maybeAutoConfirm).not.toHaveBeenCalled();
  });

  describe('uploadImage', () => {
    it('resolves the token to a reservation id before delegating to ReservationImagesService', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      const file = { buffer: Buffer.from('x'), originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1 } as Express.Multer.File;
      reservationImagesService.upload.mockResolvedValue({ id: 'img-1' });

      const result = await service.uploadImage('tok-1', file);

      expect(reservationImagesService.upload).toHaveBeenCalledWith('res-1', file);
      expect(result).toEqual({ id: 'img-1' });
    });

    it('throws NotFoundException for an unknown token, never reaching ReservationImagesService', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);
      const file = { buffer: Buffer.from('x'), originalname: 'a.jpg', mimetype: 'image/jpeg', size: 1 } as Express.Multer.File;

      await expect(service.uploadImage('missing', file)).rejects.toBeInstanceOf(NotFoundException);
      expect(reservationImagesService.upload).not.toHaveBeenCalled();
    });
  });

  describe('listImages', () => {
    it('resolves the token to a reservation id before listing', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      reservationImagesService.listForReservation.mockResolvedValue([{ id: 'img-1' }]);

      const result = await service.listImages('tok-1');

      expect(reservationImagesService.listForReservation).toHaveBeenCalledWith('res-1');
      expect(result).toEqual([{ id: 'img-1' }]);
    });
  });

  describe('getImageFile', () => {
    it('resolves the token, then the image scoped to that reservation, then reads the file', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
      const image = { id: 'img-1', mimeType: 'image/jpeg', filename: 'x.jpg' };
      reservationImagesService.getOne.mockResolvedValue(image);
      reservationImagesService.readFile.mockResolvedValue(Buffer.from('bytes'));

      const result = await service.getImageFile('tok-1', 'img-1');

      expect(reservationImagesService.getOne).toHaveBeenCalledWith('res-1', 'img-1');
      expect(reservationImagesService.readFile).toHaveBeenCalledWith(image);
      expect(result).toEqual({ image, buffer: Buffer.from('bytes') });
    });
  });
});
