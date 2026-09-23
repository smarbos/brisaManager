jest.mock('node-ical', () => ({
  async: { fromURL: jest.fn() },
}));

import { Test } from '@nestjs/testing';
import * as ical from 'node-ical';
import { ChannelSyncService } from './channel-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('ChannelSyncService', () => {
  let service: ChannelSyncService;
  let prisma: {
    reservation: { findFirst: jest.Mock };
    settings: { update: jest.Mock };
  };
  let settingsService: { get: jest.Mock };
  let emailService: { sendAlert: jest.Mock };
  let notificationsService: { create: jest.Mock; hasOpen: jest.Mock };
  let fromURLMock: jest.Mock;

  beforeEach(async () => {
    fromURLMock = ical.async.fromURL as jest.Mock;
    fromURLMock.mockReset();

    prisma = {
      reservation: { findFirst: jest.fn().mockResolvedValue(null) },
      settings: { update: jest.fn() },
    };
    settingsService = { get: jest.fn() };
    emailService = { sendAlert: jest.fn() };
    notificationsService = { create: jest.fn(), hasOpen: jest.fn().mockResolvedValue(false) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: EmailService, useValue: emailService },
        { provide: NotificationsService, useValue: notificationsService },
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

  it('never creates or updates a reservation from the feed — only reads', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': {
        type: 'VEVENT',
        uid: 'uid-1',
        start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
      },
    });

    await service.syncAll();

    // No reservation.create/update/upsert mock exists on the prisma stub at all — if the
    // service tried to call one, this test would throw "is not a function" and fail.
    expect(prisma.reservation.findFirst).toHaveBeenCalled();
  });

  it('does nothing for a blocked date range already covered by a non-cancelled reservation', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': {
        type: 'VEVENT',
        uid: 'uid-1',
        start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
      },
    });
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1' });

    await service.syncAll();

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('checks for an overlapping, non-cancelled reservation of the same source', async () => {
    const checkIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const checkOut = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: checkIn, end: checkOut },
    });

    await service.syncAll();

    expect(prisma.reservation.findFirst).toHaveBeenCalledWith({
      where: {
        source: 'BOOKING',
        status: { not: 'CANCELLED' },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { id: true },
    });
  });

  it('creates a CALENDAR_MISMATCH notification when no matching reservation is found', async () => {
    const checkIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const checkOut = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: checkIn, end: checkOut },
    });

    await service.syncAll();

    expect(notificationsService.create).toHaveBeenCalledWith({
      type: 'CALENDAR_MISMATCH',
      message: expect.stringContaining('Booking.com'),
      dedupeKey: 'calendar-mismatch:BOOKING:uid-1',
    });
  });

  it('does not create a duplicate notification when one is already open for the same event', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': {
        type: 'VEVENT',
        uid: 'uid-1',
        start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
      },
    });
    notificationsService.hasOpen.mockResolvedValue(true);

    await service.syncAll();

    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('ignores a blocked date range that is entirely in the past', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': {
        type: 'VEVENT',
        uid: 'uid-1',
        start: new Date('2020-01-01'),
        end: new Date('2020-01-03'),
      },
    });

    await service.syncAll();

    expect(prisma.reservation.findFirst).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('records the error and sends an alert on a fetch failure', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await service.syncAll();

    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: expect.any(Date), lastChannelSyncError: expect.stringContaining('ETIMEDOUT') },
    });
    expect(emailService.sendAlert).toHaveBeenCalled();
  });

  it('syncs both platforms independently — one failing does not stop the other', async () => {
    const checkIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const checkOut = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: 'https://airbnb.example/cal.ics',
    });
    fromURLMock.mockRejectedValueOnce(new Error('booking down'));
    fromURLMock.mockResolvedValueOnce({
      'uid-2': { type: 'VEVENT', uid: 'uid-2', start: checkIn, end: checkOut },
    });

    await service.syncAll();

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'calendar-mismatch:AIRBNB:uid-2' }),
    );
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: expect.any(Date), lastChannelSyncError: expect.stringContaining('booking down') },
    });
  });
});
