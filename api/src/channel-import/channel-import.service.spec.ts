import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChannelImportService } from './channel-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { GuestsService } from '../guests/guests.service';
import { ReservationsService } from '../reservations/reservations.service';
import { ImportReservationDto } from './dto/import-reservation.dto';

describe('ChannelImportService', () => {
  let service: ChannelImportService;
  let prisma: { reservation: { create: jest.Mock; findUnique: jest.Mock } };
  let eventsService: { record: jest.Mock };
  let googleCalendarPushService: { pushReservation: jest.Mock };
  let guestsService: { syncFromReservation: jest.Mock };
  let reservationsService: { sendInitialEmail: jest.Mock };
  const originalHotelId = process.env.BOOKING_HOTEL_ID;

  beforeAll(() => {
    process.env.BOOKING_HOTEL_ID = '9586863';
  });

  afterAll(() => {
    process.env.BOOKING_HOTEL_ID = originalHotelId;
  });

  beforeEach(async () => {
    prisma = { reservation: { create: jest.fn(), findUnique: jest.fn() } };
    eventsService = { record: jest.fn() };
    googleCalendarPushService = { pushReservation: jest.fn() };
    guestsService = { syncFromReservation: jest.fn() };
    reservationsService = { sendInitialEmail: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: GoogleCalendarPushService, useValue: googleCalendarPushService },
        { provide: GuestsService, useValue: guestsService },
        { provide: ReservationsService, useValue: reservationsService },
      ],
    }).compile();

    service = moduleRef.get(ChannelImportService);
  });

  const baseDto: ImportReservationDto = {
    source: 'booking.com',
    hotel_id: '9586863',
    res_id: '5000000607',
    guest_name: null,
    guest_email: null,
    check_in: null,
    check_out: null,
    guests: null,
    total_price: null,
    currency: null,
    status: null,
    unverified_fields: ['guest_name', 'check_in', 'check_out', 'guests', 'total_price', 'currency', 'status'],
  };

  it('creates a reservation with placeholder values when every field is unverified/null', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-1', ...data }));

    const { reservation, created } = await service.import(baseDto);

    expect(created).toBe(true);
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestName: 'Huésped de Booking.com (pendiente de completar)',
          paxCount: 1,
          source: 'BOOKING',
          externalReference: 'booking-extranet-5000000607',
          totalAmount: 0,
          currency: 'ARS',
          status: 'PENDING',
        }),
      }),
    );
    expect(reservation.id).toBe('res-1');
    expect(eventsService.record).toHaveBeenCalledWith(
      'res-1',
      'RESERVATION_CREATED',
      expect.stringContaining('5000000607'),
    );
    // Nothing is verified, so nothing gets pushed to the shared calendar.
    expect(googleCalendarPushService.pushReservation).not.toHaveBeenCalled();
  });

  it('uses the real scraped values when present', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-2', ...data }));

    const dto: ImportReservationDto = {
      ...baseDto,
      guest_name: 'Weber Clara',
      check_in: '2026-11-06',
      check_out: '2026-11-08',
      guests: 3,
      total_price: '$ 45.000',
      currency: 'ARS',
      status: 'confirmed',
      unverified_fields: [],
    };

    const { reservation } = await service.import(dto);

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestName: 'Weber Clara',
          checkIn: new Date('2026-11-06'),
          checkOut: new Date('2026-11-08'),
          paxCount: 3,
          totalAmount: 45000,
          currency: 'ARS',
          status: 'CONFIRMED',
        }),
      }),
    );
    // Fully verified, so it's safe to push to the shared calendar.
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(reservation);
  });

  it.each([
    ['cancelled', 'CANCELLED'],
    ['canceled', 'CANCELLED'],
    ['completed', 'COMPLETED'],
    ['some unknown status', 'PENDING'],
  ])('maps status "%s" to %s', async (rawStatus, expectedStatus) => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-3', ...data }));

    await service.import({ ...baseDto, status: rawStatus });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: expectedStatus }) }),
    );
  });

  it('throws when check_out is not after check_in', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(
      service.import({ ...baseDto, check_in: '2026-11-08', check_out: '2026-11-06' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('is a safe no-op when the reservation was already imported (same res_id)', async () => {
    const existing = { id: 'res-existing', guestName: 'Ya corregido a mano' };
    prisma.reservation.findUnique.mockResolvedValue(existing);

    const { reservation, created } = await service.import(baseDto);

    expect(created).toBe(false);
    expect(reservation).toBe(existing);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    expect(googleCalendarPushService.pushReservation).not.toHaveBeenCalled();
  });

  it('rejects a hotel_id other than the configured property', async () => {
    await expect(service.import({ ...baseDto, hotel_id: 'some-other-hotel' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.reservation.findUnique).not.toHaveBeenCalled();
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('syncs the guest record and sends the confirmation email when an email is present, even with other fields unverified', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-4', ...data }));

    const { reservation } = await service.import({
      ...baseDto,
      guest_name: 'Weber Clara',
      guest_email: 'ZNoemi@Guest.Booking.com',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ guestEmail: 'znoemi@guest.booking.com' }) }),
    );
    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('res-4', {
      email: 'znoemi@guest.booking.com',
      name: 'Weber Clara',
      phone: null,
    });
    // The confirmation email invites the guest into the same flow a manual reservation
    // uses, where whatever's still missing gets sorted out — it doesn't wait for the
    // scrape to be fully verified first, unlike the calendar push below.
    expect(reservationsService.sendInitialEmail).toHaveBeenCalledWith(reservation);
    expect(googleCalendarPushService.pushReservation).not.toHaveBeenCalled();
  });

  it('does not sync a guest or send an email when no email was captured', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-5', ...data }));

    await service.import(baseDto);

    expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
    expect(reservationsService.sendInitialEmail).not.toHaveBeenCalled();
  });

  it('sends the initial confirmation email once every core field is verified and an email exists', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-6', ...data }));

    const dto: ImportReservationDto = {
      ...baseDto,
      guest_name: 'Weber Clara',
      guest_email: 'znoemi@guest.booking.com',
      check_in: '2026-11-06',
      check_out: '2026-11-08',
      guests: 3,
      total_price: 'US$145.80',
      currency: 'USD',
      status: 'confirmed',
      unverified_fields: [],
    };

    const { reservation } = await service.import(dto);

    expect(reservationsService.sendInitialEmail).toHaveBeenCalledWith(reservation);
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(reservation);
  });

  it('forces status to PENDING when sending the confirmation email, even if a different status was scraped', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-7', ...data }));

    await service.import({
      ...baseDto,
      guest_email: 'znoemi@guest.booking.com',
      status: 'confirmed',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });

  it('does not send the confirmation email when every field is verified but there is no email', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-8', ...data }));

    await service.import({
      ...baseDto,
      guest_name: 'Weber Clara',
      check_in: '2026-11-06',
      check_out: '2026-11-08',
      guests: 3,
      total_price: 'US$145.80',
      currency: 'USD',
      status: 'confirmed',
      unverified_fields: [],
    });

    expect(reservationsService.sendInitialEmail).not.toHaveBeenCalled();
    // Nothing guest-facing to send, but the calendar push doesn't depend on having an
    // email at all — it still goes through.
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalled();
  });

  it('pushes to the calendar when dates are verified even though status never is (the realistic Booking.com case)', async () => {
    // Regression test: `status` can never be scraped from Booking.com's page, so it was
    // always in unverified_fields — a calendar-push gate requiring the *entire* list to
    // be empty was therefore permanently unreachable for every real import, no matter how
    // accurate the dates were. The gate now checks only check_in/check_out.
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-9', ...data }));

    const { reservation } = await service.import({
      ...baseDto,
      guest_name: 'Weber Clara',
      check_in: '2026-11-06',
      check_out: '2026-11-08',
      guests: 3,
      total_price: 'US$145.80',
      currency: 'USD',
      unverified_fields: ['status'],
    });

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(reservation);
  });

  it('creates an AIRBNB reservation without a hotel_id, using the thread id as the external reference', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-airbnb-1', ...data }));

    const { reservation, created } = await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000484',
      guest_name: 'María Laura',
      guests: 3,
    });

    expect(created).toBe(true);
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestName: 'María Laura',
          source: 'AIRBNB',
          externalReference: 'airbnb-thread-1000000484',
          paxCount: 3,
        }),
      }),
    );
    expect(reservation.id).toBe('res-airbnb-1');
  });

  it('falls back to an Airbnb-specific placeholder guest name when none was scraped', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-airbnb-2', ...data }));

    await service.import({ ...baseDto, source: 'airbnb', hotel_id: undefined, res_id: '1000000088' });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guestName: 'Huésped de Airbnb (pendiente de completar)' }),
      }),
    );
  });

  it('does not push to the calendar when check_in or check_out is unverified, regardless of other fields', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) => Promise.resolve({ id: 'res-10', ...data }));

    await service.import({
      ...baseDto,
      guest_name: 'Weber Clara',
      check_in: '2026-11-06',
      check_out: '2026-11-08',
      guests: 3,
      total_price: 'US$145.80',
      currency: 'USD',
      unverified_fields: ['check_out', 'status'],
    });

    expect(googleCalendarPushService.pushReservation).not.toHaveBeenCalled();
  });
});
