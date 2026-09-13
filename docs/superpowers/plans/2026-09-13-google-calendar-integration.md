# Google Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff visibility into every reservation via a dedicated shared Google Calendar, with true two-way sync for `DIRECT` reservations (staff can create/edit/delete bookings on the calendar itself), while `BOOKING`/`AIRBNB` reservations are pushed for visibility only and can never be mutated by a calendar-side edit.

**Architecture:** Extends the existing `api`/`admin-web` stack from sub-projects 1-3. `api` gains a `google-calendar` module: an OAuth2 connect flow (Settings page button → Google consent screen → callback stores a refresh token and creates a dedicated calendar), a push service invoked from `ReservationsService.create`/`update`, a pull service driven by a scheduled job (`@nestjs/schedule`, incremental sync via Google's `syncToken`) plus a manual "Sync now" endpoint sharing the same code path. `admin-web` gains a "Google Calendar" section on the Settings page (Connect/Disconnect/Sync now, status line). No guest-web changes.

**Tech Stack:** Same as prior sub-projects (NestJS, Prisma, PostgreSQL, React+Vite, Jest/Supertest, Vitest/RTL), plus `@googleapis/calendar` (Calendar API v3 client) and `google-auth-library` (OAuth2 client) — both pinned to versions compatible with this project's Node 20 runtime (the latest majors of both require Node ≥22).

**Spec:** `docs/superpowers/specs/2026-09-13-google-calendar-integration-design.md`

## Global Constraints

- Two-way sync applies ONLY to `DIRECT`-source reservations. `BOOKING`/`AIRBNB` reservations are pushed to the calendar for visibility, but a calendar-side edit or delete of one of their events must NEVER change that reservation — the pull job must recognize and skip them unconditionally, every time, no exceptions.
- Not connected (`Settings.googleRefreshToken` is null) means push and pull are both silent no-ops — this feature is fully optional and must never throw or block anything else when disconnected.
- A push failure must never block or fail the `create`/`update` request that triggered it.
- A pull failure must never touch reservation data and must never affect the iCal channel sync from sub-project 3 (fully independent schedulers, fully independent error fields: `lastCalendarSyncError` vs `lastChannelSyncError`).
- New reservations created from a calendar-side event write directly through Prisma, not through `ReservationsService.create()`/`CreateReservationDto` — same reasoning as sub-project 3: the DTO's `@IsPositive()` on `totalAmount` would reject the placeholder `0` value, and this is an internal system write, not an HTTP-validated one.
- `@googleapis/calendar` must be pinned to `^16.0.0` and `google-auth-library` to `^10.5.0` — both verified compatible with this project's Node 20 container; their latest majors (180.x / 11.x as of this writing) require Node ≥22 and will break the build if installed unpinned.

---

### Task 1: Prisma schema — Settings OAuth/sync fields, Reservation googleEventId

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/...` (via `prisma migrate dev`)
- Create: `api/test/google-calendar-schema.e2e-spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `Settings.googleRefreshToken`, `Settings.googleCalendarId`, `Settings.googleSyncToken`, `Settings.lastCalendarSyncAt`, `Settings.lastCalendarSyncError`, `Reservation.googleEventId` — consumed by every later task in this plan.

- [ ] **Step 1: Add the new fields to `api/prisma/schema.prisma`**

Modify the existing `Settings` model — add these fields (keep every existing field unchanged):
```prisma
model Settings {
  id                   String    @id
  houseRulesText       String
  paymentInstructions  String
  bookingIcalUrl       String?
  airbnbIcalUrl        String?
  lastChannelSyncAt    DateTime?
  lastChannelSyncError String?
  googleRefreshToken   String?
  googleCalendarId     String?
  googleSyncToken      String?
  lastCalendarSyncAt   DateTime?
  lastCalendarSyncError String?
  updatedAt            DateTime  @updatedAt
}
```

Modify the existing `Reservation` model — add this one field (keep every existing field from sub-projects 1-3 unchanged, including the `@@unique([source, externalReference])` constraint):
```prisma
model Reservation {
  // ...all existing fields stay exactly as they are...

  googleEventId String?
}
```

- [ ] **Step 2: Generate and run the migration**

Run:
```bash
docker compose exec api npx prisma migrate dev --name google_calendar_integration
```
Expected: a new folder under `api/prisma/migrations/`, migration applied successfully.

- [ ] **Step 3: Write a schema smoke test**

`api/test/google-calendar-schema.e2e-spec.ts`:
```typescript
import { PrismaClient } from '@prisma/client';

describe('Google Calendar schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sets and reads the new Settings Google Calendar fields', async () => {
    const settings = await prisma.settings.upsert({
      where: { id: 'google-calendar-schema-test-singleton' },
      update: {},
      create: {
        id: 'google-calendar-schema-test-singleton',
        houseRulesText: 'No parties.',
        paymentInstructions: 'Bank X.',
        googleRefreshToken: 'refresh-token-value',
        googleCalendarId: 'calendar-id-value',
        googleSyncToken: 'sync-token-value',
        lastCalendarSyncAt: new Date(),
        lastCalendarSyncError: null,
      },
    });

    expect(settings.googleRefreshToken).toBe('refresh-token-value');
    expect(settings.googleCalendarId).toBe('calendar-id-value');
    expect(settings.googleSyncToken).toBe('sync-token-value');

    await prisma.settings.delete({ where: { id: 'google-calendar-schema-test-singleton' } });
  });

  it('sets and clears googleEventId on a Reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        googleEventId: 'event-id-value',
      },
    });

    expect(reservation.googleEventId).toBe('event-id-value');

    const cleared = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { googleEventId: null },
    });

    expect(cleared.googleEventId).toBeNull();

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });
});
```

- [ ] **Step 4: Run it**

Run:
```bash
docker compose exec api npm run test:e2e
```
Expected: all suites PASS, including the new one, with no regressions.

- [ ] **Step 5: Add placeholder OAuth env vars**

Add to `.env.example` (a new `# Google Calendar` section, anywhere after the existing `# Email (Resend)` section):
```
# Google Calendar
GOOGLE_CLIENT_ID=changeme.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=changeme
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3001/google-calendar/oauth/callback
```
Add the same three variables (with real or placeholder values) to the repo-root `.env` if it exists in this environment — check with `test -f .env` before editing; `.env` is git-ignored so this step only matters for local runtime, not for the commit.

- [ ] **Step 6: Commit**

```bash
git add api/prisma api/test/google-calendar-schema.e2e-spec.ts .env.example
git commit -m "Add Google Calendar OAuth/sync fields to Settings and googleEventId to Reservation"
```

---

### Task 2: GoogleCalendarAuthService — OAuth2 client, consent URL, callback, disconnect, status

**Files:**
- Create: `api/src/google-calendar/google-calendar-auth.service.ts`, `google-calendar-auth.service.spec.ts`
- Modify: `api/package.json`

**Interfaces:**
- Consumes: `PrismaService`, `SettingsService.get()` (sub-project 2).
- Produces: `GoogleCalendarAuthService.getConsentUrl(): string`, `handleOAuthCallback(code: string): Promise<void>`, `disconnect(): Promise<void>`, `getStatus(): Promise<{ connected: boolean; lastSyncAt: Date | null; lastSyncError: string | null }>`, `getAuthorizedCalendarClient(): Promise<{ client: calendar_v3.Calendar; calendarId: string } | null>` — consumed by Task 3 (controller), Task 4 (push service), Task 6 (pull service).

- [ ] **Step 1: Install the Google API packages**

Run:
```bash
docker compose exec api npm install @googleapis/calendar@^16.0.0 google-auth-library@^10.5.0
docker compose restart api
```
Both versions are pinned deliberately: the latest majors of `@googleapis/calendar` (180.x) and `google-auth-library` (11.x) require Node ≥22, which this project's containers don't run. If npm resolves anything outside these ranges, pin exactly and note it in your report.

- [ ] **Step 2: Write the failing `GoogleCalendarAuthService` tests**

`api/src/google-calendar/google-calendar-auth.service.spec.ts`:
```typescript
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

  it('builds a consent URL requesting offline access to the calendar scope', () => {
    const url = service.getConsentUrl();

    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?mock=1');
    expect(generateAuthUrlMock).toHaveBeenCalledWith({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
    });
  });

  it('exchanges the code, creates a dedicated calendar, and persists the refresh token', async () => {
    getTokenMock.mockResolvedValue({ tokens: { refresh_token: 'refresh-abc' } });
    insertCalendarMock.mockResolvedValue({ data: { id: 'calendar-abc' } });

    await service.handleOAuthCallback('auth-code-1');

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
    getTokenMock.mockResolvedValue({ tokens: {} });

    await expect(service.handleOAuthCallback('auth-code-1')).rejects.toThrow(UnauthorizedException);
    expect(prisma.settings.update).not.toHaveBeenCalled();
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec api npm test -- google-calendar-auth.service.spec.ts`
Expected: FAIL (`Cannot find module './google-calendar-auth.service'`)

- [ ] **Step 4: Implement `GoogleCalendarAuthService`**

`api/src/google-calendar/google-calendar-auth.service.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { calendar, calendar_v3 } from '@googleapis/calendar';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];
const DEDICATED_CALENDAR_NAME = 'La Brisa de Mar del Plata - Reservations';

@Injectable()
export class GoogleCalendarAuthService {
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
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: CALENDAR_SCOPES,
    });
  }

  async handleOAuthCallback(code: string): Promise<void> {
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
```

Create `api/src/google-calendar/google-calendar.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [GoogleCalendarAuthService],
  exports: [GoogleCalendarAuthService],
})
export class GoogleCalendarModule {}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- google-calendar-auth.service.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src/google-calendar api/package.json api/package-lock.json
git commit -m "Add GoogleCalendarAuthService for OAuth2 connect/disconnect/status"
```

---

### Task 3: GoogleCalendarController — connect-url, OAuth callback, disconnect, status

**Files:**
- Create: `api/src/google-calendar/google-calendar.controller.ts`
- Modify: `api/src/google-calendar/google-calendar.module.ts`, `api/src/app.module.ts`
- Create: `api/test/google-calendar.e2e-spec.ts`

**Interfaces:**
- Consumes: `GoogleCalendarAuthService` (Task 2).
- Produces: `GET /google-calendar/oauth/connect-url` (JWT-guarded), `GET /google-calendar/oauth/callback` (public — Google redirects the browser here with no auth header, by OAuth's own design), `POST /google-calendar/disconnect` (JWT-guarded), `GET /google-calendar/status` (JWT-guarded) — consumed by Task 8 (admin-web Settings page).

The connect button cannot call a JWT-guarded endpoint via a full-page browser redirect (the app's `apiClient` only attaches the `Authorization` header on `fetch` calls, never on `window.location` navigation — see `admin-web/src/api/client.ts`). So the frontend first fetches the consent URL via an authenticated JSON call (`connect-url`), then does the actual page navigation to Google's own domain — the browser never sends our JWT to Google, and never needs to send it back to us either, since Google's callback is a plain unauthenticated redirect.

- [ ] **Step 1: Implement the controller**

`api/src/google-calendar/google-calendar.controller.ts`:
```typescript
import { BadRequestException, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(private readonly authService: GoogleCalendarAuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('oauth/connect-url')
  getConnectUrl() {
    return { url: this.authService.getConsentUrl() };
  }

  @Get('oauth/callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    const adminOrigin = process.env.ADMIN_WEB_ORIGIN ?? '';
    if (!code) {
      res.redirect(`${adminOrigin}/settings?googleCalendar=error`);
      return;
    }
    try {
      await this.authService.handleOAuthCallback(code);
      res.redirect(`${adminOrigin}/settings?googleCalendar=connected`);
    } catch {
      res.redirect(`${adminOrigin}/settings?googleCalendar=error`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('disconnect')
  async disconnect() {
    await this.authService.disconnect();
    return { disconnected: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus() {
    return this.authService.getStatus();
  }
}
```

If `@Query('code') code: string` triggers a TypeScript strict-mode complaint about a possibly-undefined value being typed as `string`, type it as `code?: string` and keep the existing `if (!code)` guard — that guard is what actually matters at runtime either way.

Modify `api/src/google-calendar/google-calendar.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarAuthService],
  exports: [GoogleCalendarAuthService],
})
export class GoogleCalendarModule {}
```

Modify `api/src/app.module.ts`: add `GoogleCalendarModule` (imported from `./google-calendar/google-calendar.module`) to the `imports` array, alongside `ChannelSyncModule`.

- [ ] **Step 2: Write the e2e test**

`api/test/google-calendar.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('GoogleCalendarController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-google-calendar@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash },
    });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-google-calendar@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication for the connect-url endpoint', async () => {
    await request(app.getHttpServer()).get('/google-calendar/oauth/connect-url').expect(401);
  });

  it('returns a Google consent URL when authenticated', async () => {
    const response = await request(app.getHttpServer())
      .get('/google-calendar/oauth/connect-url')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.url).toContain('accounts.google.com');
  });

  it('requires authentication for the status endpoint', async () => {
    await request(app.getHttpServer()).get('/google-calendar/status').expect(401);
  });

  it('reports not connected in this test environment', async () => {
    const response = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.connected).toBe(false);
  });

  it('redirects to the admin app with an error when the callback is missing a code', async () => {
    const response = await request(app.getHttpServer()).get('/google-calendar/oauth/callback').expect(302);

    expect(response.headers.location).toContain('googleCalendar=error');
  });
});
```

- [ ] **Step 3: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 4: Commit**

```bash
git add api/src/google-calendar api/src/app.module.ts api/test/google-calendar.e2e-spec.ts
git commit -m "Add GoogleCalendarController with connect/callback/disconnect/status routes"
```

---

### Task 4: GoogleCalendarPushService — push a reservation to its calendar event

**Files:**
- Create: `api/src/google-calendar/google-calendar-push.service.ts`, `google-calendar-push.service.spec.ts`
- Modify: `api/src/google-calendar/google-calendar.module.ts`

**Interfaces:**
- Consumes: `GoogleCalendarAuthService.getAuthorizedCalendarClient()` (Task 2), `PrismaService`.
- Produces: `GoogleCalendarPushService.pushReservation(reservation: Reservation): Promise<void>` — consumed by Task 5 (`ReservationsService` hook).

- [ ] **Step 1: Write the failing tests**

`api/src/google-calendar/google-calendar-push.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { GoogleCalendarPushService } from './google-calendar-push.service';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { Reservation } from '@prisma/client';

describe('GoogleCalendarPushService', () => {
  let service: GoogleCalendarPushService;
  let authService: { getAuthorizedCalendarClient: jest.Mock };
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

    authService = { getAuthorizedCalendarClient: jest.fn() };
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
        summary: 'Jane Doe (Direct)',
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
      requestBody: expect.objectContaining({ summary: 'Jane Doe (Direct)' }),
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
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- google-calendar-push.service.spec.ts`
Expected: FAIL (`Cannot find module './google-calendar-push.service'`)

- [ ] **Step 3: Implement `GoogleCalendarPushService`**

`api/src/google-calendar/google-calendar-push.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Reservation, ReservationSource } from '@prisma/client';
import { calendar_v3 } from '@googleapis/calendar';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { PrismaService } from '../prisma/prisma.service';

const SOURCE_LABELS: Record<ReservationSource, string> = {
  BOOKING: 'Booking.com',
  AIRBNB: 'Airbnb',
  DIRECT: 'Direct',
  OTHER: 'Other',
};

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isNotFoundError(error: unknown): boolean {
  return (error as { code?: number }).code === 404;
}

@Injectable()
export class GoogleCalendarPushService {
  private readonly logger = new Logger(GoogleCalendarPushService.name);

  constructor(
    private readonly authService: GoogleCalendarAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async pushReservation(reservation: Reservation): Promise<void> {
    try {
      const authorized = await this.authService.getAuthorizedCalendarClient();
      if (!authorized) {
        return;
      }
      const { client, calendarId } = authorized;
      const isActive = reservation.status !== 'CANCELLED' && reservation.status !== 'COMPLETED';

      if (!isActive) {
        await this.removeEvent(client, calendarId, reservation);
        return;
      }

      await this.upsertEvent(client, calendarId, reservation);
      await this.prisma.settings.update({ where: { id: 'singleton' }, data: { lastCalendarSyncError: null } });
    } catch (error) {
      this.logger.error(`Google Calendar push failed for reservation ${reservation.id}: ${(error as Error).message}`);
      await this.prisma.settings
        .update({ where: { id: 'singleton' }, data: { lastCalendarSyncError: (error as Error).message } })
        .catch(() => undefined);
    }
  }

  private async removeEvent(
    client: calendar_v3.Calendar,
    calendarId: string,
    reservation: Reservation,
  ): Promise<void> {
    if (!reservation.googleEventId) {
      return;
    }
    try {
      await client.events.delete({ calendarId, eventId: reservation.googleEventId });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
    await this.prisma.reservation.update({ where: { id: reservation.id }, data: { googleEventId: null } });
  }

  private async upsertEvent(client: calendar_v3.Calendar, calendarId: string, reservation: Reservation): Promise<void> {
    const requestBody: calendar_v3.Schema$Event = {
      summary: `${reservation.guestName} (${SOURCE_LABELS[reservation.source]})`,
      description: `Pax: ${reservation.paxCount}\nTotal: ${Number(reservation.totalAmount)} ${reservation.currency}\nStatus: ${reservation.status}`,
      start: { date: toDateOnly(reservation.checkIn) },
      end: { date: toDateOnly(reservation.checkOut) },
    };

    if (reservation.googleEventId) {
      await client.events.update({ calendarId, eventId: reservation.googleEventId, requestBody });
      return;
    }

    const created = await client.events.insert({ calendarId, requestBody });
    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { googleEventId: created.data.id ?? null },
    });
  }
}
```

Modify `api/src/google-calendar/google-calendar.module.ts` — add `GoogleCalendarPushService` to `providers` and `exports`:
```typescript
import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { GoogleCalendarPushService } from './google-calendar-push.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarAuthService, GoogleCalendarPushService],
  exports: [GoogleCalendarAuthService, GoogleCalendarPushService],
})
export class GoogleCalendarModule {}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- google-calendar-push.service.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/google-calendar
git commit -m "Add GoogleCalendarPushService to create/update/delete calendar events for reservations"
```

---

### Task 5: Hook the push service into ReservationsService

**Files:**
- Modify: `api/src/reservations/reservations.service.ts`, `reservations.service.spec.ts`, `reservations.module.ts`

**Interfaces:**
- Consumes: `GoogleCalendarPushService.pushReservation()` (Task 4).
- Produces: nothing new consumed by later tasks — `create`/`update` now push automatically.

- [ ] **Step 1: Update the existing test file's provider wiring**

`ReservationsService`'s constructor gains a new dependency, so every test in `reservations.service.spec.ts` that builds it via `Test.createTestingModule` needs the new provider mocked, or the module compile will fail for ALL existing tests in the file, not just new ones. In `api/src/reservations/reservations.service.spec.ts`, add the import and provider:
```typescript
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
```
Add to the `let` declarations block:
```typescript
let googleCalendarPushService: { pushReservation: jest.Mock };
```
In `beforeEach`, alongside the other mock objects:
```typescript
googleCalendarPushService = { pushReservation: jest.fn() };
```
Add to the `providers` array passed to `Test.createTestingModule`:
```typescript
{ provide: GoogleCalendarPushService, useValue: googleCalendarPushService },
```

- [ ] **Step 2: Write the failing tests for the new hook**

Add to `api/src/reservations/reservations.service.spec.ts` (alongside the existing `create`/`update` tests):
```typescript
it('pushes the reservation to Google Calendar after creating it', async () => {
  const created = { id: '1', ...validDto };
  prisma.reservation.create.mockResolvedValue(created);

  await service.create(validDto);

  expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(created);
});

it('pushes the reservation to Google Calendar after updating it', async () => {
  prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
  const updated = { id: '1', ...validDto, guestName: 'Updated Name' };
  prisma.reservation.update.mockResolvedValue(updated);

  await service.update('1', { guestName: 'Updated Name' });

  expect(googleCalendarPushService.pushReservation).toHaveBeenCalledWith(updated);
});
```

- [ ] **Step 3: Run the tests and confirm the two new ones fail**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: the two new tests FAIL (`pushReservation` never called); all pre-existing tests in the file still PASS since Step 1 kept the module compiling.

- [ ] **Step 4: Wire the hook into `ReservationsService`**

Modify `api/src/reservations/reservations.service.ts` — add the import:
```typescript
import { GoogleCalendarPushService } from '../google-calendar/google-calendar-push.service';
```
Add to the constructor:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly eventsService: ReservationEventsService,
  private readonly emailService: EmailService,
  private readonly confirmationService: ReservationConfirmationService,
  private readonly googleCalendarPushService: GoogleCalendarPushService,
) {}
```
In `create()`, before the final `return reservation;`:
```typescript
await this.googleCalendarPushService.pushReservation(reservation);

return reservation;
```
In `update()`, replace the direct `return this.prisma.reservation.update({...})` with an awaited assignment followed by the push and the return:
```typescript
const updated = await this.prisma.reservation.update({
  where: { id },
  data: {
    ...dto,
    checkIn: dto.checkIn ? new Date(dto.checkIn) : undefined,
    checkOut: dto.checkOut ? new Date(dto.checkOut) : undefined,
    externalReference:
      dto.externalReference !== undefined
        ? dto.externalReference?.trim()
          ? dto.externalReference.trim()
          : null
        : undefined,
  },
});

await this.googleCalendarPushService.pushReservation(updated);

return updated;
```

Modify `api/src/reservations/reservations.module.ts` to import `GoogleCalendarModule` (from `../google-calendar/google-calendar.module`) alongside its existing imports, so Nest can resolve the new dependency.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: PASS (all original tests + the 2 new ones)

- [ ] **Step 6: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS — `reservations.e2e-spec.ts` exercises the real `GoogleCalendarPushService` (not mocked) via the real `AppModule`, but since `Settings.googleRefreshToken` is null in the test database, `pushReservation()` is a genuine no-op, same pattern already relied on by `channel-sync.e2e-spec.ts` for the iCal sync.

- [ ] **Step 7: Commit**

```bash
git add api/src/reservations
git commit -m "Push reservations to Google Calendar on create and update"
```

---

### Task 6: GoogleCalendarPullService — incremental pull, DIRECT-only two-way sync

**Files:**
- Create: `api/src/google-calendar/google-calendar-pull.service.ts`, `google-calendar-pull.service.spec.ts`
- Modify: `api/src/google-calendar/google-calendar.module.ts`

**Interfaces:**
- Consumes: `GoogleCalendarAuthService.getAuthorizedCalendarClient()` (Task 2), `SettingsService.get()`, `PrismaService`.
- Produces: `GoogleCalendarPullService.pull(): Promise<void>` — consumed by Task 7 (scheduler + manual endpoint).

- [ ] **Step 1: Write the failing tests**

`api/src/google-calendar/google-calendar-pull.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { GoogleCalendarPullService } from './google-calendar-pull.service';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GoogleCalendarPullService', () => {
  let service: GoogleCalendarPullService;
  let authService: { getAuthorizedCalendarClient: jest.Mock };
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

    authService = { getAuthorizedCalendarClient: jest.fn() };
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
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- google-calendar-pull.service.spec.ts`
Expected: FAIL (`Cannot find module './google-calendar-pull.service'`)

- [ ] **Step 3: Implement `GoogleCalendarPullService`**

`api/src/google-calendar/google-calendar-pull.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3 } from '@googleapis/calendar';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

function stripSourceSuffix(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function eventDate(dateTime?: calendar_v3.Schema$EventDateTime | null): Date | null {
  const value = dateTime?.date ?? dateTime?.dateTime;
  return value ? new Date(value) : null;
}

@Injectable()
export class GoogleCalendarPullService {
  private readonly logger = new Logger(GoogleCalendarPullService.name);

  constructor(
    private readonly authService: GoogleCalendarAuthService,
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async pull(): Promise<void> {
    const authorized = await this.authService.getAuthorizedCalendarClient();
    if (!authorized) {
      return;
    }
    const { client, calendarId } = authorized;

    try {
      const settings = await this.settingsService.get();
      const events = await this.listChangedEvents(client, calendarId, settings.googleSyncToken ?? undefined);

      for (const event of events.items) {
        if (event.id) {
          await this.applyEvent(event);
        }
      }

      await this.prisma.settings.update({
        where: { id: 'singleton' },
        data: {
          googleSyncToken: events.nextSyncToken ?? null,
          lastCalendarSyncAt: new Date(),
          lastCalendarSyncError: null,
        },
      });
    } catch (error) {
      this.logger.error(`Google Calendar pull failed: ${(error as Error).message}`);
      await this.prisma.settings.update({
        where: { id: 'singleton' },
        data: { lastCalendarSyncAt: new Date(), lastCalendarSyncError: (error as Error).message },
      });
    }
  }

  private async listChangedEvents(
    client: calendar_v3.Calendar,
    calendarId: string,
    initialSyncToken: string | undefined,
  ): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null | undefined }> {
    let syncToken = initialSyncToken;
    let pageToken: string | undefined;
    let nextSyncToken: string | null | undefined;
    const items: calendar_v3.Schema$Event[] = [];

    do {
      let response;
      try {
        response = await client.events.list({ calendarId, syncToken, pageToken, showDeleted: true, singleEvents: true });
      } catch (error) {
        if ((error as { code?: number }).code === 410) {
          // The stored sync token expired or was invalidated — drop it and do a full resync.
          syncToken = undefined;
          pageToken = undefined;
          response = await client.events.list({ calendarId, showDeleted: true, singleEvents: true });
        } else {
          throw error;
        }
      }

      items.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
      nextSyncToken = response.data.nextSyncToken;
    } while (pageToken);

    return { items, nextSyncToken };
  }

  private async applyEvent(event: calendar_v3.Schema$Event): Promise<void> {
    const existing = await this.prisma.reservation.findFirst({ where: { googleEventId: event.id } });
    const isCancelled = event.status === 'cancelled';

    if (existing) {
      // Channel-sourced reservations are pull-immune: their iCal feed is the source of truth.
      if (existing.source !== 'DIRECT') {
        return;
      }

      if (isCancelled) {
        await this.prisma.reservation.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED', googleEventId: null },
        });
        return;
      }

      const checkIn = eventDate(event.start);
      const checkOut = eventDate(event.end);
      if (!checkIn || !checkOut || !event.summary) {
        return;
      }

      await this.prisma.reservation.update({
        where: { id: existing.id },
        data: { guestName: stripSourceSuffix(event.summary), checkIn, checkOut },
      });
      return;
    }

    if (isCancelled) {
      return;
    }

    const checkIn = eventDate(event.start);
    const checkOut = eventDate(event.end);
    if (!checkIn || !checkOut || !event.summary) {
      return;
    }

    await this.prisma.reservation.create({
      data: {
        guestName: stripSourceSuffix(event.summary),
        checkIn,
        checkOut,
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        status: 'PENDING',
        googleEventId: event.id,
        notes: 'Auto-created from a Google Calendar event. Please review pax count, price, and contact details.',
      },
    });
  }
}
```

Modify `api/src/google-calendar/google-calendar.module.ts` — add `GoogleCalendarPullService` to `providers`:
```typescript
import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { GoogleCalendarPushService } from './google-calendar-push.service';
import { GoogleCalendarPullService } from './google-calendar-pull.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarAuthService, GoogleCalendarPushService, GoogleCalendarPullService],
  exports: [GoogleCalendarAuthService, GoogleCalendarPushService],
})
export class GoogleCalendarModule {}
```
`GoogleCalendarPullService` does not need to be exported — only `GoogleCalendarController` (same module) and `GoogleCalendarSchedulerService` (added in Task 7, also same module) ever inject it.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- google-calendar-pull.service.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/google-calendar
git commit -m "Add GoogleCalendarPullService with DIRECT-only two-way sync"
```

---

### Task 7: Scheduled pull job + manual sync-now endpoint

**Files:**
- Create: `api/src/google-calendar/google-calendar-scheduler.service.ts`, `google-calendar-scheduler.service.spec.ts`
- Modify: `api/src/google-calendar/google-calendar.module.ts`, `google-calendar.controller.ts`
- Modify: `api/test/google-calendar.e2e-spec.ts`

**Interfaces:**
- Consumes: `GoogleCalendarPullService.pull()` (Task 6).
- Produces: `POST /google-calendar/sync-now` (JWT-guarded) — consumed by Task 8 (admin-web "Sync now" button).

- [ ] **Step 1: Write the failing scheduler test**

`api/src/google-calendar/google-calendar-scheduler.service.spec.ts`:
```typescript
import { GoogleCalendarSchedulerService } from './google-calendar-scheduler.service';
import { GoogleCalendarPullService } from './google-calendar-pull.service';

describe('GoogleCalendarSchedulerService', () => {
  it('calls GoogleCalendarPullService.pull on its scheduled handler', async () => {
    const pull = jest.fn().mockResolvedValue(undefined);
    const scheduler = new GoogleCalendarSchedulerService({ pull } as unknown as GoogleCalendarPullService);

    await scheduler.handleScheduledPull();

    expect(pull).toHaveBeenCalled();
  });

  it('never throws even if the pull rejects', async () => {
    const pull = jest.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new GoogleCalendarSchedulerService({ pull } as unknown as GoogleCalendarPullService);

    await expect(scheduler.handleScheduledPull()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- google-calendar-scheduler.service.spec.ts`
Expected: FAIL (`Cannot find module './google-calendar-scheduler.service'`)

- [ ] **Step 3: Implement the scheduler**

`api/src/google-calendar/google-calendar-scheduler.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GoogleCalendarPullService } from './google-calendar-pull.service';

@Injectable()
export class GoogleCalendarSchedulerService {
  private readonly logger = new Logger(GoogleCalendarSchedulerService.name);

  constructor(private readonly pullService: GoogleCalendarPullService) {}

  @Cron('*/5 * * * *')
  async handleScheduledPull(): Promise<void> {
    try {
      await this.pullService.pull();
    } catch (error) {
      this.logger.error(`Scheduled Google Calendar pull failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- google-calendar-scheduler.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the manual sync-now endpoint**

Add to `api/src/google-calendar/google-calendar.controller.ts` — new import and constructor param:
```typescript
import { GoogleCalendarPullService } from './google-calendar-pull.service';
```
```typescript
constructor(
  private readonly authService: GoogleCalendarAuthService,
  private readonly pullService: GoogleCalendarPullService,
) {}
```
New route, alongside the existing ones:
```typescript
@UseGuards(JwtAuthGuard)
@Post('sync-now')
async syncNow() {
  await this.pullService.pull();
  return { triggeredAt: new Date() };
}
```

Modify `api/src/google-calendar/google-calendar.module.ts` — add `GoogleCalendarSchedulerService` to `providers`. `GoogleCalendarPullService` does NOT need to move to `exports`: it's already in this module's `providers`, and `GoogleCalendarController` lives in the same module, so Nest resolves the dependency without an export — `exports` only matters for other modules importing this one (that's why `GoogleCalendarAuthService`/`GoogleCalendarPushService` are exported, for `ReservationsModule`'s sake):
```typescript
import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { GoogleCalendarPushService } from './google-calendar-push.service';
import { GoogleCalendarPullService } from './google-calendar-pull.service';
import { GoogleCalendarSchedulerService } from './google-calendar-scheduler.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarAuthService, GoogleCalendarPushService, GoogleCalendarPullService, GoogleCalendarSchedulerService],
  exports: [GoogleCalendarAuthService, GoogleCalendarPushService],
})
export class GoogleCalendarModule {}
```

- [ ] **Step 6: Add the e2e test for the manual sync endpoint**

Add to `api/test/google-calendar.e2e-spec.ts` (reusing its existing auth setup):
```typescript
it('requires authentication for sync-now', async () => {
  await request(app.getHttpServer()).post('/google-calendar/sync-now').expect(401);
});

it('triggers a sync and returns a timestamp (not connected in this test env, so it succeeds as a no-op)', async () => {
  const response = await request(app.getHttpServer())
    .post('/google-calendar/sync-now')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(201);

  expect(response.body.triggeredAt).toBeTruthy();
});

it('requires authentication for disconnect', async () => {
  await request(app.getHttpServer()).post('/google-calendar/disconnect').expect(401);
});

it('disconnects without error even when never connected', async () => {
  await request(app.getHttpServer())
    .post('/google-calendar/disconnect')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(201);
});
```

- [ ] **Step 7: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 8: Commit**

```bash
git add api/src/google-calendar api/test/google-calendar.e2e-spec.ts
git commit -m "Add scheduled and manual Google Calendar pull triggers"
```

---

### Task 8: Admin-web — Settings page Google Calendar section

**Files:**
- Create: `admin-web/src/api/google-calendar.ts`
- Modify: `admin-web/src/settings/SettingsPage.tsx`, `admin-web/src/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `GET /google-calendar/status`, `GET /google-calendar/oauth/connect-url`, `POST /google-calendar/disconnect`, `POST /google-calendar/sync-now` (Tasks 3 & 7).
- Produces: nothing consumed by later tasks — leaf feature, final task of this plan.

- [ ] **Step 1: Add the API client functions**

`admin-web/src/api/google-calendar.ts`:
```typescript
import { apiClient } from './client';

export interface GoogleCalendarStatus {
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  return apiClient.request('/google-calendar/status');
}

export function getGoogleCalendarConnectUrl(): Promise<{ url: string }> {
  return apiClient.request('/google-calendar/oauth/connect-url');
}

export function disconnectGoogleCalendar(): Promise<{ disconnected: boolean }> {
  return apiClient.request('/google-calendar/disconnect', { method: 'POST' });
}

export function runGoogleCalendarSync(): Promise<{ triggeredAt: string }> {
  return apiClient.request('/google-calendar/sync-now', { method: 'POST' });
}
```

- [ ] **Step 2: Write the failing tests**

Add to `admin-web/src/settings/SettingsPage.test.tsx` (alongside the existing tests; keep the existing `getSettings`/`updateSettings` mocks in each test as they are today — these new tests additionally mock the `google-calendar` module):
```tsx
import * as googleCalendarApi from '../api/google-calendar';

// ...inside the existing describe block:

it('shows "Connect Google Calendar" when not connected, and starts the OAuth flow', async () => {
  vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
    houseRulesText: 'Rules',
    paymentInstructions: 'Pay',
    bookingIcalUrl: null,
    airbnbIcalUrl: null,
    lastChannelSyncAt: null,
    lastChannelSyncError: null,
  });
  vi.spyOn(googleCalendarApi, 'getGoogleCalendarStatus').mockResolvedValue({
    connected: false,
    lastSyncAt: null,
    lastSyncError: null,
  });
  const connectUrlSpy = vi
    .spyOn(googleCalendarApi, 'getGoogleCalendarConnectUrl')
    .mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth?mock=1' });

  render(<SettingsPage />);

  const connectButton = await screen.findByRole('button', { name: /connect google calendar/i });
  fireEvent.click(connectButton);

  await waitFor(() => expect(connectUrlSpy).toHaveBeenCalled());
  // Not asserting on window.location.href itself: jsdom's handling of location reassignment
  // is version-sensitive and not something this codebase's tests rely on elsewhere. Knowing
  // the connect-url call happened is enough — the `window.location.href = url` line in the
  // handler is a trivial one-liner once that call resolves.
});

it('shows connected status with Disconnect and Sync now when connected', async () => {
  vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
    houseRulesText: 'Rules',
    paymentInstructions: 'Pay',
    bookingIcalUrl: null,
    airbnbIcalUrl: null,
    lastChannelSyncAt: null,
    lastChannelSyncError: null,
  });
  vi.spyOn(googleCalendarApi, 'getGoogleCalendarStatus').mockResolvedValue({
    connected: true,
    lastSyncAt: '2026-09-13T12:00:00.000Z',
    lastSyncError: null,
  });
  const disconnectSpy = vi.spyOn(googleCalendarApi, 'disconnectGoogleCalendar').mockResolvedValue({ disconnected: true });
  const syncSpy = vi.spyOn(googleCalendarApi, 'runGoogleCalendarSync').mockResolvedValue({ triggeredAt: '2026-09-13T12:05:00.000Z' });

  render(<SettingsPage />);

  expect(await screen.findByRole('button', { name: /disconnect/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /sync google calendar now/i }));
  await waitFor(() => expect(syncSpy).toHaveBeenCalled());

  fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
  await waitFor(() => expect(disconnectSpy).toHaveBeenCalled());
});
```

Note: this file already has a "Sync now" button for channel sync from sub-project 3. The Google Calendar section's button is labeled "Sync Google Calendar now" (see Step 4) specifically so the two buttons have distinct accessible names — `getByRole('button', { name: /sync now/i })` would otherwise match both and fail with a "multiple elements found" error.

- [ ] **Step 3: Run them and confirm they fail**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement the Google Calendar section**

Add state to `SettingsPage.tsx`, alongside the existing channel-sync state:
```tsx
const [googleConnected, setGoogleConnected] = useState(false);
const [googleLastSyncAt, setGoogleLastSyncAt] = useState<string | null>(null);
const [googleLastSyncError, setGoogleLastSyncError] = useState<string | null>(null);
const [googleActionError, setGoogleActionError] = useState<string | null>(null);
const [googleSyncing, setGoogleSyncing] = useState(false);
```

Add the import:
```tsx
import {
  getGoogleCalendarStatus,
  getGoogleCalendarConnectUrl,
  disconnectGoogleCalendar,
  runGoogleCalendarSync,
} from '../api/google-calendar';
```

In the existing load `useEffect` (or a new one alongside it), fetch the Google Calendar status too:
```tsx
useEffect(() => {
  getGoogleCalendarStatus()
    .then((status) => {
      setGoogleConnected(status.connected);
      setGoogleLastSyncAt(status.lastSyncAt);
      setGoogleLastSyncError(status.lastSyncError);
    })
    .catch(() => {
      // Status is a secondary concern to the main Settings form — fail silently, the
      // section below simply won't have anything to show.
    });
}, []);
```

Add the handlers:
```tsx
async function handleConnectGoogleCalendar() {
  setGoogleActionError(null);
  try {
    const { url } = await getGoogleCalendarConnectUrl();
    window.location.href = url;
  } catch {
    setGoogleActionError('Could not start the Google Calendar connection. Please try again.');
  }
}

async function handleDisconnectGoogleCalendar() {
  setGoogleActionError(null);
  try {
    await disconnectGoogleCalendar();
    setGoogleConnected(false);
  } catch {
    setGoogleActionError('Could not disconnect Google Calendar. Please try again.');
  }
}

async function handleSyncGoogleCalendarNow() {
  setGoogleActionError(null);
  setGoogleSyncing(true);
  try {
    await runGoogleCalendarSync();
    const status = await getGoogleCalendarStatus();
    setGoogleLastSyncAt(status.lastSyncAt);
    setGoogleLastSyncError(status.lastSyncError);
  } catch {
    setGoogleActionError('Could not trigger the sync. Please try again.');
  } finally {
    setGoogleSyncing(false);
  }
}
```

Add a new section to the JSX, after the existing "Channel sync" `<section>`:
```tsx
<section>
  <h2>Google Calendar</h2>
  {googleActionError && <p role="alert">{googleActionError}</p>}
  {googleConnected ? (
    <>
      {googleLastSyncError ? (
        <p role="alert">Last sync failed: {googleLastSyncError}</p>
      ) : (
        <p>Connected — last synced: {googleLastSyncAt ? new Date(googleLastSyncAt).toLocaleString() : 'never'}</p>
      )}
      <button type="button" onClick={handleSyncGoogleCalendarNow} disabled={googleSyncing}>
        Sync Google Calendar now
      </button>
      <button type="button" onClick={handleDisconnectGoogleCalendar}>
        Disconnect
      </button>
    </>
  ) : (
    <>
      <p>Not connected.</p>
      <button type="button" onClick={handleConnectGoogleCalendar}>
        Connect Google Calendar
      </button>
    </>
  )}
</section>
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 7: Verify manually**

This is the one part of this feature that cannot be exercised in CI — it needs a real Google Cloud OAuth client and a real Google account:
1. In Google Cloud Console, create an OAuth 2.0 Client ID (type "Web application"), add `http://localhost:3001/google-calendar/oauth/callback` as an authorized redirect URI, and enable the Google Calendar API for the project.
2. Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in the repo-root `.env` to the real values, then `docker compose restart api`.
3. Run `docker compose up -d --build admin-web api`, open the admin Settings page, click "Connect Google Calendar", complete Google's consent screen, and confirm it redirects back showing "Connected".
4. Create a `DIRECT` reservation in the admin app — confirm an event appears on the newly created "La Brisa de Mar del Plata - Reservations" calendar in Google Calendar.
5. Edit that event's title and dates directly in Google Calendar, then click "Sync Google Calendar now" in the admin app — confirm the reservation's guest name and dates updated.
6. Delete that event directly in Google Calendar, sync again — confirm the reservation is now `CANCELLED`.
7. Create a `BOOKING` or `AIRBNB` reservation (or use an existing one), confirm its event appears on the calendar, edit that event directly in Google Calendar, sync again — confirm the reservation is UNCHANGED (pull-immunity holds).

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/api/google-calendar.ts admin-web/src/settings
git commit -m "Add Google Calendar connect/disconnect/sync UI to the Settings page"
```
