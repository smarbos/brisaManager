import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { calendar, calendar_v3 } from '@googleapis/calendar';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];
const DEDICATED_CALENDAR_NAME = 'La Brisa de Mar del Plata - Reservations';

@Injectable()
export class GoogleCalendarAuthService {
  // Holds the CSRF nonce for the OAuth flow currently in progress. This is a single-process
  // app with a single admin connect flow at a time, so an in-memory field — rather than a DB
  // column — is enough to bridge the few seconds between "admin clicks Connect" and "Google
  // redirects back", and it's cleared immediately after a successful check so it can never be
  // replayed.
  private pendingOAuthState: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  private buildOAuthClient(): OAuth2Client {
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
    );
  }

  getConsentUrl(): string {
    const client = this.buildOAuthClient();
    const state = randomBytes(32).toString('hex');
    this.pendingOAuthState = state;
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: CALENDAR_SCOPES,
      state,
    });
  }

  async handleOAuthCallback(code: string, state: string): Promise<void> {
    if (state !== this.pendingOAuthState || this.pendingOAuthState === null) {
      throw new UnauthorizedException('Invalid or missing OAuth state');
    }
    // Clear before doing the token exchange so this state value can never be replayed, even if
    // the exchange below fails and the admin retries.
    this.pendingOAuthState = null;

    const client = this.buildOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new UnauthorizedException(
        'Google did not return a refresh token. Disconnect (if already connected) and try connecting again.',
      );
    }
    client.setCredentials({ refresh_token: tokens.refresh_token });

    const calendarClient = calendar({ version: 'v3', auth: client });
    const created = await calendarClient.calendars.insert({
      requestBody: { summary: DEDICATED_CALENDAR_NAME },
    });

    await this.prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        googleRefreshToken: tokens.refresh_token,
        googleCalendarId: created.data.id ?? null,
        googleSyncToken: null,
      },
    });
  }

  async disconnect(): Promise<void> {
    await this.prisma.settings.update({
      where: { id: 'singleton' },
      data: { googleRefreshToken: null, googleCalendarId: null, googleSyncToken: null },
    });
  }

  async getStatus(): Promise<{ connected: boolean; lastSyncAt: Date | null; lastSyncError: string | null }> {
    const settings = await this.settingsService.get();
    return {
      connected: Boolean(settings.googleRefreshToken),
      lastSyncAt: settings.lastCalendarSyncAt,
      lastSyncError: settings.lastCalendarSyncError,
    };
  }

  async getAuthorizedCalendarClient(): Promise<{ client: calendar_v3.Calendar; calendarId: string } | null> {
    const settings = await this.settingsService.get();
    if (!settings.googleRefreshToken || !settings.googleCalendarId) {
      return null;
    }

    const client = this.buildOAuthClient();
    client.setCredentials({ refresh_token: settings.googleRefreshToken });

    return { client: calendar({ version: 'v3', auth: client }), calendarId: settings.googleCalendarId };
  }

  isInvalidGrantError(error: unknown): boolean {
    const message = (error as Error)?.message ?? '';
    return message.includes('invalid_grant');
  }
}
