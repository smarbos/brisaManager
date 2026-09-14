jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(),
}));
jest.mock('@googleapis/calendar', () => ({
  calendar: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { calendar } from '@googleapis/calendar';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

describe('GoogleCalendarAuthService', () => {
  let service: GoogleCalendarAuthService;
  let prisma: { settings: { update: jest.Mock } };
  let settingsService: { get: jest.Mock };
  let generateAuthUrlMock: jest.Mock;
  let getTokenMock: jest.Mock;
  let setCredentialsMock: jest.Mock;
  let insertCalendarMock: jest.Mock;

  beforeEach(async () => {
    generateAuthUrlMock = jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock=1');
    getTokenMock = jest.fn();
    setCredentialsMock = jest.fn();
    insertCalendarMock = jest.fn();

    (OAuth2Client as unknown as jest.Mock).mockImplementation(() => ({
      generateAuthUrl: generateAuthUrlMock,
      getToken: getTokenMock,
      setCredentials: setCredentialsMock,
    }));
    (calendar as jest.Mock).mockReturnValue({
      calendars: { insert: insertCalendarMock },
    });

    prisma = { settings: { update: jest.fn() } };
    settingsService = { get: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GoogleCalendarAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = moduleRef.get(GoogleCalendarAuthService);
  });

  it('builds a consent URL requesting offline access to the calendar scope and a CSRF state', () => {
    const url = service.getConsentUrl();

    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?mock=1');
    expect(generateAuthUrlMock).toHaveBeenCalledWith({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state: expect.any(String),
    });
  });

  it('exchanges the code, creates a dedicated calendar, and persists the refresh token', async () => {
    service.getConsentUrl();
    const state = generateAuthUrlMock.mock.calls[0][0].state;
    getTokenMock.mockResolvedValue({ tokens: { refresh_token: 'refresh-abc' } });
    insertCalendarMock.mockResolvedValue({ data: { id: 'calendar-abc' } });

    await service.handleOAuthCallback('auth-code-1', state);

    expect(getTokenMock).toHaveBeenCalledWith('auth-code-1');
    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: 'refresh-abc' });
    expect(insertCalendarMock).toHaveBeenCalledWith({
      requestBody: { summary: 'La Brisa de Mar del Plata - Reservations' },
    });
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { googleRefreshToken: 'refresh-abc', googleCalendarId: 'calendar-abc', googleSyncToken: null },
    });
  });

  it('throws if Google does not return a refresh token', async () => {
    service.getConsentUrl();
    const state = generateAuthUrlMock.mock.calls[0][0].state;
    getTokenMock.mockResolvedValue({ tokens: {} });

    await expect(service.handleOAuthCallback('auth-code-1', state)).rejects.toThrow(UnauthorizedException);
    expect(prisma.settings.update).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException and does not exchange the code when the state does not match', async () => {
    service.getConsentUrl();

    await expect(service.handleOAuthCallback('auth-code-1', 'wrong-state')).rejects.toThrow(UnauthorizedException);
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(prisma.settings.update).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when no consent URL was ever generated (no pending state)', async () => {
    await expect(service.handleOAuthCallback('auth-code-1', 'some-state')).rejects.toThrow(UnauthorizedException);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('clears the stored credentials on disconnect', async () => {
    await service.disconnect();

    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { googleRefreshToken: null, googleCalendarId: null, googleSyncToken: null },
    });
  });

  it('reports not connected when there is no refresh token', async () => {
    settingsService.get.mockResolvedValue({
      googleRefreshToken: null,
      lastCalendarSyncAt: null,
      lastCalendarSyncError: null,
    });

    const status = await service.getStatus();

    expect(status).toEqual({ connected: false, lastSyncAt: null, lastSyncError: null });
  });

  it('reports connected with the last sync info when a refresh token is stored', async () => {
    const lastSyncAt = new Date('2026-09-13T12:00:00.000Z');
    settingsService.get.mockResolvedValue({
      googleRefreshToken: 'refresh-abc',
      lastCalendarSyncAt: lastSyncAt,
      lastCalendarSyncError: null,
    });

    const status = await service.getStatus();

    expect(status).toEqual({ connected: true, lastSyncAt, lastSyncError: null });
  });

  it('returns null from getAuthorizedCalendarClient when not connected', async () => {
    settingsService.get.mockResolvedValue({ googleRefreshToken: null, googleCalendarId: null });

    const result = await service.getAuthorizedCalendarClient();

    expect(result).toBeNull();
  });

  it('returns an authorized client and calendarId when connected', async () => {
    settingsService.get.mockResolvedValue({ googleRefreshToken: 'refresh-abc', googleCalendarId: 'calendar-abc' });
    const fakeClient = { events: {} };
    (calendar as jest.Mock).mockReturnValue(fakeClient);

    const result = await service.getAuthorizedCalendarClient();

    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: 'refresh-abc' });
    expect(result).toEqual({ client: fakeClient, calendarId: 'calendar-abc' });
  });
});
