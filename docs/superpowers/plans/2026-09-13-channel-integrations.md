# Channel Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync bookings from Booking.com and Airbnb into the app via their public iCal calendar feeds (blocked date ranges only — no partner API access needed), so every reservation across every channel is visible in one place, flagged if it disappears from its source calendar, and checked for date overlaps against manual entries.

**Architecture:** Extends the existing `api`/`admin-web` stack from sub-projects 1-2. `api` gains a `ChannelSyncService` (fetch + parse iCal via `node-ical`, create/reconcile `Reservation` rows), a scheduled job (`@nestjs/schedule`) plus a manual trigger endpoint sharing the same code path, and an overlap-check endpoint. `admin-web` gains Settings fields for the two feed URLs, a "Sync now" button, a missing-from-channel warning, and a date-overlap warning in the reservation form. No new service, no guest-web changes, no OAuth.

**Tech Stack:** Same as prior sub-projects (NestJS, Prisma, PostgreSQL, React+Vite, Jest/Supertest, Vitest/RTL), plus `node-ical` (iCal parsing) and `@nestjs/schedule` (cron).

**Spec:** `docs/superpowers/specs/2026-09-13-channel-integrations-design.md`

## Global Constraints

- iCal feeds only reveal blocked date ranges — no guest name, contact, pax count, or price. Sync-created reservations use placeholder values (`guestName: "Booking.com Guest"`/`"Airbnb Guest"`, `paxCount: 1`, `totalAmount: 0`, `currency: "ARS"`, `status: PENDING`) and staff fill in the rest manually.
- A sync only creates new reservations or clears/sets `missingFromChannelAt` — it NEVER overwrites guest details, dates, or status on an existing synced reservation.
- A fetch/parse failure for one platform must never affect the other platform's sync, and must never touch any `Reservation` row (a failed fetch is never treated the same as "booking disappeared").
- Sync-created reservations write directly through Prisma, not through `ReservationsService.create()`/`CreateReservationDto` — the DTO's `@IsPositive()` on `totalAmount` would reject the placeholder `0` value, and this is an internal system write, not an HTTP-validated one.
- The overlap check is advisory only — it never blocks saving a reservation.
- `externalReference` (from sub-project 1) is reused to store the iCal event's UID for BOOKING/AIRBNB-sourced reservations.

---

### Task 1: Prisma schema — Settings sync fields, Reservation missing-flag field

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/...` (via `prisma migrate dev`)
- Create: `api/test/channel-integrations-schema.e2e-spec.ts`

**Interfaces:**
- Produces: `Settings.bookingIcalUrl`, `Settings.airbnbIcalUrl`, `Settings.lastChannelSyncAt`, `Settings.lastChannelSyncError`, `Reservation.missingFromChannelAt` — consumed by every later task in this plan.

- [ ] **Step 1: Add the new fields to `api/prisma/schema.prisma`**

Modify the existing `Settings` model — add these fields (keep `houseRulesText`/`paymentInstructions`/`updatedAt` unchanged):
```prisma
model Settings {
  id                   String    @id
  houseRulesText       String
  paymentInstructions  String
  bookingIcalUrl       String?
  airbnbIcalUrl        String?
  lastChannelSyncAt    DateTime?
  lastChannelSyncError String?
  updatedAt            DateTime  @updatedAt
}
```

Modify the existing `Reservation` model — add this one field (keep every existing field from sub-projects 1-2 unchanged):
```prisma
model Reservation {
  // ...all existing fields stay exactly as they are...

  missingFromChannelAt DateTime?
}
```

- [ ] **Step 2: Generate and run the migration**

Run:
```bash
docker compose exec api npx prisma migrate dev --name channel_integrations
```
Expected: a new folder under `api/prisma/migrations/`, migration applied successfully.

- [ ] **Step 3: Write a schema smoke test**

`api/test/channel-integrations-schema.e2e-spec.ts`:
```typescript
import { PrismaClient } from '@prisma/client';

describe('Channel integrations schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sets and reads the new Settings sync fields', async () => {
    const settings = await prisma.settings.upsert({
      where: { id: 'schema-test-singleton' },
      update: {},
      create: {
        id: 'schema-test-singleton',
        houseRulesText: 'No parties.',
        paymentInstructions: 'Bank X.',
        bookingIcalUrl: 'https://booking.example/cal.ics',
        airbnbIcalUrl: 'https://airbnb.example/cal.ics',
        lastChannelSyncAt: new Date(),
        lastChannelSyncError: null,
      },
    });

    expect(settings.bookingIcalUrl).toBe('https://booking.example/cal.ics');
    expect(settings.airbnbIcalUrl).toBe('https://airbnb.example/cal.ics');

    await prisma.settings.delete({ where: { id: 'schema-test-singleton' } });
  });

  it('sets and clears missingFromChannelAt on a Reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'BOOKING',
        totalAmount: 0,
        currency: 'ARS',
        missingFromChannelAt: new Date(),
      },
    });

    expect(reservation.missingFromChannelAt).not.toBeNull();

    const cleared = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { missingFromChannelAt: null },
    });

    expect(cleared.missingFromChannelAt).toBeNull();

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

- [ ] **Step 5: Commit**

```bash
git add api/prisma api/test/channel-integrations-schema.e2e-spec.ts
git commit -m "Add channel sync fields to Settings and missingFromChannelAt to Reservation"
```

---

### Task 2: ChannelSyncService — iCal fetch, parse, and reconciliation

**Files:**
- Create: `api/src/channel-sync/channel-sync.module.ts`, `channel-sync.service.ts`, `channel-sync.service.spec.ts`
- Modify: `api/package.json`

**Interfaces:**
- Consumes: `PrismaService`, `SettingsService.get()` (sub-project 2), `EmailService.sendAlert()` (sub-project 2).
- Produces: `ChannelSyncService.syncAll(): Promise<void>` — consumed by Task 3 (scheduler + manual endpoint).

- [ ] **Step 1: Install `node-ical`**

Run:
```bash
docker compose exec api npm install node-ical
docker compose restart api
```
If the default/latest version pulls in something incompatible with this project's CJS/Jest setup (as has happened with other fast-moving packages in this project), pin to a compatible version, verify it works, and note it in your report.

- [ ] **Step 2: Write the failing `ChannelSyncService` tests**

`api/src/channel-sync/channel-sync.service.spec.ts`:
```typescript
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec api npm test -- channel-sync.service.spec.ts`
Expected: FAIL (`Cannot find module './channel-sync.service'`)

- [ ] **Step 4: Implement `ChannelSyncService` and its module**

`api/src/channel-sync/channel-sync.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import * as ical from 'node-ical';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailService } from '../email/email.service';
import { ReservationSource } from '@prisma/client';

interface PlatformConfig {
  source: ReservationSource;
  icalUrl: string | null;
  guestNamePlaceholder: string;
  displayName: string;
}

@Injectable()
export class ChannelSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  async syncAll(): Promise<void> {
    const settings = await this.settingsService.get();
    const errors: string[] = [];

    const platforms: PlatformConfig[] = [
      {
        source: 'BOOKING',
        icalUrl: settings.bookingIcalUrl,
        guestNamePlaceholder: 'Booking.com Guest',
        displayName: 'Booking.com',
      },
      {
        source: 'AIRBNB',
        icalUrl: settings.airbnbIcalUrl,
        guestNamePlaceholder: 'Airbnb Guest',
        displayName: 'Airbnb',
      },
    ];

    for (const platform of platforms) {
      try {
        await this.syncPlatform(platform);
      } catch (error) {
        errors.push(`${platform.displayName}: ${(error as Error).message}`);
      }
    }

    const errorMessage = errors.length > 0 ? errors.join('; ') : null;

    await this.prisma.settings.update({
      where: { id: 'singleton' },
      data: { lastChannelSyncAt: new Date(), lastChannelSyncError: errorMessage },
    });

    if (errorMessage) {
      await this.emailService.sendAlert('Channel sync failed', errorMessage);
    }
  }

  private async syncPlatform(config: PlatformConfig): Promise<void> {
    if (!config.icalUrl) {
      return;
    }

    const parsed = await ical.async.fromURL(config.icalUrl);

    const events = Object.values(parsed).filter(
      (component): component is ical.VEvent => component.type === 'VEVENT',
    );
    const currentUids = new Set(events.map((event) => event.uid));

    for (const event of events) {
      const existing = await this.prisma.reservation.findFirst({
        where: { source: config.source, externalReference: event.uid },
      });

      if (existing) {
        if (existing.missingFromChannelAt) {
          await this.prisma.reservation.update({
            where: { id: existing.id },
            data: { missingFromChannelAt: null },
          });
        }
        continue;
      }

      await this.prisma.reservation.create({
        data: {
          guestName: config.guestNamePlaceholder,
          checkIn: event.start,
          checkOut: event.end,
          paxCount: 1,
          source: config.source,
          externalReference: event.uid,
          totalAmount: 0,
          currency: 'ARS',
          status: 'PENDING',
          notes: `Auto-created from ${config.displayName} calendar sync. Please add the guest's real contact info.`,
        },
      });
    }

    const existingSynced = await this.prisma.reservation.findMany({
      where: { source: config.source, externalReference: { not: null } },
    });

    for (const reservation of existingSynced) {
      const stillPresent = reservation.externalReference && currentUids.has(reservation.externalReference);
      if (!stillPresent && !reservation.missingFromChannelAt) {
        await this.prisma.reservation.update({
          where: { id: reservation.id },
          data: { missingFromChannelAt: new Date() },
        });
      }
    }
  }
}
```

`api/src/channel-sync/channel-sync.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ChannelSyncService } from './channel-sync.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [ChannelSyncService],
  exports: [ChannelSyncService],
})
export class ChannelSyncModule {}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- channel-sync.service.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src/channel-sync api/package.json api/package-lock.json
git commit -m "Add ChannelSyncService for Booking.com/Airbnb iCal reconciliation"
```

---

### Task 3: Scheduled sync job + manual sync endpoint

**Files:**
- Create: `api/src/channel-sync/channel-sync-scheduler.service.ts`, `channel-sync-scheduler.service.spec.ts`, `channel-sync.controller.ts`
- Modify: `api/src/channel-sync/channel-sync.module.ts`, `api/src/app.module.ts`, `api/package.json`
- Create: `api/test/channel-sync.e2e-spec.ts`

**Interfaces:**
- Consumes: `ChannelSyncService.syncAll()` (Task 2).
- Produces: `POST /channel-sync/run` (JWT-guarded) — consumed by Task 5 (admin-web "Sync now" button).

- [ ] **Step 1: Install `@nestjs/schedule`**

Run:
```bash
docker compose exec api npm install @nestjs/schedule
docker compose restart api
```

- [ ] **Step 2: Write the failing scheduler test**

`api/src/channel-sync/channel-sync-scheduler.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ChannelSyncSchedulerService } from './channel-sync-scheduler.service';
import { ChannelSyncService } from './channel-sync.service';

describe('ChannelSyncSchedulerService', () => {
  it('calls ChannelSyncService.syncAll on its scheduled handler', async () => {
    const syncAll = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncSchedulerService,
        { provide: ChannelSyncService, useValue: { syncAll } },
      ],
    }).compile();

    const scheduler = moduleRef.get(ChannelSyncSchedulerService);
    await scheduler.handleScheduledSync();

    expect(syncAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec api npm test -- channel-sync-scheduler.service.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement the scheduler and the manual-trigger controller**

`api/src/channel-sync/channel-sync-scheduler.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChannelSyncService } from './channel-sync.service';

@Injectable()
export class ChannelSyncSchedulerService {
  constructor(private readonly channelSyncService: ChannelSyncService) {}

  @Cron('*/30 * * * *')
  async handleScheduledSync(): Promise<void> {
    await this.channelSyncService.syncAll();
  }
}
```

`api/src/channel-sync/channel-sync.controller.ts`:
```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChannelSyncService } from './channel-sync.service';

@UseGuards(JwtAuthGuard)
@Controller('channel-sync')
export class ChannelSyncController {
  constructor(private readonly channelSyncService: ChannelSyncService) {}

  @Post('run')
  async run() {
    await this.channelSyncService.syncAll();
    return { triggeredAt: new Date() };
  }
}
```

Modify `api/src/channel-sync/channel-sync.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ChannelSyncController } from './channel-sync.controller';
import { ChannelSyncService } from './channel-sync.service';
import { ChannelSyncSchedulerService } from './channel-sync-scheduler.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [ChannelSyncController],
  providers: [ChannelSyncService, ChannelSyncSchedulerService],
  exports: [ChannelSyncService],
})
export class ChannelSyncModule {}
```

Modify `api/src/app.module.ts`: add `ScheduleModule.forRoot()` (imported from `@nestjs/schedule`) and `ChannelSyncModule` to the `imports` array.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- channel-sync-scheduler.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Write the e2e test for the manual sync endpoint**

`api/test/channel-sync.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ChannelSyncController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-channel-sync@labrisa.com.ar';
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
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-channel-sync@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).post('/channel-sync/run').expect(401);
  });

  it('triggers a sync and returns a timestamp (both feed URLs unset in this test env, so it succeeds as a no-op)', async () => {
    const response = await request(app.getHttpServer())
      .post('/channel-sync/run')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(response.body.triggeredAt).toBeTruthy();
  });
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
git add api/src/channel-sync api/src/app.module.ts api/test/channel-sync.e2e-spec.ts api/package.json api/package-lock.json
git commit -m "Add scheduled and manual channel sync triggers"
```

---

### Task 4: Reservation overlap-check endpoint

**Files:**
- Modify: `api/src/reservations/reservations.service.ts`, `reservations.controller.ts`, `reservations.service.spec.ts`
- Create: `api/src/reservations/dto/check-overlap.dto.ts`
- Modify: `api/test/reservations.e2e-spec.ts`

**Interfaces:**
- Produces: `ReservationsService.checkOverlap(checkIn: string, checkOut: string, excludeId?: string)`, route `GET /reservations/check-overlap?checkIn=&checkOut=&excludeId=` (JWT-guarded) — consumed by Task 7 (admin-web reservation form).

- [ ] **Step 1: Write the failing test**

Add to `api/src/reservations/reservations.service.spec.ts` (nested inside the existing `describe('ReservationsService', ...)` block, sharing its `service`/`prisma` from the shared `beforeEach` — same pattern established in sub-project 2's Task 6):
```typescript
describe('checkOverlap', () => {
  it('queries for non-cancelled reservations overlapping the given range', async () => {
    prisma.reservation.findMany.mockResolvedValue([{ id: 'res-1' }]);

    const result = await service.checkOverlap('2026-05-02', '2026-05-04');

    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      where: {
        id: undefined,
        status: { not: 'CANCELLED' },
        checkIn: { lt: new Date('2026-05-04') },
        checkOut: { gt: new Date('2026-05-02') },
      },
    });
    expect(result).toEqual([{ id: 'res-1' }]);
  });

  it('excludes the given id when editing an existing reservation', async () => {
    prisma.reservation.findMany.mockResolvedValue([]);

    await service.checkOverlap('2026-05-02', '2026-05-04', 'res-1');

    expect(prisma.reservation.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { not: 'res-1' } }),
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: FAIL (`checkOverlap` doesn't exist yet)

- [ ] **Step 3: Implement the DTO and service method**

`api/src/reservations/dto/check-overlap.dto.ts`:
```typescript
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CheckOverlapDto {
  @IsDateString()
  checkIn: string;

  @IsDateString()
  checkOut: string;

  @IsOptional()
  @IsString()
  excludeId?: string;
}
```

Add to `api/src/reservations/reservations.service.ts` (inside the existing `ReservationsService` class):
```typescript
checkOverlap(checkIn: string, checkOut: string, excludeId?: string) {
  return this.prisma.reservation.findMany({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      status: { not: 'CANCELLED' },
      checkIn: { lt: new Date(checkOut) },
      checkOut: { gt: new Date(checkIn) },
    },
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: PASS (all original tests + the 2 new checkOverlap tests)

- [ ] **Step 5: Add the controller route**

Add to `api/src/reservations/reservations.controller.ts`. **Route ordering matters**: this route must be declared BEFORE the existing `@Get(':id')` route, otherwise Nest matches `/reservations/check-overlap` to the `:id` param route with `id="check-overlap"` first.
```typescript
@Get('check-overlap')
checkOverlap(@Query() query: CheckOverlapDto) {
  return this.reservationsService.checkOverlap(query.checkIn, query.checkOut, query.excludeId);
}
```
Add the corresponding import: `import { CheckOverlapDto } from './dto/check-overlap.dto';` and ensure `Query` is imported from `@nestjs/common` alongside the controller's existing imports.

- [ ] **Step 6: Write the e2e test**

Add to `api/test/reservations.e2e-spec.ts` (reusing its existing auth setup):
```typescript
it('finds overlapping reservations and respects excludeId', async () => {
  const first = await request(app.getHttpServer())
    .post('/reservations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      guestName: 'Overlap E2E Guest',
      checkIn: '2026-07-01',
      checkOut: '2026-07-10',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
    })
    .expect(201);

  const overlapResponse = await request(app.getHttpServer())
    .get('/reservations/check-overlap?checkIn=2026-07-05&checkOut=2026-07-08')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  expect(overlapResponse.body.some((r: { id: string }) => r.id === first.body.id)).toBe(true);

  const excludedResponse = await request(app.getHttpServer())
    .get(`/reservations/check-overlap?checkIn=2026-07-05&checkOut=2026-07-08&excludeId=${first.body.id}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  expect(excludedResponse.body.some((r: { id: string }) => r.id === first.body.id)).toBe(false);
});
```
Add cleanup for `guestName: 'Overlap E2E Guest'` to the file's existing `afterAll`.

- [ ] **Step 7: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 8: Commit**

```bash
git add api/src/reservations api/test/reservations.e2e-spec.ts
git commit -m "Add reservation date-overlap check endpoint"
```

---

### Task 5: Admin-web — Settings page additions (iCal URLs, sync status, Sync now)

**Files:**
- Modify: `admin-web/src/api/settings.ts`, `admin-web/src/settings/SettingsPage.tsx`, `admin-web/src/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: extended `GET/PUT /settings` response shape (Task 1), `POST /channel-sync/run` (Task 3).
- Produces: nothing consumed by later tasks — leaf feature.

- [ ] **Step 1: Read the current `SettingsPage.tsx` and `settings.ts` first**

These files already have `loadError`/`saveError` state and try/catch around load/save (added during sub-project 2's final-review fix wave). Your additions must integrate with that existing pattern, not replace it — the two new URL fields are part of the same `Settings` object and go through the same load/save flow; only the "Sync now" action needs its own new error state.

- [ ] **Step 2: Extend the `Settings` interface and add `runChannelSync`**

Modify `admin-web/src/api/settings.ts` — add to the existing `Settings` interface:
```typescript
bookingIcalUrl: string | null;
airbnbIcalUrl: string | null;
lastChannelSyncAt: string | null;
lastChannelSyncError: string | null;
```

Add a new function in the same file:
```typescript
export function runChannelSync(): Promise<{ triggeredAt: string }> {
  return apiClient.request('/channel-sync/run', { method: 'POST' });
}
```

- [ ] **Step 3: Write the failing test for the new controls**

Add to `admin-web/src/settings/SettingsPage.test.tsx` (alongside the existing test):
```tsx
it('loads and displays iCal URLs and sync status, and triggers a sync', async () => {
  vi.spyOn(settingsApi, 'getSettings')
    .mockResolvedValueOnce({
      houseRulesText: 'Rules',
      paymentInstructions: 'Pay',
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    })
    .mockResolvedValueOnce({
      houseRulesText: 'Rules',
      paymentInstructions: 'Pay',
      bookingIcalUrl: 'https://booking.example/cal.ics',
      airbnbIcalUrl: null,
      lastChannelSyncAt: '2026-09-13T12:00:00.000Z',
      lastChannelSyncError: null,
    });
  const syncSpy = vi.spyOn(settingsApi, 'runChannelSync').mockResolvedValue({ triggeredAt: '2026-09-13T12:00:00.000Z' });

  render(<SettingsPage />);

  await waitFor(() => expect(screen.getByLabelText(/booking\.com ical url/i)).toHaveValue('https://booking.example/cal.ics'));

  fireEvent.click(screen.getByRole('button', { name: /sync now/i }));

  await waitFor(() => expect(syncSpy).toHaveBeenCalled());
  expect(await screen.findByText(/last synced/i)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 5: Implement the additions in `SettingsPage.tsx`**

Add state alongside the existing `houseRulesText`/`paymentInstructions` state:
```tsx
const [bookingIcalUrl, setBookingIcalUrl] = useState('');
const [airbnbIcalUrl, setAirbnbIcalUrl] = useState('');
const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
const [lastSyncError, setLastSyncError] = useState<string | null>(null);
const [syncing, setSyncing] = useState(false);
const [syncActionError, setSyncActionError] = useState<string | null>(null);
```

In the existing load effect, alongside setting `houseRulesText`/`paymentInstructions`, also set:
```tsx
setBookingIcalUrl(settings.bookingIcalUrl ?? '');
setAirbnbIcalUrl(settings.airbnbIcalUrl ?? '');
setLastSyncAt(settings.lastChannelSyncAt);
setLastSyncError(settings.lastChannelSyncError);
```

In the existing submit handler, include the two new fields in the `updateSettings(...)` payload alongside `houseRulesText`/`paymentInstructions`.

Add a new handler:
```tsx
async function handleSyncNow() {
  setSyncActionError(null);
  setSyncing(true);
  try {
    await runChannelSync();
    const settings = await getSettings();
    setLastSyncAt(settings.lastChannelSyncAt);
    setLastSyncError(settings.lastChannelSyncError);
  } catch {
    setSyncActionError('Could not trigger the sync. Please try again.');
  } finally {
    setSyncing(false);
  }
}
```

Add to the JSX, inside the existing form, near the other fields:
```tsx
<label>
  Booking.com iCal URL
  <input value={bookingIcalUrl} onChange={(e) => setBookingIcalUrl(e.target.value)} />
</label>
<label>
  Airbnb iCal URL
  <input value={airbnbIcalUrl} onChange={(e) => setAirbnbIcalUrl(e.target.value)} />
</label>
```

Add outside/after the form (a separate action, not part of the save-settings submit):
```tsx
<section>
  <h2>Channel sync</h2>
  {lastSyncError ? (
    <p role="alert">Last sync failed: {lastSyncError}</p>
  ) : (
    <p>Last synced: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never'}</p>
  )}
  {syncActionError && <p role="alert">{syncActionError}</p>}
  <button type="button" onClick={handleSyncNow} disabled={syncing}>
    Sync now
  </button>
</section>
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: PASS (both the original test and the new one)

- [ ] **Step 7: Run the full admin-web suite and confirm no regressions**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/api/settings.ts admin-web/src/settings
git commit -m "Add channel sync settings and manual sync trigger to the Settings page"
```

---

### Task 6: Admin-web — missing-from-channel warning

**Files:**
- Modify: `admin-web/src/reservations/types.ts`, `admin-web/src/reservations/ReservationListPage.tsx`, `admin-web/src/reservations/ReservationListPage.test.tsx`, `admin-web/src/reservations/ReservationFormPage.tsx`, `admin-web/src/reservations/ReservationFormPage.test.tsx`

**Interfaces:**
- Consumes: `Reservation.missingFromChannelAt` (Task 1), already present on API responses once Task 1 ships.
- Produces: nothing consumed by later tasks — leaf feature.

- [ ] **Step 1: Extend the `Reservation` type**

Add to the existing `Reservation` interface in `admin-web/src/reservations/types.ts`:
```typescript
missingFromChannelAt?: string | null;
```

- [ ] **Step 2: Write the failing tests**

Add to `admin-web/src/reservations/ReservationListPage.test.tsx` (alongside the existing tests):
```tsx
it('shows a warning badge for a reservation missing from its channel feed', async () => {
  vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
    {
      id: '1',
      guestName: 'Jane Doe',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'BOOKING',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'PENDING',
      missingFromChannelAt: '2026-01-01T00:00:00.000Z',
    },
  ]);

  render(
    <MemoryRouter>
      <ReservationListPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText(/no longer in channel feed/i)).toBeInTheDocument();
});
```

Add to `admin-web/src/reservations/ReservationFormPage.test.tsx` (alongside the existing tests):
```tsx
it('shows a warning banner when editing a reservation missing from its channel feed', async () => {
  vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
    id: '1',
    guestName: 'Jane Doe',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'BOOKING',
    totalAmount: 100000,
    currency: 'ARS',
    status: 'PENDING',
    confirmationToken: 'tok-1',
    missingFromChannelAt: '2026-01-01T00:00:00.000Z',
  } as never);
  vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);

  render(
    <MemoryRouter initialEntries={['/reservations/1']}>
      <Routes>
        <Route path="/reservations/:id" element={<ReservationFormPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText(/no longer found in the channel's calendar/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run:
```bash
docker compose exec admin-web npx vitest run src/reservations/ReservationListPage.test.tsx
docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx
```
Expected: both FAIL

- [ ] **Step 4: Implement the warnings**

In `admin-web/src/reservations/ReservationListPage.tsx`, in the table row rendering (where `r.guestName` is shown), add a conditional badge:
```tsx
{r.missingFromChannelAt && <span> ⚠ No longer in channel feed</span>}
```

In `admin-web/src/reservations/ReservationFormPage.tsx`, inside the `isEditing && reservationRecord` block (alongside the onboarding progress section from sub-project 2), add:
```tsx
{reservationRecord.missingFromChannelAt && (
  <p role="alert">
    No longer found in the channel's calendar as of{' '}
    {new Date(reservationRecord.missingFromChannelAt).toLocaleString()} — confirm with the guest or cancel this
    reservation.
  </p>
)}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:
```bash
docker compose exec admin-web npx vitest run src/reservations/ReservationListPage.test.tsx
docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx
```
Expected: both PASS

- [ ] **Step 6: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/reservations
git commit -m "Show a warning when a reservation is missing from its channel feed"
```

---

### Task 7: Admin-web — reservation form date-overlap warning

**Files:**
- Modify: `admin-web/src/api/reservations.ts`, `admin-web/src/reservations/ReservationFormPage.tsx`, `admin-web/src/reservations/ReservationFormPage.test.tsx`

**Interfaces:**
- Consumes: `GET /reservations/check-overlap` (Task 4).
- Produces: nothing consumed by later tasks — final task of this plan.

- [ ] **Step 1: Add the API function**

Add to `admin-web/src/api/reservations.ts`:
```typescript
export function checkOverlap(checkIn: string, checkOut: string, excludeId?: string): Promise<Reservation[]> {
  const params = new URLSearchParams({ checkIn, checkOut });
  if (excludeId) {
    params.set('excludeId', excludeId);
  }
  return apiClient.request(`/reservations/check-overlap?${params.toString()}`);
}
```

- [ ] **Step 2: Write the failing test**

Add to `admin-web/src/reservations/ReservationFormPage.test.tsx`:
```tsx
it('shows a warning when the entered dates overlap an existing reservation', async () => {
  const overlapSpy = vi.spyOn(reservationsApi, 'checkOverlap').mockResolvedValue([
    { id: '2', guestName: 'Other Guest', checkIn: '2026-01-12', checkOut: '2026-01-16', source: 'AIRBNB' } as never,
  ]);

  render(
    <MemoryRouter initialEntries={['/reservations/new']}>
      <Routes>
        <Route path="/reservations/new" element={<ReservationFormPage />} />
      </Routes>
    </MemoryRouter>,
  );

  fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
  fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });

  await waitFor(() => expect(overlapSpy).toHaveBeenCalledWith('2026-01-10', '2026-01-15', undefined));
  expect(await screen.findByText(/other guest/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement the overlap warning**

Add state and an effect inside `ReservationFormPage` (alongside the existing `form`/`reservationRecord` state):
```tsx
const [overlaps, setOverlaps] = useState<Reservation[]>([]);

useEffect(() => {
  if (!form.checkIn || !form.checkOut) {
    setOverlaps([]);
    return;
  }
  checkOverlap(form.checkIn, form.checkOut, id)
    .then(setOverlaps)
    .catch(() => setOverlaps([]));
}, [form.checkIn, form.checkOut, id]);
```

Add to the JSX, near the top of the form:
```tsx
{overlaps.length > 0 && (
  <div role="alert">
    <p>These dates overlap with existing reservation(s):</p>
    <ul>
      {overlaps.map((o) => (
        <li key={o.id}>
          {o.guestName} ({o.source}): {o.checkIn.slice(0, 10)} – {o.checkOut.slice(0, 10)}
        </li>
      ))}
    </ul>
  </div>
)}
```

Add the import: `checkOverlap` from `../api/reservations`.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: PASS (all tests in this file, including this new one)

- [ ] **Step 6: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 7: Verify manually**

Run: `docker compose up -d --build admin-web api`
Create two reservations with overlapping dates via the admin app — expected: the second one's form shows the overlap warning listing the first, but still allows saving.

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/api/reservations.ts admin-web/src/reservations
git commit -m "Add date-overlap warning to the reservation form"
```
