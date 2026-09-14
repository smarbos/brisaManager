import { Test } from '@nestjs/testing';
import { GoogleCalendarPushService } from './google-calendar-push.service';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Reservation } from '@prisma/client';

describe('GoogleCalendarPushService', () => {
  let service: GoogleCalendarPushService;
  let authService: { getAuthorizedCalendarClient: jest.Mock; isInvalidGrantError: jest.Mock; disconnect: jest.Mock };
  let prisma: { reservation: { update: jest.Mock }; settings: { update: jest.Mock } };
  let insertMock: jest.Mock;
  let updateEventMock: jest.Mock;
  let deleteEventMock: jest.Mock;
  let calendarClient: { events: { insert: jest.Mock; update: jest.Mock; delete: jest.Mock } };

  const baseReservation: Reservation = {
    id: 'res-1',
    guestName: 'Jane Doe',
    guestPhone: null,
    guestEmail: null,
    guestId: null,
    checkIn: new Date('2026-05-01'),
    checkOut: new Date('2026-05-05'),
    paxCount: 2,
    source: 'DIRECT',
    externalReference: null,
    totalAmount: 100000 as never,
    currency: 'ARS',
    status: 'PENDING',
    notes: null,
    confirmationToken: 'token-1',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    contractAcceptedName: null,
    contractSnapshot: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
    depositReturnedAt: null,
    confirmationEmailSentAt: null,
    finalConfirmationEmailSentAt: null,
    missingFromChannelAt: null,
    googleEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    insertMock = jest.fn();
    updateEventMock = jest.fn();
    deleteEventMock = jest.fn();
    calendarClient = { events: { insert: insertMock, update: updateEventMock, delete: deleteEventMock } };

    authService = {
      getAuthorizedCalendarClient: jest.fn(),
      isInvalidGrantError: jest.fn().mockReturnValue(false),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    prisma = { reservation: { update: jest.fn() }, settings: { update: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GoogleCalendarPushService,
        { provide: GoogleCalendarAuthService, useValue: authService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(GoogleCalendarPushService);
  });

  it('does nothing when Google Calendar is not connected', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue(null);

    await service.pushReservation(baseReservation);

    expect(insertMock).not.toHaveBeenCalled();
  });

  it('creates a new event for a reservation with no googleEventId yet', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    insertMock.mockResolvedValue({ data: { id: 'event-1' } });

    await service.pushReservation(baseReservation);

    expect(insertMock).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      requestBody: expect.objectContaining({
        summary: 'Jane Doe (Directo)',
        start: { date: '2026-05-01' },
        end: { date: '2026-05-05' },
      }),
    });
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { googleEventId: 'event-1' },
    });
  });

  it('updates the existing event in place when googleEventId is already set', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    const reservation = { ...baseReservation, googleEventId: 'event-1' };

    await service.pushReservation(reservation);

    expect(updateEventMock).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      eventId: 'event-1',
      requestBody: expect.objectContaining({ summary: 'Jane Doe (Directo)' }),
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('deletes the calendar event and clears googleEventId when the reservation is cancelled', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    const reservation = { ...baseReservation, status: 'CANCELLED' as const, googleEventId: 'event-1' };

    await service.pushReservation(reservation);

    expect(deleteEventMock).toHaveBeenCalledWith({ calendarId: 'cal-1', eventId: 'event-1' });
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { googleEventId: null },
    });
  });

  it('does nothing on cancel when there was never a googleEventId', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    const reservation = { ...baseReservation, status: 'CANCELLED' as const, googleEventId: null };

    await service.pushReservation(reservation);

    expect(deleteEventMock).not.toHaveBeenCalled();
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('never throws when the Calendar API call fails, and records the error', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    insertMock.mockRejectedValue(new Error('quota exceeded'));

    await expect(service.pushReservation(baseReservation)).resolves.toBeUndefined();

    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { lastCalendarSyncError: expect.stringContaining('quota exceeded') },
    });
  });

  it('falls back to creating a new event when the stored googleEventId no longer exists (404)', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    const reservation = { ...baseReservation, googleEventId: 'stale-event-1' };
    updateEventMock.mockRejectedValue({ code: 404 });
    insertMock.mockResolvedValue({ data: { id: 'new-event-1' } });

    await service.pushReservation(reservation);

    expect(updateEventMock).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      eventId: 'stale-event-1',
      requestBody: expect.objectContaining({ summary: 'Jane Doe (Directo)' }),
    });
    expect(insertMock).toHaveBeenCalledWith({
      calendarId: 'cal-1',
      requestBody: expect.objectContaining({ summary: 'Jane Doe (Directo)' }),
    });
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { googleEventId: 'new-event-1' },
    });
  });

  it('disconnects when the Calendar API reports an invalid_grant error', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    authService.isInvalidGrantError.mockReturnValue(true);
    insertMock.mockRejectedValue(new Error('invalid_grant: token revoked'));

    await service.pushReservation(baseReservation);

    expect(authService.disconnect).toHaveBeenCalled();
  });

  it('does not disconnect for an error that is not an invalid_grant error', async () => {
    authService.getAuthorizedCalendarClient.mockResolvedValue({ client: calendarClient, calendarId: 'cal-1' });
    authService.isInvalidGrantError.mockReturnValue(false);
    insertMock.mockRejectedValue(new Error('quota exceeded'));

    await service.pushReservation(baseReservation);

    expect(authService.disconnect).not.toHaveBeenCalled();
  });
});
