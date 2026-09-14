import { Test } from '@nestjs/testing';
import { GoogleCalendarPullService } from './google-calendar-pull.service';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GoogleCalendarPullService', () => {
  let service: GoogleCalendarPullService;
  let authService: { getAuthorizedCalendarClient: jest.Mock; isInvalidGrantError: jest.Mock; disconnect: jest.Mock };
  let settingsService: { get: jest.Mock };
  let prisma: {
    reservation: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
    settings: { update: jest.Mock };
  };
  let listMock: jest.Mock;
  let calendarClient: { events: { list: jest.Mock } };

  beforeEach(async () => {
    listMock = jest.fn();
    calendarClient = { events: { list: listMock } };

    authService = {
      getAuthorizedCalendarClient: jest.fn(),
      isInvalidGrantError: jest.fn().mockReturnValue(false),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    settingsService = { get: jest.fn().mockResolvedValue({ googleSyncToken: null }) };
    prisma = {
      reservation: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      settings: { update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GoogleCalendarPullService,
        { provide: GoogleCalendarAuthService, useValue: authService },
        { provide: SettingsService, useValue: settingsService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(GoogleCalendarPullService);
  });

  it('does nothing when Google Calendar is not connected', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue(null);

    await service.pull();

    expect(listMock).not.toHaveBeenCalled();
  });

  it('creates a new DIRECT reservation for a calendar event with no matching reservation', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'event-new',
            status: 'confirmed',
            summary: 'John Smith',
            start: { date: '2026-06-01' },
            end: { date: '2026-06-05' },
          },
        ],
        nextSyncToken: 'sync-token-1',
      },
    });
    prisma.reservation.findFirst.mockResolvedValue(null);

    await service.pull();

    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guestName: 'John Smith',
        source: 'DIRECT',
        status: 'PENDING',
        googleEventId: 'event-new',
        checkIn: new Date('2026-06-01'),
        checkOut: new Date('2026-06-05'),
      }),
    });
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { googleSyncToken: 'sync-token-1', lastCalendarSyncAt: expect.any(Date), lastCalendarSyncError: null },
    });
  });

  it('updates an existing DIRECT reservation when its event title or dates change', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'event-1',
            status: 'confirmed',
            summary: 'Jane Doe (Direct)',
            start: { date: '2026-07-01' },
            end: { date: '2026-07-10' },
          },
        ],
        nextSyncToken: 'sync-token-2',
      },
    });
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1', source: 'DIRECT' });

    await service.pull();

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { guestName: 'Jane Doe', checkIn: new Date('2026-07-01'), checkOut: new Date('2026-07-10') },
    });
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('cancels a DIRECT reservation when its event is deleted on the calendar', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    listMock.mockResolvedValue({
      data: { items: [{ id: 'event-1', status: 'cancelled' }], nextSyncToken: 'sync-token-3' },
    });
    prisma.reservation.findFirst.mockResolvedValue({ id: 'res-1', source: 'DIRECT' });

    await service.pull();

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'CANCELLED', googleEventId: null },
    });
  });

  it('never mutates a BOOKING/AIRBNB reservation even when its event is edited or deleted', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    listMock.mockResolvedValue({
      data: {
        items: [
          { id: 'event-1', status: 'cancelled' },
          {
            id: 'event-2',
            status: 'confirmed',
            summary: 'Someone Else',
            start: { date: '2026-08-01' },
            end: { date: '2026-08-03' },
          },
        ],
        nextSyncToken: 'sync-token-4',
      },
    });
    prisma.reservation.findFirst
      .mockResolvedValueOnce({ id: 'res-1', source: 'BOOKING' })
      .mockResolvedValueOnce({ id: 'res-2', source: 'AIRBNB' });

    await service.pull();

    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  it('ignores a deleted event that never had a matching reservation', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    listMock.mockResolvedValue({
      data: { items: [{ id: 'event-1', status: 'cancelled' }], nextSyncToken: 'sync-token-5' },
    });
    prisma.reservation.findFirst.mockResolvedValue(null);

    await service.pull();

    expect(prisma.reservation.create).not.toHaveBeenCalled();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('restarts with a full sync when the stored sync token is rejected as expired (410)', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    settingsService.get.mockResolvedValue({ googleSyncToken: 'stale-token' });
    listMock
      .mockRejectedValueOnce({ code: 410 })
      .mockResolvedValueOnce({ data: { items: [], nextSyncToken: 'fresh-token' } });

    await service.pull();

    expect(listMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ syncToken: 'stale-token' }));
    expect(listMock).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ syncToken: expect.anything() }));
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { googleSyncToken: 'fresh-token', lastCalendarSyncAt: expect.any(Date), lastCalendarSyncError: null },
    });
  });

  it('records the error and touches no reservation data on a fetch failure', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    listMock.mockRejectedValue(new Error('network down'));

    await service.pull();

    expect(prisma.reservation.create).not.toHaveBeenCalled();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastCalendarSyncAt: expect.any(Date), lastCalendarSyncError: expect.stringContaining('network down') },
    });
  });

  it('disconnects when the Calendar API reports an invalid_grant error', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    authService.isInvalidGrantError.mockReturnValue(true);
    listMock.mockRejectedValue(new Error('invalid_grant: token revoked'));

    await service.pull();

    expect(authService.disconnect).toHaveBeenCalled();
  });

  it('does not disconnect for an error that is not an invalid_grant error', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    authService.isInvalidGrantError.mockReturnValue(false);
    listMock.mockRejectedValue(new Error('network down'));

    await service.pull();

    expect(authService.disconnect).not.toHaveBeenCalled();
  });
});
