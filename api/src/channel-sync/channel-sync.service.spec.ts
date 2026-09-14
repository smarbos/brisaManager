jest.mock('node-ical', () => ({
  async: { fromURL: jest.fn() },
}));

import { Test } from '@nestjs/testing';
import * as ical from 'node-ical';
import { ChannelSyncService } from './channel-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';

describe('ChannelSyncService', () => {
  let service: ChannelSyncService;
  let prisma: {
    reservation: { findMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
    settings: { update: jest.Mock };
  };
  let settingsService: { get: jest.Mock };
  let emailService: { sendAlert: jest.Mock };
  let googleCalendarPushService: { pushReservation: jest.Mock };
  let eventsService: { record: jest.Mock };
  let fromURLMock: jest.Mock;

  beforeEach(async () => {
    fromURLMock = ical.async.fromURL as jest.Mock;
    fromURLMock.mockReset();

    prisma = {
      reservation: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      settings: { update: jest.fn() },
    };
    settingsService = { get: jest.fn() };
    emailService = { sendAlert: jest.fn() };
    googleCalendarPushService = { pushReservation: jest.fn() };
    eventsService = { record: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: EmailService, useValue: emailService },
        { provide: GoogleCalendarPushService, useValue: googleCalendarPushService },
        { provide: ReservationEventsService, useValue: eventsService },
      ],
    }).compile();

    service = moduleRef.get(ChannelSyncService);
  });

  it('skips a platform entirely when its iCal URL is not set', async () => {
    settingsService.get.mockResolvedValue({ bookingIcalUrl: null, airbnbIcalUrl: null });

    await service.syncAll();

    expect(fromURLMock).not.toHaveBeenCalled();
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: expect.any(Date), lastChannelSyncError: null },
    });
  });

  it('fetches the feed with a fetch timeout/abort signal', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({});

    await service.syncAll();

    expect(fromURLMock).toHaveBeenCalledWith(
      'https://booking.example/cal.ics',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('upserts a new reservation for a booking not seen before', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.upsert.mockResolvedValue({ id: 'res-1' });

    await service.syncAll();

    expect(prisma.reservation.upsert).toHaveBeenCalledWith({
      where: {
        source_externalReference: { source: 'BOOKING', externalReference: 'uid-1' },
      },
      create: expect.objectContaining({
        source: 'BOOKING',
        externalReference: 'uid-1',
        status: 'PENDING',
        guestName: 'Booking.com Guest',
      }),
      update: { missingFromChannelAt: null },
    });
  });

  it('records a RESERVATION_CREATED event for a booking not seen before', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.upsert.mockResolvedValue({ id: 'res-1' });

    await service.syncAll();

    expect(eventsService.record).toHaveBeenCalledWith('res-1', 'RESERVATION_CREATED', 'Created via Booking.com calendar sync');
  });

  it('does not record a RESERVATION_CREATED event when the reservation already existed', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.findUnique.mockResolvedValue({ id: 'res-1' });
    prisma.reservation.upsert.mockResolvedValue({ id: 'res-1', missingFromChannelAt: null });

    await service.syncAll();

    expect(eventsService.record).not.toHaveBeenCalled();
  });

  it('pushes the upserted reservation to Google Calendar for every synced booking', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    const upserted = { id: 'res-1', source: 'BOOKING', externalReference: 'uid-1' };
    prisma.reservation.upsert.mockResolvedValue(upserted);

    await service.syncAll();

    expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(upserted);
  });

  it('does not recreate or modify an already-synced reservation still present in the feed', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.upsert.mockResolvedValue({ id: 'res-1', missingFromChannelAt: null });
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'res-1', externalReference: 'uid-1', missingFromChannelAt: null },
    ]);

    await service.syncAll();

    // The upsert is still called (it's the mechanism itself — atomic create-or-touch), but it
    // must not trigger the separate "missing" flag-update path for a UID still in the feed.
    expect(prisma.reservation.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('flags a previously-synced reservation as missing when its UID disappears from the feed', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({});
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'res-1', externalReference: 'uid-1', missingFromChannelAt: null },
    ]);

    await service.syncAll();

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { missingFromChannelAt: expect.any(Date) },
    });
  });

  it('queries only current/active reservations when checking for ones missing from the feed', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({});

    await service.syncAll();

    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      where: {
        source: 'BOOKING',
        externalReference: { not: null },
        checkOut: { gte: expect.any(Date) },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
    });
  });

  it('un-flags a reservation that reappears in the feed via the upsert update branch', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.upsert.mockResolvedValue({
      id: 'res-1',
      missingFromChannelAt: null,
    });

    await service.syncAll();

    expect(prisma.reservation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_externalReference: { source: 'BOOKING', externalReference: 'uid-1' } },
        update: { missingFromChannelAt: null },
      }),
    );
  });

  it('records the error and sends an alert on a fetch failure, without touching reservation data', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await service.syncAll();

    expect(prisma.reservation.upsert).not.toHaveBeenCalled();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: expect.any(Date), lastChannelSyncError: expect.stringContaining('ETIMEDOUT') },
    });
    expect(emailService.sendAlert).toHaveBeenCalled();
  });

  it('syncs both platforms independently — one failing does not stop the other', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: 'https://airbnb.example/cal.ics',
    });
    fromURLMock.mockRejectedValueOnce(new Error('booking down'));
    fromURLMock.mockResolvedValueOnce({
      'uid-2': { type: 'VEVENT', uid: 'uid-2', start: new Date('2026-06-01'), end: new Date('2026-06-03') },
    });
    prisma.reservation.upsert.mockResolvedValue({ id: 'res-2' });

    await service.syncAll();

    expect(prisma.reservation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_externalReference: { source: 'AIRBNB', externalReference: 'uid-2' } },
        create: expect.objectContaining({ source: 'AIRBNB', externalReference: 'uid-2' }),
      }),
    );
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: expect.any(Date), lastChannelSyncError: expect.stringContaining('booking down') },
    });
  });
});
