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
  let prisma: {
    reservation: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
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
    prisma = {
      reservation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    eventsService = { record: jest.fn() };
    googleCalendarPushService = { pushReservation: jest.fn() };
    guestsService = { syncFromReservation: jest.fn() };
    reservationsService = { sendInitialEmail: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        {
          provide: GoogleCalendarPushService,
          useValue: googleCalendarPushService,
        },
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
    unverified_fields: [
      'guest_name',
      'check_in',
      'check_out',
      'guests',
      'total_price',
      'currency',
      'status',
    ],
  };

  it('creates a reservation with placeholder values when every field is unverified/null', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-1', ...data }),
    );

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
    // Even a placeholder reservation reaches the shared staff calendar — see the
    // "pushes to the calendar even when..." test below for why this isn't gated on
    // verification.
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  it('uses the real scraped values when present', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-2', ...data }),
    );

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
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  it.each([
    ['cancelled', 'CANCELLED'],
    ['canceled', 'CANCELLED'],
    ['completed', 'COMPLETED'],
    ['some unknown status', 'PENDING'],
  ])('maps status "%s" to %s', async (rawStatus, expectedStatus) => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-3', ...data }),
    );

    await service.import({ ...baseDto, status: rawStatus });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: expectedStatus }),
      }),
    );
  });

  it('throws when check_out is not after check_in', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(
      service.import({
        ...baseDto,
        check_in: '2026-11-08',
        check_out: '2026-11-06',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('touches nothing when the reservation was already imported and this rescan found nothing new', async () => {
    const existing = {
      id: 'res-existing',
      guestName: 'Ya corregido a mano',
      guestPhone: null,
      guestEmail: null,
      checkIn: new Date('2026-01-10'),
      checkOut: new Date('2026-01-15'),
      currency: 'ARS',
      status: 'PENDING',
    };
    prisma.reservation.findUnique.mockResolvedValue(existing);
    prisma.reservation.update.mockResolvedValue(existing);

    const { reservation, created } = await service.import(baseDto);

    expect(created).toBe(false);
    expect(reservation).toBe(existing);
    expect(prisma.reservation.create).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    // baseDto has every scraped field null, so nothing already on file gets overwritten.
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-existing' },
      data: {},
    });
  });

  it('re-importing an already-loaded reservation only overwrites fields this rescan actually found, never a staff correction', async () => {
    const existing = {
      id: 'res-existing',
      guestName: 'Ya corregido a mano',
      guestPhone: null,
      guestEmail: null,
      checkIn: new Date('2026-01-10'),
      checkOut: new Date('2026-01-15'),
      currency: 'ARS',
      status: 'PENDING',
    };
    prisma.reservation.findUnique.mockResolvedValue(existing);
    const updated = {
      ...existing,
      checkIn: new Date('2026-01-12'),
      checkOut: new Date('2026-01-17'),
      totalAmount: 45000,
    };
    prisma.reservation.update.mockResolvedValue(updated);

    const { reservation, created } = await service.import({
      ...baseDto,
      check_in: '2026-01-12',
      check_out: '2026-01-17',
      total_price: '$ 45.000',
      // guest_name stays null — must not overwrite "Ya corregido a mano".
    });

    expect(created).toBe(false);
    expect(reservation).toBe(updated);
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-existing' },
      data: {
        checkIn: new Date('2026-01-12'),
        checkOut: new Date('2026-01-17'),
        totalAmount: 45000,
        currency: 'ARS',
      },
    });
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      updated,
    );
  });

  describe('field change tracking on rescan', () => {
    const existing = {
      id: 'res-existing',
      guestName: 'Jane Doe',
      guestPhone: null,
      guestEmail: null,
      checkIn: new Date('2026-01-10'),
      checkOut: new Date('2026-01-15'),
      totalAmount: 40000,
      currency: 'ARS',
      status: 'PENDING',
    };

    it('records FIELD_CHANGED for a re-scraped price and dates', async () => {
      prisma.reservation.findUnique.mockResolvedValue(existing);
      prisma.reservation.update.mockResolvedValue({
        ...existing,
        checkIn: new Date('2026-01-12'),
        checkOut: new Date('2026-01-17'),
        totalAmount: 45000,
      });

      await service.import({
        ...baseDto,
        check_in: '2026-01-12',
        check_out: '2026-01-17',
        total_price: '$ 45.000',
      });

      expect(eventsService.record).toHaveBeenCalledWith(
        'res-existing',
        'FIELD_CHANGED',
        'Check-in: "2026-01-10" → "2026-01-12"',
        'checkIn',
        '2026-01-10',
        '2026-01-12',
        'Extensión de Chrome',
      );
      expect(eventsService.record).toHaveBeenCalledWith(
        'res-existing',
        'FIELD_CHANGED',
        'Check-out: "2026-01-15" → "2026-01-17"',
        'checkOut',
        '2026-01-15',
        '2026-01-17',
        'Extensión de Chrome',
      );
      expect(eventsService.record).toHaveBeenCalledWith(
        'res-existing',
        'FIELD_CHANGED',
        'Monto total: "40000" → "45000"',
        'totalAmount',
        '40000',
        '45000',
        'Extensión de Chrome',
      );
    });

    it('records nothing when the rescan finds the exact same values already on file', async () => {
      prisma.reservation.findUnique.mockResolvedValue(existing);
      prisma.reservation.update.mockResolvedValue(existing);

      await service.import({
        ...baseDto,
        check_in: '2026-01-10',
        check_out: '2026-01-15',
        total_price: '$ 40.000',
      });

      expect(eventsService.record).not.toHaveBeenCalled();
    });
  });

  it('re-syncs the guest record when a rescan brings in a phone for an already-loaded reservation', async () => {
    const existing = {
      id: 'res-existing',
      guestName: 'María Laura',
      guestPhone: null,
      guestEmail: null,
      checkIn: new Date('2026-11-06'),
      checkOut: new Date('2026-11-08'),
      currency: 'ARS',
      status: 'PENDING',
    };
    prisma.reservation.findUnique.mockResolvedValue(existing);
    const updated = { ...existing, guestPhone: '+591 75278095' };
    prisma.reservation.update.mockResolvedValue(updated);

    await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000484',
      guest_phone: '+591 75278095',
    });

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith(
      'res-existing',
      {
        email: null,
        name: 'María Laura',
        phone: '+591 75278095',
        actor: 'Extensión de Chrome',
      },
    );
  });

  it('rejects a rescan whose resolved dates would put check_out before check_in, without writing anything', async () => {
    const existing = {
      id: 'res-existing',
      guestName: 'Jane',
      guestPhone: null,
      guestEmail: null,
      checkIn: new Date('2026-01-10'),
      checkOut: new Date('2026-01-15'),
      currency: 'ARS',
      status: 'PENDING',
    };
    prisma.reservation.findUnique.mockResolvedValue(existing);

    await expect(
      service.import({
        ...baseDto,
        check_in: '2026-01-20',
        check_out: '2026-01-18',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('creates a fresh reservation when the existing match is cancelled, freeing up the old externalReference', async () => {
    const existing = {
      id: 'res-cancelled',
      status: 'CANCELLED',
      externalReference: 'booking-extranet-5000000607',
    };
    prisma.reservation.findUnique.mockResolvedValue(existing);
    prisma.reservation.update.mockResolvedValue(existing);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-new', ...data }),
    );

    const { reservation, created } = await service.import(baseDto);

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-cancelled' },
      data: {
        externalReference:
          'booking-extranet-5000000607-superseded-res-cancelled',
      },
    });
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalReference: 'booking-extranet-5000000607',
        }),
      }),
    );
    expect(created).toBe(true);
    expect(reservation.id).toBe('res-new');
  });

  it('rejects a hotel_id other than the configured property', async () => {
    await expect(
      service.import({ ...baseDto, hotel_id: 'some-other-hotel' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reservation.findUnique).not.toHaveBeenCalled();
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('syncs the guest record and sends the confirmation email when an email is present, even with other fields unverified', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-4', ...data }),
    );

    const { reservation } = await service.import({
      ...baseDto,
      guest_name: 'Weber Clara',
      guest_email: 'ZNoemi@Guest.Booking.com',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestEmail: 'znoemi@guest.booking.com',
        }),
      }),
    );
    expect(guestsService.syncFromReservation).toHaveBeenCalledWith('res-4', {
      email: 'znoemi@guest.booking.com',
      name: 'Weber Clara',
      phone: null,
      actor: 'Extensión de Chrome',
    });
    // The confirmation email invites the guest into the same flow a manual reservation
    // uses, where whatever's still missing gets sorted out — it doesn't wait for the
    // scrape to be fully verified first, same as the calendar push below.
    expect(reservationsService.sendInitialEmail).toHaveBeenCalledWith(
      reservation,
    );
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  it('does not sync a guest or send an email when no email was captured', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-5', ...data }),
    );

    await service.import(baseDto);

    expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
    expect(reservationsService.sendInitialEmail).not.toHaveBeenCalled();
  });

  it('sends the initial confirmation email once every core field is verified and an email exists', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-6', ...data }),
    );

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

    expect(reservationsService.sendInitialEmail).toHaveBeenCalledWith(
      reservation,
    );
    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  it('forces status to PENDING when sending the confirmation email, even if a different status was scraped', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-7', ...data }),
    );

    await service.import({
      ...baseDto,
      guest_email: 'znoemi@guest.booking.com',
      status: 'confirmed',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('does not send the confirmation email when every field is verified but there is no email', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-8', ...data }),
    );

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
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-9', ...data }),
    );

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

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  it('creates an AIRBNB reservation without a hotel_id, using the thread id as the external reference', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-airbnb-1', ...data }),
    );

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
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-airbnb-2', ...data }),
    );

    await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000088',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestName: 'Huésped de Airbnb (pendiente de completar)',
        }),
      }),
    );
  });

  it('syncs a phone-only guest record with the phone normalized to E.164, even without a guest_email', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-airbnb-3', ...data }),
    );

    // The bidi control characters (U+202A/U+202C) are a real artifact of copying a phone
    // number from an RTL-locale page — libphonenumber-js still parses the digits out from
    // around them, which doubles as this test's regression coverage for that case.
    await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000484',
      guest_name: 'María Laura',
      guest_phone: '‪+591 75278095‬',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guestPhone: '+59175278095' }),
      }),
    );
    // Airbnb's hosting messages page never exposes an email, only a phone — the sync must
    // still fire so these guests get a CRM record, keyed on phone (see
    // GuestsService.syncFromReservation()).
    expect(guestsService.syncFromReservation).toHaveBeenCalledWith(
      'res-airbnb-3',
      {
        email: null,
        name: 'María Laura',
        phone: '+59175278095',
        actor: 'Extensión de Chrome',
      },
    );
  });

  it('stores an unparseable scraped phone exactly as scraped, rather than rejecting the import', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-airbnb-5', ...data }),
    );

    await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000485',
      guest_name: 'María Laura',
      guest_phone: 'ask on WhatsApp',
    });

    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ guestPhone: 'ask on WhatsApp' }),
      }),
    );
  });

  it('passes the normalized phone into the guest sync when both email and phone are present', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-airbnb-4', ...data }),
    );

    await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000484',
      guest_name: 'María Laura',
      guest_email: 'gioconda@example.com',
      guest_phone: '+591 75278095',
    });

    expect(guestsService.syncFromReservation).toHaveBeenCalledWith(
      'res-airbnb-4',
      {
        email: 'gioconda@example.com',
        name: 'María Laura',
        phone: '+59175278095',
        actor: 'Extensión de Chrome',
      },
    );
  });

  it('pushes to the calendar even when check_in/check_out are unverified — an approximate date on the internal staff calendar beats no event at all', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-10', ...data }),
    );

    const { reservation } = await service.import({
      ...baseDto,
      guest_name: 'Weber Clara',
      check_in: '2026-11-06',
      check_out: '2026-11-08',
      guests: 3,
      total_price: 'US$145.80',
      currency: 'USD',
      unverified_fields: ['check_out', 'status'],
    });

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  it('pushes an Airbnb import to the calendar even though every scraped field is always unverified by design', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);
    prisma.reservation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'res-airbnb-3', ...data }),
    );

    const { reservation } = await service.import({
      ...baseDto,
      source: 'airbnb',
      hotel_id: undefined,
      res_id: '1000000484',
      guest_name: 'María Laura',
      check_in: '2026-10-27',
      check_out: '2026-10-31',
      guests: 3,
      unverified_fields: [
        'guest_name',
        'guests',
        'check_in',
        'check_out',
        'total_price',
        'currency',
        'status',
      ],
    });

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(
      reservation,
    );
  });

  describe('checkStatus', () => {
    it('reports exists: false when no matching reservation is on file', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      const result = await service.checkStatus('airbnb', '1000000484');

      expect(prisma.reservation.findUnique).toHaveBeenCalledWith({
        where: {
          source_externalReference: {
            source: 'AIRBNB',
            externalReference: 'airbnb-thread-1000000484',
          },
        },
      });
      expect(result).toEqual({ exists: false });
    });

    it('reports exists: false when the only match is cancelled — a fresh import should still be allowed', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: 'res-1',
        status: 'CANCELLED',
      });

      const result = await service.checkStatus('airbnb', '1000000484');

      expect(result).toEqual({ exists: false });
    });

    it('reports the existing reservation summary when a live match is found', async () => {
      const checkIn = new Date('2026-11-06');
      const checkOut = new Date('2026-11-08');
      prisma.reservation.findUnique.mockResolvedValue({
        id: 'res-1',
        guestName: 'María Laura',
        checkIn,
        checkOut,
        status: 'PENDING',
      });

      const result = await service.checkStatus('airbnb', '1000000484');

      expect(result).toEqual({
        exists: true,
        guestName: 'María Laura',
        checkIn,
        checkOut,
        status: 'PENDING',
      });
    });
  });
});
