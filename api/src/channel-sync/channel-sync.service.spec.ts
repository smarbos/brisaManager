jest.mock('node-ical', () => ({
  async: { fromURL: jest.fn() },
}));

import { Test } from '@nestjs/testing';
import * as ical from 'node-ical';
import { ChannelSyncService } from './channel-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';

describe('ChannelSyncService', () => {
  let service: ChannelSyncService;
  let prisma: {
    reservation: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    settings: { update: jest.Mock };
  };
  let settingsService: { get: jest.Mock };
  let emailService: { sendAlert: jest.Mock };
  let fromURLMock: jest.Mock;

  beforeEach(async () => {
    fromURLMock = ical.async.fromURL as jest.Mock;
    fromURLMock.mockReset();

    prisma = {
      reservation: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      settings: { update: jest.fn() },
    };
    settingsService = { get: jest.fn() };
    emailService = { sendAlert: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: EmailService, useValue: emailService },
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

  it('creates a new reservation for a booking not seen before', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.findFirst.mockResolvedValue(null);

    await service.syncAll();

    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'BOOKING',
        externalReference: 'uid-1',
        status: 'PENDING',
        guestName: 'Booking.com Guest',
      }),
    });
  });

  it('does not recreate or modify an already-synced reservation', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1', missingFromChannelAt: null });
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'res-1', externalReference: 'uid-1', missingFromChannelAt: null },
    ]);

    await service.syncAll();

    expect(prisma.reservation.create).not.toHaveBeenCalled();
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

  it('un-flags a reservation that reappears in the feed', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockResolvedValueOnce({
      'uid-1': { type: 'VEVENT', uid: 'uid-1', start: new Date('2026-05-01'), end: new Date('2026-05-05') },
    });
    prisma.reservation.findFirst.mockResolvedValue({
      id: 'res-1',
      missingFromChannelAt: new Date('2026-01-01'),
    });
    prisma.reservation.findMany.mockResolvedValue([
      { id: 'res-1', externalReference: 'uid-1', missingFromChannelAt: new Date('2026-01-01') },
    ]);

    await service.syncAll();

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { missingFromChannelAt: null },
    });
  });

  it('records the error and sends an alert on a fetch failure, without touching reservation data', async () => {
    settingsService.get.mockResolvedValue({
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
    });
    fromURLMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await service.syncAll();

    expect(prisma.reservation.create).not.toHaveBeenCalled();
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
    prisma.reservation.findFirst.mockResolvedValue(null);

    await service.syncAll();

    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: 'AIRBNB', externalReference: 'uid-2' }),
    });
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: expect.any(Date), lastChannelSyncError: expect.stringContaining('booking down') },
    });
  });
});
