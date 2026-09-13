# Guest Onboarding Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the guest onboarding flow — a public, token-based confirmation page where guests confirm dates/pax, accept a digital contract, and see payment instructions for a 30% deposit + security deposit — with staff marking payments received in the admin app, an automatic status/email confirmation once everything is done, and a full audit log with failure alerting.

**Architecture:** Extends the existing `api`/`admin-web`/`guest-web` stack from sub-project 1. No new services. `api` gains a `Settings` singleton, a `ReservationEvent` audit log, an email module (Resend), a public unauthenticated API, and an auto-confirmation rule. `guest-web` gets a real confirmation page restyled to match `labrisa.com.ar`. `admin-web` gets a Settings page and reservation-detail additions.

**Tech Stack:** Same as sub-project 1 (NestJS, Prisma, PostgreSQL, React+Vite, Jest/Supertest, Vitest/RTL), plus the `resend` npm package for transactional email.

**Spec:** `docs/superpowers/specs/2026-09-13-guest-onboarding-workflow-design.md`

## Global Constraints

- No WhatsApp Business API, no payment gateway — messaging is link-based (staff can copy the guest link), payment confirmation is manual (staff marks it in the admin app).
- `ReservationEventType` enum (exact values): `DATES_CONFIRMED`, `CONTRACT_ACCEPTED`, `PAYMENT_RECEIVED`, `DEPOSIT_RECEIVED`, `DEPOSIT_RETURNED`, `RESERVATION_CONFIRMED`, `INITIAL_EMAIL_SENT`, `INITIAL_EMAIL_FAILED`, `FINAL_EMAIL_SENT`, `FINAL_EMAIL_FAILED`.
- Auto-confirmation rule: reservation `status` flips to `CONFIRMED` only when `datesConfirmedAt` + `contractAcceptedAt` + `confirmationPaymentReceivedAt` + `depositReceivedAt` are ALL set AND current `status` is `PENDING` (never overrides a manually-set `CANCELLED`/`COMPLETED`).
- Email failures never block the underlying state change; they write a `*_FAILED` event and trigger an alert email to `ALERT_EMAIL`.
- Admin mark-received/returned actions are idempotent (no-op if already set, not an error).
- Public guest endpoints require no authentication — access control is the unguessable `confirmationToken`. 404 (not 400/403) on an unknown token.
- Guest-web design tokens (from `labrisa.com.ar`'s live CSS): `--color-dark:#101010`, `--color-teal:#0bb4aa`, `--color-teal-dark:#089990`, `--color-bg:#f9fafd`, `--color-white:#ffffff`, `--color-grey:#6c6c77`, `--color-light-grey:#d9d9d9`, `--max-width:1140px`. Headings: Montserrat. Body/buttons/forms: Inter. Buttons: uppercase, bold, `0.08em` letter-spacing, `2px` border-radius, `0.85rem 2.5rem` padding.
- Any Vite env var consumed via `import.meta.env` must be baked in at Docker build time (`ARG`/`ENV` in the Dockerfile's build stage + `build.args` in `docker-compose.prod.yml`) — this was a real production bug in sub-project 1's final review; do not repeat it for `guest-web`'s new `VITE_API_URL` usage.

---

### Task 1: Prisma schema — Settings, ReservationEvent, Reservation onboarding fields

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/...` (via `prisma migrate dev`)
- Create: `api/test/onboarding-schema.e2e-spec.ts`

**Interfaces:**
- Produces: Prisma Client types `Settings`, `ReservationEvent`, `ReservationEventType`, and the new `Reservation` fields listed below — consumed by every later task in this plan.

- [ ] **Step 1: Add the new enum, models, and Reservation fields to `api/prisma/schema.prisma`**

Add below the existing `ReservationStatus` enum:
```prisma
enum ReservationEventType {
  DATES_CONFIRMED
  CONTRACT_ACCEPTED
  PAYMENT_RECEIVED
  DEPOSIT_RECEIVED
  DEPOSIT_RETURNED
  RESERVATION_CONFIRMED
  INITIAL_EMAIL_SENT
  INITIAL_EMAIL_FAILED
  FINAL_EMAIL_SENT
  FINAL_EMAIL_FAILED
}
```

Add new models:
```prisma
model Settings {
  id                  String   @id
  houseRulesText      String
  paymentInstructions String
  updatedAt           DateTime @updatedAt
}

model ReservationEvent {
  id            String               @id @default(uuid())
  reservationId String
  reservation   Reservation          @relation(fields: [reservationId], references: [id])
  type          ReservationEventType
  detail        String?
  createdAt     DateTime             @default(now())
}
```

Modify the existing `Reservation` model — add these fields (keep all existing fields from sub-project 1 unchanged) and the new relation:
```prisma
model Reservation {
  // ...existing fields from sub-project 1 stay exactly as they are...

  confirmationToken             String    @unique @default(uuid())
  datesConfirmedAt              DateTime?
  contractAcceptedAt            DateTime?
  contractAcceptedName          String?
  contractSnapshot              String?
  confirmationPaymentReceivedAt DateTime?
  depositReceivedAt             DateTime?
  depositReturnedAt             DateTime?
  confirmationEmailSentAt       DateTime?
  finalConfirmationEmailSentAt  DateTime?
  events                        ReservationEvent[]
}
```

- [ ] **Step 2: Generate and run the migration**

Run:
```bash
docker compose exec api npx prisma migrate dev --name guest_onboarding
```
Expected: a new folder under `api/prisma/migrations/`, migration applied successfully. If Prisma prompts about how to backfill `confirmationToken` for existing rows (since it's a new unique column with a client-side default), accept resetting the dev database — local dev data is disposable.

- [ ] **Step 3: Write a schema smoke test**

`api/test/onboarding-schema.e2e-spec.ts`:
```typescript
import { PrismaClient } from '@prisma/client';

describe('Guest onboarding schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a Reservation with a unique confirmationToken by default', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-04-01'),
        checkOut: new Date('2026-04-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    expect(reservation.confirmationToken).toBeTruthy();

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });

  it('creates and reads Settings and a ReservationEvent linked to a reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest 2',
        checkIn: new Date('2026-04-01'),
        checkOut: new Date('2026-04-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    const settings = await prisma.settings.create({
      data: { id: 'schema-test-singleton', houseRulesText: 'No parties.', paymentInstructions: 'Bank X.' },
    });
    expect(settings.houseRulesText).toBe('No parties.');

    const event = await prisma.reservationEvent.create({
      data: { reservationId: reservation.id, type: 'DATES_CONFIRMED' },
    });
    expect(event.reservationId).toBe(reservation.id);

    await prisma.reservationEvent.deleteMany({ where: { reservationId: reservation.id } });
    await prisma.reservation.delete({ where: { id: reservation.id } });
    await prisma.settings.delete({ where: { id: 'schema-test-singleton' } });
  });
});
```

- [ ] **Step 4: Run it**

Run:
```bash
docker compose exec api npm run test:e2e
```
Expected: all suites PASS, including the new `onboarding-schema.e2e-spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add api/prisma api/test/onboarding-schema.e2e-spec.ts
git commit -m "Add Settings and ReservationEvent models, onboarding fields on Reservation"
```

---

### Task 2: Settings module

**Files:**
- Create: `api/src/settings/settings.module.ts`, `settings.service.ts`, `settings.controller.ts`, `dto/update-settings.dto.ts`, `settings.service.spec.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (sub-project 1), `Settings` model (Task 1).
- Produces: `SettingsService.get(): Promise<Settings>` (creates a default singleton row on first call if none exists), `SettingsService.update(dto): Promise<Settings>` — both exported from `SettingsModule`, consumed by Task 5 (public API) and Task 7 (admin Settings page, via HTTP).

- [ ] **Step 1: Write the failing `SettingsService` test**

`api/src/settings/settings.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: { settings: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      settings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SettingsService);
  });

  it('creates default settings on first read if none exist', async () => {
    prisma.settings.findUnique.mockResolvedValue(null);
    prisma.settings.create.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'default rules',
      paymentInstructions: 'default payment info',
    });

    const result = await service.get();

    expect(prisma.settings.create).toHaveBeenCalled();
    expect(result.id).toBe('singleton');
  });

  it('returns existing settings without creating a new row', async () => {
    prisma.settings.findUnique.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'existing',
      paymentInstructions: 'existing',
    });

    await service.get();

    expect(prisma.settings.create).not.toHaveBeenCalled();
  });

  it('updates settings', async () => {
    prisma.settings.findUnique.mockResolvedValue({ id: 'singleton' });
    prisma.settings.update.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'new rules',
      paymentInstructions: 'new payment info',
    });

    const result = await service.update({ houseRulesText: 'new rules', paymentInstructions: 'new payment info' });

    expect(result.houseRulesText).toBe('new rules');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- settings.service.spec.ts`
Expected: FAIL (`Cannot find module './settings.service'`)

- [ ] **Step 3: Implement the DTO, service, controller, and module**

`api/src/settings/dto/update-settings.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class UpdateSettingsDto {
  @IsString()
  @MinLength(1)
  houseRulesText: string;

  @IsString()
  @MinLength(1)
  paymentInstructions: string;
}
```

`api/src/settings/settings.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const SETTINGS_ID = 'singleton';

const DEFAULT_HOUSE_RULES =
  'No parties or events. Please keep noise to a minimum after 10pm. Maximum occupancy must be respected. No smoking indoors.';

const DEFAULT_PAYMENT_INSTRUCTIONS =
  'Bank transfer details pending setup — please contact us directly for payment instructions.';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const settings = await this.prisma.settings.findUnique({ where: { id: SETTINGS_ID } });
    if (settings) {
      return settings;
    }

    return this.prisma.settings.create({
      data: {
        id: SETTINGS_ID,
        houseRulesText: DEFAULT_HOUSE_RULES,
        paymentInstructions: DEFAULT_PAYMENT_INSTRUCTIONS,
      },
    });
  }

  async update(dto: UpdateSettingsDto) {
    await this.get();
    return this.prisma.settings.update({
      where: { id: SETTINGS_ID },
      data: dto,
    });
  }
}
```

`api/src/settings/settings.controller.ts`:
```typescript
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get() {
    return this.settingsService.get();
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.update(dto);
  }
}
```

`api/src/settings/settings.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
```

Add `SettingsModule` to `api/src/app.module.ts` imports.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- settings.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify manually**

Run:
```bash
docker compose restart api
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" -d '{"email":"admin@labrisa.com.ar","password":"changeme"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
curl -s http://localhost:3001/settings -H "Authorization: Bearer $TOKEN"
```
Expected: JSON with `houseRulesText` and `paymentInstructions` (the defaults, auto-created on first call).

- [ ] **Step 6: Commit**

```bash
git add api/src/settings api/src/app.module.ts
git commit -m "Add Settings module for editable house rules and payment instructions"
```

---

### Task 3: ReservationEvent logging service

**Files:**
- Create: `api/src/reservation-events/reservation-events.module.ts`, `reservation-events.service.ts`, `reservation-events.service.spec.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ReservationEvent`/`ReservationEventType` (Task 1).
- Produces: `ReservationEventsService.record(reservationId: string, type: ReservationEventType, detail?: string): Promise<ReservationEvent>` and `.listForReservation(reservationId: string): Promise<ReservationEvent[]>`, exported globally (importable in any module without explicit `imports`) — consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

`api/src/reservation-events/reservation-events.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ReservationEventsService } from './reservation-events.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReservationEventsService', () => {
  let service: ReservationEventsService;
  let prisma: { reservationEvent: { create: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { reservationEvent: { create: jest.fn(), findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [ReservationEventsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ReservationEventsService);
  });

  it('records an event', async () => {
    prisma.reservationEvent.create.mockResolvedValue({ id: '1' });

    await service.record('res-1', 'DATES_CONFIRMED');

    expect(prisma.reservationEvent.create).toHaveBeenCalledWith({
      data: { reservationId: 'res-1', type: 'DATES_CONFIRMED', detail: undefined },
    });
  });

  it('records an event with a detail message', async () => {
    prisma.reservationEvent.create.mockResolvedValue({ id: '1' });

    await service.record('res-1', 'FINAL_EMAIL_FAILED', 'Resend timeout');

    expect(prisma.reservationEvent.create).toHaveBeenCalledWith({
      data: { reservationId: 'res-1', type: 'FINAL_EMAIL_FAILED', detail: 'Resend timeout' },
    });
  });

  it('lists events for a reservation ordered most-recent-first', async () => {
    prisma.reservationEvent.findMany.mockResolvedValue([]);

    await service.listForReservation('res-1');

    expect(prisma.reservationEvent.findMany).toHaveBeenCalledWith({
      where: { reservationId: 'res-1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- reservation-events.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the service and module**

`api/src/reservation-events/reservation-events.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { ReservationEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReservationEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(reservationId: string, type: ReservationEventType, detail?: string) {
    return this.prisma.reservationEvent.create({
      data: { reservationId, type, detail },
    });
  }

  listForReservation(reservationId: string) {
    return this.prisma.reservationEvent.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

`api/src/reservation-events/reservation-events.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { ReservationEventsService } from './reservation-events.service';

@Global()
@Module({
  providers: [ReservationEventsService],
  exports: [ReservationEventsService],
})
export class ReservationEventsModule {}
```

Add `ReservationEventsModule` to `api/src/app.module.ts` imports.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- reservation-events.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/reservation-events api/src/app.module.ts
git commit -m "Add ReservationEvent audit logging service"
```

---

### Task 4: Email module (Resend integration)

**Files:**
- Create: `api/src/email/email.module.ts`, `email.service.ts`, `email.service.spec.ts`
- Modify: `api/package.json`, `.env.example`

**Interfaces:**
- Consumes: `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL` env vars.
- Produces: `EmailService.sendInitialConfirmationEmail(to: string, guestName: string, confirmationUrl: string): Promise<void>`, `.sendFinalConfirmationEmail(to: string, guestName: string): Promise<void>`, `.sendAlert(subject: string, message: string): Promise<void>` — all throw on failure except `sendAlert` (best-effort, never throws). Exported globally. Consumed by Tasks 5 and 6.

- [ ] **Step 1: Install the Resend SDK**

Run:
```bash
docker compose exec api npm install resend
docker compose restart api
```

- [ ] **Step 2: Add email env vars**

Add to `.env.example`:
```
# Email (Resend)
RESEND_API_KEY=re_changeme
EMAIL_FROM=reservas@labrisa.com.ar
ALERT_EMAIL=admin@labrisa.com.ar
```

Add the same three lines to your local `.env` (with a real Resend API key once you have a Resend account — a placeholder key is fine for now since tests mock the SDK).

- [ ] **Step 3: Write the failing `EmailService` test**

`api/src/email/email.service.spec.ts`:
```typescript
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

import { Resend } from 'resend';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  let sendMock: jest.Mock;

  beforeEach(() => {
    process.env.EMAIL_FROM = 'reservas@labrisa.com.ar';
    process.env.ALERT_EMAIL = 'owner@labrisa.com.ar';
    service = new EmailService();
    sendMock = (Resend as unknown as jest.Mock).mock.results[
      (Resend as unknown as jest.Mock).mock.results.length - 1
    ].value.emails.send;
  });

  it('sends the initial confirmation email', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(
      service.sendInitialConfirmationEmail('guest@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc'),
    ).resolves.toBeUndefined();

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'guest@example.com' }));
  });

  it('throws when Resend returns an error for the initial email', async () => {
    sendMock.mockResolvedValue({ error: { message: 'bounced' } });

    await expect(
      service.sendInitialConfirmationEmail('bad@example.com', 'Jane Doe', 'https://reservas.labrisa.com.ar/r/abc'),
    ).rejects.toThrow('bounced');
  });

  it('sends the final confirmation email', async () => {
    sendMock.mockResolvedValue({ error: null });

    await expect(service.sendFinalConfirmationEmail('guest@example.com', 'Jane Doe')).resolves.toBeUndefined();
  });

  it('sendAlert never throws even if Resend fails', async () => {
    sendMock.mockRejectedValue(new Error('network error'));

    await expect(service.sendAlert('Something failed', 'details here')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `docker compose exec api npm test -- email.service.spec.ts`
Expected: FAIL (`Cannot find module './email.service'`)

- [ ] **Step 5: Implement the service and module**

`api/src/email/email.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly from = process.env.EMAIL_FROM as string;
  private readonly alertEmail = process.env.ALERT_EMAIL ?? process.env.ADMIN_SEED_EMAIL;

  async sendInitialConfirmationEmail(to: string, guestName: string, confirmationUrl: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Confirm your reservation at La Brisa de Mar del Plata',
      html: `<p>Hi ${guestName},</p><p>Please confirm your reservation and complete a few quick steps:</p><p><a href="${confirmationUrl}">${confirmationUrl}</a></p>`,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async sendFinalConfirmationEmail(to: string, guestName: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Your reservation is confirmed!',
      html: `<p>Hi ${guestName},</p><p>Your reservation at La Brisa de Mar del Plata is now fully confirmed. We look forward to hosting you!</p>`,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async sendAlert(subject: string, message: string): Promise<void> {
    if (!this.alertEmail) {
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.from,
        to: this.alertEmail,
        subject: `[Alert] ${subject}`,
        html: `<p>${message}</p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send alert email: ${(error as Error).message}`);
    }
  }
}
```

`api/src/email/email.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

Add `EmailModule` to `api/src/app.module.ts` imports.

- [ ] **Step 6: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- email.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add api/src/email api/package.json api/package-lock.json .env.example api/src/app.module.ts
git commit -m "Add Resend email service for onboarding notifications"
```

---

### Task 5: Auto-confirmation rule + public guest API

**Files:**
- Create: `api/src/reservation-confirmation/reservation-confirmation.module.ts`, `reservation-confirmation.service.ts`, `reservation-confirmation.service.spec.ts`
- Create: `api/src/public-reservations/public-reservations.module.ts`, `public-reservations.controller.ts`, `public-reservations.service.ts`, `dto/accept-contract.dto.ts`, `public-reservations.service.spec.ts`
- Create: `api/test/public-reservations.e2e-spec.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `SettingsService` (Task 2), `ReservationEventsService` (Task 3), `EmailService` (Task 4), `Reservation` onboarding fields (Task 1).
- Produces: `ReservationConfirmationService.maybeAutoConfirm(reservationId: string): Promise<void>` — consumed by this task's own public endpoints AND by Task 6's admin mark-received endpoints. Public routes: `GET /public/reservations/:token`, `POST /public/reservations/:token/confirm-dates`, `POST /public/reservations/:token/accept-contract`.

- [ ] **Step 1: Write the failing `ReservationConfirmationService` test**

`api/src/reservation-confirmation/reservation-confirmation.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { ReservationConfirmationService } from './reservation-confirmation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';

describe('ReservationConfirmationService', () => {
  let service: ReservationConfirmationService;
  let prisma: { reservation: { findUniqueOrThrow: jest.Mock; update: jest.Mock } };
  let eventsService: { record: jest.Mock };
  let emailService: { sendFinalConfirmationEmail: jest.Mock; sendAlert: jest.Mock };

  const baseReservation = {
    id: 'res-1',
    guestName: 'Jane Doe',
    guestEmail: 'jane@example.com',
    status: 'PENDING',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
    finalConfirmationEmailSentAt: null,
  };

  beforeEach(async () => {
    prisma = {
      reservation: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    };
    eventsService = { record: jest.fn() };
    emailService = { sendFinalConfirmationEmail: jest.fn(), sendAlert: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationConfirmationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(ReservationConfirmationService);
  });

  it('does nothing when a step is still missing', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({ ...baseReservation, datesConfirmedAt: new Date() });

    await service.maybeAutoConfirm('res-1');

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('does nothing when status is not PENDING', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      status: 'CANCELLED',
      datesConfirmedAt: new Date(),
      contractAcceptedAt: new Date(),
      confirmationPaymentReceivedAt: new Date(),
      depositReceivedAt: new Date(),
    });

    await service.maybeAutoConfirm('res-1');

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('confirms and sends the final email once all 4 steps are complete', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      contractAcceptedAt: new Date(),
      confirmationPaymentReceivedAt: new Date(),
      depositReceivedAt: new Date(),
    });
    emailService.sendFinalConfirmationEmail.mockResolvedValue(undefined);

    await service.maybeAutoConfirm('res-1');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'CONFIRMED' },
    });
    expect(eventsService.record).toHaveBeenCalledWith('res-1', 'RESERVATION_CONFIRMED');
    expect(emailService.sendFinalConfirmationEmail).toHaveBeenCalledWith('jane@example.com', 'Jane Doe');
    expect(eventsService.record).toHaveBeenCalledWith('res-1', 'FINAL_EMAIL_SENT');
  });

  it('logs a failure event and sends an alert when the final email fails', async () => {
    prisma.reservation.findUniqueOrThrow.mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: new Date(),
      contractAcceptedAt: new Date(),
      confirmationPaymentReceivedAt: new Date(),
      depositReceivedAt: new Date(),
    });
    emailService.sendFinalConfirmationEmail.mockRejectedValue(new Error('Resend down'));

    await service.maybeAutoConfirm('res-1');

    expect(eventsService.record).toHaveBeenCalledWith('res-1', 'FINAL_EMAIL_FAILED', 'Resend down');
    expect(emailService.sendAlert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- reservation-confirmation.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `ReservationConfirmationService` and its module**

`api/src/reservation-confirmation/reservation-confirmation.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ReservationConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
    private readonly emailService: EmailService,
  ) {}

  async maybeAutoConfirm(reservationId: string): Promise<void> {
    const reservation = await this.prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });

    const allStepsComplete = Boolean(
      reservation.datesConfirmedAt &&
        reservation.contractAcceptedAt &&
        reservation.confirmationPaymentReceivedAt &&
        reservation.depositReceivedAt,
    );

    if (!allStepsComplete || reservation.status !== 'PENDING') {
      return;
    }

    await this.prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'CONFIRMED' },
    });
    await this.eventsService.record(reservationId, 'RESERVATION_CONFIRMED');

    if (reservation.finalConfirmationEmailSentAt || !reservation.guestEmail) {
      return;
    }

    try {
      await this.emailService.sendFinalConfirmationEmail(reservation.guestEmail, reservation.guestName);
      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { finalConfirmationEmailSentAt: new Date() },
      });
      await this.eventsService.record(reservationId, 'FINAL_EMAIL_SENT');
    } catch (error) {
      await this.eventsService.record(reservationId, 'FINAL_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Final confirmation email failed',
        `Reservation ${reservationId} for ${reservation.guestName} auto-confirmed but the final email failed to send: ${(error as Error).message}`,
      );
    }
  }
}
```

`api/src/reservation-confirmation/reservation-confirmation.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReservationConfirmationService } from './reservation-confirmation.service';

@Module({
  providers: [ReservationConfirmationService],
  exports: [ReservationConfirmationService],
})
export class ReservationConfirmationModule {}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- reservation-confirmation.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing `PublicReservationsService` test**

`api/src/public-reservations/public-reservations.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicReservationsService } from './public-reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';

describe('PublicReservationsService', () => {
  let service: PublicReservationsService;
  let prisma: { reservation: { findUnique: jest.Mock; update: jest.Mock } };
  let settingsService: { get: jest.Mock };
  let eventsService: { record: jest.Mock };
  let confirmationService: { maybeAutoConfirm: jest.Mock };

  const baseReservation = {
    id: 'res-1',
    confirmationToken: 'tok-1',
    guestName: 'Jane Doe',
    checkIn: new Date('2026-03-01'),
    checkOut: new Date('2026-03-05'),
    paxCount: 2,
    totalAmount: 100000,
    currency: 'ARS',
    datesConfirmedAt: null,
    contractAcceptedAt: null,
    confirmationPaymentReceivedAt: null,
    depositReceivedAt: null,
  };

  beforeEach(async () => {
    prisma = { reservation: { findUnique: jest.fn(), update: jest.fn() } };
    settingsService = {
      get: jest.fn().mockResolvedValue({ houseRulesText: 'No parties.', paymentInstructions: 'Bank X.' }),
    };
    eventsService = { record: jest.fn() };
    confirmationService = { maybeAutoConfirm: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: ReservationEventsService, useValue: eventsService },
        { provide: ReservationConfirmationService, useValue: confirmationService },
      ],
    }).compile();

    service = moduleRef.get(PublicReservationsService);
  });

  it('throws NotFoundException for an unknown token', async () => {
    prisma.reservation.findUnique.mockResolvedValue(null);

    await expect(service.getByToken('missing')).rejects.toThrow(NotFoundException);
  });

  it('returns reservation details plus house rules and payment instructions', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });

    const result = await service.getByToken('tok-1');

    expect(result.guestName).toBe('Jane Doe');
    expect(result.houseRulesText).toBe('No parties.');
    expect(result.paymentInstructions).toBe('Bank X.');
  });

  it('confirms dates, records an event, and checks auto-confirmation', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({ ...baseReservation, datesConfirmedAt: new Date() });

    await service.confirmDates('tok-1');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { datesConfirmedAt: expect.any(Date) },
    });
    expect(eventsService.record).toHaveBeenCalledWith('res-1', 'DATES_CONFIRMED');
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });

  it('accepts the contract, snapshotting the current house rules text', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation });
    prisma.reservation.update.mockResolvedValue({ ...baseReservation, contractAcceptedAt: new Date() });

    await service.acceptContract('tok-1', 'Jane Doe');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        contractAcceptedAt: expect.any(Date),
        contractAcceptedName: 'Jane Doe',
        contractSnapshot: 'No parties.',
      },
    });
    expect(eventsService.record).toHaveBeenCalledWith('res-1', 'CONTRACT_ACCEPTED');
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('res-1');
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `docker compose exec api npm test -- public-reservations.service.spec.ts`
Expected: FAIL

- [ ] **Step 7: Implement the DTO, service, controller, and module**

`api/src/public-reservations/dto/accept-contract.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class AcceptContractDto {
  @IsString()
  @MinLength(1)
  fullName: string;
}
```

`api/src/public-reservations/public-reservations.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';

@Injectable()
export class PublicReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: ReservationEventsService,
    private readonly confirmationService: ReservationConfirmationService,
  ) {}

  private async findByToken(token: string) {
    const reservation = await this.prisma.reservation.findUnique({ where: { confirmationToken: token } });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  async getByToken(token: string) {
    const reservation = await this.findByToken(token);
    const settings = await this.settingsService.get();

    return {
      guestName: reservation.guestName,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      paxCount: reservation.paxCount,
      totalAmount: reservation.totalAmount,
      currency: reservation.currency,
      datesConfirmedAt: reservation.datesConfirmedAt,
      contractAcceptedAt: reservation.contractAcceptedAt,
      contractAcceptedName: reservation.contractAcceptedName,
      confirmationPaymentReceivedAt: reservation.confirmationPaymentReceivedAt,
      depositReceivedAt: reservation.depositReceivedAt,
      houseRulesText: settings.houseRulesText,
      paymentInstructions: settings.paymentInstructions,
    };
  }

  async confirmDates(token: string) {
    const reservation = await this.findByToken(token);

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { datesConfirmedAt: reservation.datesConfirmedAt ?? new Date() },
    });

    await this.eventsService.record(reservation.id, 'DATES_CONFIRMED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    return { datesConfirmedAt: updated.datesConfirmedAt };
  }

  async acceptContract(token: string, fullName: string) {
    const reservation = await this.findByToken(token);
    const settings = await this.settingsService.get();

    const updated = await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        contractAcceptedAt: reservation.contractAcceptedAt ?? new Date(),
        contractAcceptedName: fullName,
        contractSnapshot: settings.houseRulesText,
      },
    });

    await this.eventsService.record(reservation.id, 'CONTRACT_ACCEPTED');
    await this.confirmationService.maybeAutoConfirm(reservation.id);

    return { contractAcceptedAt: updated.contractAcceptedAt };
  }
}
```

`api/src/public-reservations/public-reservations.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicReservationsService } from './public-reservations.service';
import { AcceptContractDto } from './dto/accept-contract.dto';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: PublicReservationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Post(':token/confirm-dates')
  confirmDates(@Param('token') token: string) {
    return this.service.confirmDates(token);
  }

  @Post(':token/accept-contract')
  acceptContract(@Param('token') token: string, @Body() dto: AcceptContractDto) {
    return this.service.acceptContract(token, dto.fullName);
  }
}
```

`api/src/public-reservations/public-reservations.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PublicReservationsController } from './public-reservations.controller';
import { PublicReservationsService } from './public-reservations.service';
import { SettingsModule } from '../settings/settings.module';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';

@Module({
  imports: [SettingsModule, ReservationConfirmationModule],
  controllers: [PublicReservationsController],
  providers: [PublicReservationsService],
})
export class PublicReservationsModule {}
```

Add `PublicReservationsModule` to `api/src/app.module.ts` imports.

- [ ] **Step 8: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- public-reservations.service.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Write the e2e test**

`api/test/public-reservations.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PublicReservationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({ where: { guestName: 'Public E2E Guest' } });
    await app.close();
  });

  it('returns 404 for an unknown token', async () => {
    await request(app.getHttpServer()).get('/public/reservations/does-not-exist').expect(404);
  });

  it('walks through confirm-dates and accept-contract via the public endpoints', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Public E2E Guest',
        checkIn: new Date('2026-03-01'),
        checkOut: new Date('2026-03-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    await request(app.getHttpServer())
      .get(`/public/reservations/${reservation.confirmationToken}`)
      .expect(200)
      .expect((res) => {
        if (res.body.guestName !== 'Public E2E Guest') throw new Error('unexpected guestName');
      });

    await request(app.getHttpServer())
      .post(`/public/reservations/${reservation.confirmationToken}/confirm-dates`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/public/reservations/${reservation.confirmationToken}/accept-contract`)
      .send({ fullName: 'Jane Doe' })
      .expect(201);

    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(updated?.datesConfirmedAt).not.toBeNull();
    expect(updated?.contractAcceptedName).toBe('Jane Doe');
    expect(updated?.contractSnapshot).toBeTruthy();
  });

  it('rejects contract acceptance with an empty name', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Public E2E Guest',
        checkIn: new Date('2026-03-01'),
        checkOut: new Date('2026-03-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    await request(app.getHttpServer())
      .post(`/public/reservations/${reservation.confirmationToken}/accept-contract`)
      .send({ fullName: '' })
      .expect(400);
  });
});
```

Note: this test file uses `import request from 'supertest'` (default import), matching the fix already applied in sub-project 1 for this project's tsconfig `nodenext` module setting — do not use `import * as request from 'supertest'`.

- [ ] **Step 10: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 11: Commit**

```bash
git add api/src/reservation-confirmation api/src/public-reservations api/test/public-reservations.e2e-spec.ts api/src/app.module.ts
git commit -m "Add auto-confirmation rule and public guest confirmation API"
```

---

### Task 6: Wire reservation creation to send the initial email + admin mark-received/returned endpoints

**Files:**
- Modify: `api/src/reservations/reservations.service.ts`, `reservations.controller.ts`, `reservations.module.ts`
- Modify: `api/src/reservations/reservations.service.spec.ts`, `api/test/reservations.e2e-spec.ts`
- Create: `api/test/guest-onboarding-flow.e2e-spec.ts`

**Interfaces:**
- Consumes: `EmailService` (Task 4), `ReservationEventsService` (Task 3), `ReservationConfirmationService` (Task 5).
- Produces: `ReservationsService.markPaymentReceived(id)`, `.markDepositReceived(id)`, `.markDepositReturned(id)`, `.listEvents(id)` — all idempotent. New routes: `POST /reservations/:id/mark-payment-received`, `POST /reservations/:id/mark-deposit-received`, `POST /reservations/:id/mark-deposit-returned`, `GET /reservations/:id/events` — all JWT-guarded (inherited from the controller's existing `@UseGuards`). Consumed by Task 8 (admin-web).

- [ ] **Step 1: Update the shared test setup, then write the failing tests for the new `ReservationsService` methods**

`ReservationsService`'s constructor is about to gain 3 new dependencies (`ReservationEventsService`, `EmailService`, `ReservationConfirmationService`). The existing top-level `beforeEach` in `api/src/reservations/reservations.service.spec.ts` (from sub-project 1) only provides a mocked `PrismaService` — once the constructor changes, Nest's DI will fail to resolve those 3 new dependencies for the ORIGINAL tests too, not just new ones. Fix this by modifying the existing top-level `beforeEach` (do not create a second nested `TestingModule` — there must be exactly one shared module setup in this file):

```typescript
// At the top of the file, alongside the existing `import`s:
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';

// Alongside the existing `let service: ReservationsService;` and `let prisma: {...};` declarations:
let eventsService: { record: jest.Mock };
let emailService: { sendInitialConfirmationEmail: jest.Mock; sendAlert: jest.Mock };
let confirmationService: { maybeAutoConfirm: jest.Mock };
```

Modify the existing top-level `beforeEach` to add the 3 new mocks and providers (keep the existing `prisma` mock object and its `reservation: {...}` mocks exactly as they are — just add to them and to the `providers` array):
```typescript
beforeEach(async () => {
  prisma = {
    reservation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  eventsService = { record: jest.fn() };
  emailService = { sendInitialConfirmationEmail: jest.fn(), sendAlert: jest.fn() };
  confirmationService = { maybeAutoConfirm: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ReservationsService,
      { provide: PrismaService, useValue: prisma },
      { provide: ReservationEventsService, useValue: eventsService },
      { provide: EmailService, useValue: emailService },
      { provide: ReservationConfirmationService, useValue: confirmationService },
    ],
  }).compile();

  service = moduleRef.get(ReservationsService);
});
```

This one shared `beforeEach` now serves both the original 3 tests (unaffected — they never touch `eventsService`/`emailService`/`confirmationService`) and the new tests below. Add the new tests in a nested `describe`, reusing the outer scope's `service`/`prisma`/`eventsService`/`emailService`/`confirmationService` — do NOT declare a new `beforeEach` or a second `TestingModule` inside it:

```typescript
describe('onboarding actions', () => {
  it('sends the initial email when a reservation is created with a guestEmail', async () => {
    prisma.reservation.create.mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      guestEmail: 'jane@example.com',
      confirmationToken: 'tok-1',
      ...validDto,
    });
    emailService.sendInitialConfirmationEmail.mockResolvedValue(undefined);

    await service.create({ ...validDto, guestEmail: 'jane@example.com' });

    expect(emailService.sendInitialConfirmationEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'Jane Doe',
      expect.stringContaining('tok-1'),
    );
    expect(eventsService.record).toHaveBeenCalledWith('1', 'INITIAL_EMAIL_SENT');
  });

  it('does not attempt to send an email when guestEmail is absent', async () => {
    prisma.reservation.create.mockResolvedValue({ id: '1', guestName: 'Jane Doe', guestEmail: null, ...validDto });

    await service.create(validDto);

    expect(emailService.sendInitialConfirmationEmail).not.toHaveBeenCalled();
  });

  it('marks the 30% payment as received and checks auto-confirmation', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: '1', confirmationPaymentReceivedAt: null });
    prisma.reservation.update.mockResolvedValue({ id: '1', confirmationPaymentReceivedAt: new Date() });

    await service.markPaymentReceived('1');

    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { confirmationPaymentReceivedAt: expect.any(Date) },
    });
    expect(eventsService.record).toHaveBeenCalledWith('1', 'PAYMENT_RECEIVED');
    expect(confirmationService.maybeAutoConfirm).toHaveBeenCalledWith('1');
  });

  it('marking payment received is idempotent', async () => {
    prisma.reservation.findUnique.mockResolvedValue({ id: '1', confirmationPaymentReceivedAt: new Date() });

    await service.markPaymentReceived('1');

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });
});
```

**Placement matters here:** `service`, `prisma`, `eventsService`, `emailService`, `confirmationService`, and `validDto` are all declared with `let`/`const` inside the existing `describe('ReservationsService', () => { ... })` callback (from sub-project 1) — they are NOT file-level variables. The new `describe('onboarding actions', () => { ... })` block above must be placed INSIDE that same `describe('ReservationsService', ...)` callback, nested alongside (not after) the existing `it(...)` tests and before that describe's closing `});` — otherwise it's a sibling scope and none of those variables are visible to it. The original 3 tests and their surrounding structure stay exactly as they are; you're adding one new nested `describe` block among them.

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: FAIL (new methods don't exist yet)

- [ ] **Step 3: Implement the new `ReservationsService` methods**

Modify `api/src/reservations/reservations.service.ts` — update the constructor and add these methods:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { EmailService } from '../email/email.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';
import { Reservation } from '@prisma/client';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
    private readonly emailService: EmailService,
    private readonly confirmationService: ReservationConfirmationService,
  ) {}

  // ...existing validateDates, findAll, findOne, update methods stay unchanged...

  async create(dto: CreateReservationDto) {
    this.validateDates(dto.checkIn, dto.checkOut);

    const reservation = await this.prisma.reservation.create({
      data: {
        ...dto,
        checkIn: new Date(dto.checkIn),
        checkOut: new Date(dto.checkOut),
      },
    });

    if (reservation.guestEmail) {
      await this.sendInitialEmail(reservation);
    }

    return reservation;
  }

  private async sendInitialEmail(reservation: Reservation): Promise<void> {
    const confirmationUrl = `${process.env.GUEST_WEB_ORIGIN}/r/${reservation.confirmationToken}`;

    try {
      await this.emailService.sendInitialConfirmationEmail(
        reservation.guestEmail as string,
        reservation.guestName,
        confirmationUrl,
      );
      await this.prisma.reservation.update({
        where: { id: reservation.id },
        data: { confirmationEmailSentAt: new Date() },
      });
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_SENT');
    } catch (error) {
      await this.eventsService.record(reservation.id, 'INITIAL_EMAIL_FAILED', (error as Error).message);
      await this.emailService.sendAlert(
        'Initial confirmation email failed',
        `Reservation ${reservation.id} for ${reservation.guestName} was created but the initial email failed to send: ${(error as Error).message}`,
      );
    }
  }

  async markPaymentReceived(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.confirmationPaymentReceivedAt) {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { confirmationPaymentReceivedAt: new Date() },
    });
    await this.eventsService.record(id, 'PAYMENT_RECEIVED');
    await this.confirmationService.maybeAutoConfirm(id);
    return updated;
  }

  async markDepositReceived(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.depositReceivedAt) {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { depositReceivedAt: new Date() },
    });
    await this.eventsService.record(id, 'DEPOSIT_RECEIVED');
    await this.confirmationService.maybeAutoConfirm(id);
    return updated;
  }

  async markDepositReturned(id: string) {
    const reservation = await this.findOne(id);
    if (reservation.depositReturnedAt) {
      return reservation;
    }

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { depositReturnedAt: new Date() },
    });
    await this.eventsService.record(id, 'DEPOSIT_RETURNED');
    return updated;
  }

  listEvents(id: string) {
    return this.eventsService.listForReservation(id);
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: PASS (all original tests + the 4 new onboarding-action tests)

- [ ] **Step 5: Add the new controller routes**

Modify `api/src/reservations/reservations.controller.ts` — add these methods to the existing `ReservationsController` class (keep all existing routes unchanged):
```typescript
@Post(':id/mark-payment-received')
markPaymentReceived(@Param('id') id: string) {
  return this.reservationsService.markPaymentReceived(id);
}

@Post(':id/mark-deposit-received')
markDepositReceived(@Param('id') id: string) {
  return this.reservationsService.markDepositReceived(id);
}

@Post(':id/mark-deposit-returned')
markDepositReturned(@Param('id') id: string) {
  return this.reservationsService.markDepositReturned(id);
}

@Get(':id/events')
listEvents(@Param('id') id: string) {
  return this.reservationsService.listEvents(id);
}
```

- [ ] **Step 6: Wire the new module dependencies**

Modify `api/src/reservations/reservations.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';

@Module({
  imports: [ReservationConfirmationModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
```

(`ReservationEventsService` and `EmailService` are both `@Global()`, so no explicit import is needed for those — only `ReservationConfirmationModule`, which is a regular module.)

- [ ] **Step 7: Write the full end-to-end onboarding flow e2e test**

`api/test/guest-onboarding-flow.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('Full guest onboarding flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-onboarding@labrisa.com.ar';
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
    await prisma.reservationEvent.deleteMany({
      where: { reservation: { guestName: 'Onboarding E2E Guest' } },
    });
    await prisma.reservation.deleteMany({ where: { guestName: 'Onboarding E2E Guest' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-onboarding@labrisa.com.ar' } });
    await app.close();
  });

  it('auto-confirms once all 4 onboarding steps are complete, in any order', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'Onboarding E2E Guest',
        checkIn: '2026-05-01',
        checkOut: '2026-05-05',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 150000,
        currency: 'ARS',
      })
      .expect(201);

    const reservationId = createResponse.body.id;
    const token = createResponse.body.confirmationToken;

    // Staff marks payment and deposit received first
    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-payment-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-deposit-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    // Reservation should still be PENDING — guest hasn't confirmed dates or accepted the contract yet
    let current = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(current?.status).toBe('PENDING');

    // Guest confirms dates and accepts the contract
    await request(app.getHttpServer()).post(`/public/reservations/${token}/confirm-dates`).expect(201);
    await request(app.getHttpServer())
      .post(`/public/reservations/${token}/accept-contract`)
      .send({ fullName: 'Onboarding E2E Guest' })
      .expect(201);

    // Now all 4 conditions are met — reservation should be auto-confirmed
    current = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(current?.status).toBe('CONFIRMED');

    const eventsResponse = await request(app.getHttpServer())
      .get(`/reservations/${reservationId}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const eventTypes = eventsResponse.body.map((event: { type: string }) => event.type);
    expect(eventTypes).toContain('PAYMENT_RECEIVED');
    expect(eventTypes).toContain('DEPOSIT_RECEIVED');
    expect(eventTypes).toContain('DATES_CONFIRMED');
    expect(eventTypes).toContain('CONTRACT_ACCEPTED');
    expect(eventTypes).toContain('RESERVATION_CONFIRMED');
  });

  it('marking an already-marked step is idempotent (no error, no duplicate event)', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'Onboarding E2E Guest',
        checkIn: '2026-06-01',
        checkOut: '2026-06-05',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 150000,
        currency: 'ARS',
      })
      .expect(201);

    const reservationId = createResponse.body.id;

    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-payment-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-payment-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const eventsResponse = await request(app.getHttpServer())
      .get(`/reservations/${reservationId}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const paymentEvents = eventsResponse.body.filter((event: { type: string }) => event.type === 'PAYMENT_RECEIVED');
    expect(paymentEvents).toHaveLength(1);
  });
});
```

- [ ] **Step 8: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 9: Commit**

```bash
git add api/src/reservations api/test/guest-onboarding-flow.e2e-spec.ts
git commit -m "Wire reservation creation to the initial email and add admin mark-received/returned endpoints"
```

---

### Task 7: Admin-web — Settings page

**Files:**
- Create: `admin-web/src/api/settings.ts`, `admin-web/src/settings/SettingsPage.tsx`, `admin-web/src/settings/SettingsPage.test.tsx`
- Modify: `admin-web/src/App.tsx`, `admin-web/src/reservations/ReservationListPage.tsx`

**Interfaces:**
- Consumes: `GET /settings`, `PUT /settings` (Task 2), `apiClient` (sub-project 1).
- Produces: nothing consumed by later tasks — this is a leaf feature.

- [ ] **Step 1: Write the API functions**

`admin-web/src/api/settings.ts`:
```typescript
import { apiClient } from './client';

export interface Settings {
  houseRulesText: string;
  paymentInstructions: string;
}

export function getSettings(): Promise<Settings> {
  return apiClient.request('/settings');
}

export function updateSettings(settings: Settings): Promise<Settings> {
  return apiClient.request('/settings', { method: 'PUT', body: JSON.stringify(settings) });
}
```

- [ ] **Step 2: Write the failing `SettingsPage` test**

`admin-web/src/settings/SettingsPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import * as settingsApi from '../api/settings';

describe('SettingsPage', () => {
  it('loads existing settings and saves changes', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });
    const updateSpy = vi.spyOn(settingsApi, 'updateSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/house rules/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: FAIL (`Cannot find module './SettingsPage'`)

- [ ] **Step 4: Implement `SettingsPage`**

`admin-web/src/settings/SettingsPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../api/settings';

export function SettingsPage() {
  const [houseRulesText, setHouseRulesText] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((settings) => {
      setHouseRulesText(settings.houseRulesText);
      setPaymentInstructions(settings.paymentInstructions);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await updateSettings({ houseRulesText, paymentInstructions });
    setSaved(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Settings</h1>
      <label>
        House rules
        <textarea value={houseRulesText} onChange={(e) => setHouseRulesText(e.target.value)} rows={8} />
      </label>
      <label>
        Payment instructions
        <textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} rows={8} />
      </label>
      {saved && <p role="status">Saved</p>}
      <button type="submit">Save</button>
    </form>
  );
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Wire the route and a nav link**

In `admin-web/src/App.tsx`, add the route inside the protected group:
```tsx
import { SettingsPage } from './settings/SettingsPage';
// ...
<Route path="/settings" element={<SettingsPage />} />
```

In `admin-web/src/reservations/ReservationListPage.tsx`, add a link near the "Log out" button:
```tsx
<Link to="/settings">Settings</Link>
```
(`Link` is already imported from `react-router-dom` in this file.)

- [ ] **Step 7: Verify manually**

Run: `docker compose restart admin-web`
Log in, click "Settings", edit the text, save — expected: page reloads the saved values on next visit (confirm via `curl` against `/settings` with the admin token, or by revisiting the page).

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/api/settings.ts admin-web/src/settings admin-web/src/App.tsx admin-web/src/reservations/ReservationListPage.tsx
git commit -m "Add Settings page for editing house rules and payment instructions"
```

---

### Task 8: Admin-web — reservation detail additions (progress, events, mark actions, copy link)

**Files:**
- Modify: `admin-web/src/api/reservations.ts`, `admin-web/src/reservations/types.ts`, `admin-web/src/reservations/ReservationFormPage.tsx`, `admin-web/src/reservations/ReservationFormPage.test.tsx`
- Modify: `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `admin-web/Dockerfile`

**Interfaces:**
- Consumes: the 4 new routes from Task 6, `Reservation`/`ReservationEvent` shapes from the API.
- Produces: nothing consumed by later tasks — this is a leaf feature.

- [ ] **Step 1: Add `VITE_GUEST_WEB_URL` plumbing (needed for the "copy guest link" button)**

Add to `.env.example` (near the existing frontend vars):
```
VITE_GUEST_WEB_URL=http://localhost:5174
```

Modify `docker-compose.yml`'s `admin-web` service — add to its `environment:` block:
```yaml
      VITE_GUEST_WEB_URL: ${VITE_GUEST_WEB_URL}
```

Modify `docker-compose.prod.yml`'s `admin-web` service — add to its `build.args:` block:
```yaml
        VITE_GUEST_WEB_URL: ${VITE_GUEST_WEB_URL}
```

Modify `admin-web/Dockerfile`'s `build` stage — add alongside the existing `VITE_API_URL` lines:
```dockerfile
ARG VITE_GUEST_WEB_URL
ENV VITE_GUEST_WEB_URL=$VITE_GUEST_WEB_URL
```

Add your local `.env`'s value too: `VITE_GUEST_WEB_URL=http://localhost:5174`.

- [ ] **Step 2: Extend the `Reservation` type and add a `ReservationEvent` type**

Modify `admin-web/src/reservations/types.ts` — add these fields to the existing `Reservation` interface (keep all existing fields):
```typescript
  confirmationToken: string;
  datesConfirmedAt?: string | null;
  contractAcceptedAt?: string | null;
  contractAcceptedName?: string | null;
  confirmationPaymentReceivedAt?: string | null;
  depositReceivedAt?: string | null;
  depositReturnedAt?: string | null;
```

Add a new interface in the same file:
```typescript
export interface ReservationEvent {
  id: string;
  type: string;
  detail?: string | null;
  createdAt: string;
}
```

- [ ] **Step 3: Add the new API functions**

Add to `admin-web/src/api/reservations.ts`:
```typescript
import { Reservation, ReservationEvent } from './types';

export function markPaymentReceived(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/mark-payment-received`, { method: 'POST' });
}

export function markDepositReceived(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/mark-deposit-received`, { method: 'POST' });
}

export function markDepositReturned(id: string): Promise<Reservation> {
  return apiClient.request(`/reservations/${id}/mark-deposit-returned`, { method: 'POST' });
}

export function listReservationEvents(id: string): Promise<ReservationEvent[]> {
  return apiClient.request(`/reservations/${id}/events`);
}
```
(Adjust the existing `import { Reservation } from './types';` line at the top of the file to include `ReservationEvent` instead of adding a duplicate import line.)

- [ ] **Step 4: Write the failing test for the new reservation-detail controls**

Add to `admin-web/src/reservations/ReservationFormPage.test.tsx` (alongside the existing test — do not remove it):
```tsx
it('marks the 30% payment as received and refreshes the progress list', async () => {
  vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
    id: '1',
    guestName: 'Jane Doe',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'DIRECT',
    totalAmount: 100000,
    currency: 'ARS',
    status: 'PENDING',
    confirmationToken: 'tok-1',
  } as never);
  vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
  const markSpy = vi.spyOn(reservationsApi, 'markPaymentReceived').mockResolvedValue({
    id: '1',
    confirmationPaymentReceivedAt: '2026-01-01T00:00:00.000Z',
  } as never);

  render(
    <MemoryRouter initialEntries={['/reservations/1']}>
      <Routes>
        <Route path="/reservations/:id" element={<ReservationFormPage />} />
      </Routes>
    </MemoryRouter>,
  );

  const button = await screen.findByRole('button', { name: /mark 30% payment received/i });
  fireEvent.click(button);

  await waitFor(() => expect(markSpy).toHaveBeenCalledWith('1'));
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: FAIL (button doesn't exist yet)

- [ ] **Step 6: Implement the onboarding progress section in `ReservationFormPage`**

Modify `admin-web/src/reservations/ReservationFormPage.tsx`. Add these imports:
```tsx
import {
  createReservation,
  getReservation,
  listReservationEvents,
  markDepositReceived,
  markDepositReturned,
  markPaymentReceived,
  updateReservation,
} from '../api/reservations';
import { Reservation, ReservationEvent, ReservationSource, ReservationStatus } from './types';
```

Add state and loading logic inside the `ReservationFormPage` component, alongside the existing `form`/`error` state:
```tsx
const [reservationRecord, setReservationRecord] = useState<Reservation | null>(null);
const [events, setEvents] = useState<ReservationEvent[]>([]);
const guestWebUrl = import.meta.env.VITE_GUEST_WEB_URL as string;

function refreshOnboardingState() {
  if (!id) return;
  getReservation(id).then(setReservationRecord);
  listReservationEvents(id).then(setEvents);
}

useEffect(() => {
  refreshOnboardingState();
}, [id]);

async function handleMarkPaymentReceived() {
  if (!id) return;
  await markPaymentReceived(id);
  refreshOnboardingState();
}

async function handleMarkDepositReceived() {
  if (!id) return;
  await markDepositReceived(id);
  refreshOnboardingState();
}

async function handleMarkDepositReturned() {
  if (!id) return;
  await markDepositReturned(id);
  refreshOnboardingState();
}

function copyGuestLink() {
  if (!reservationRecord) return;
  navigator.clipboard.writeText(`${guestWebUrl}/r/${reservationRecord.confirmationToken}`);
}
```

Add this section to the JSX, after the existing form's closing `</form>` tag but still inside the component's returned fragment (wrap the existing return in a fragment `<>...</>` if it isn't already, or place this section as a sibling after the form):
```tsx
{isEditing && reservationRecord && (
  <section>
    <h2>Onboarding progress</h2>
    <ul>
      <li>Dates confirmed: {reservationRecord.datesConfirmedAt ? 'Yes' : 'No'}</li>
      <li>
        Contract accepted:{' '}
        {reservationRecord.contractAcceptedAt ? `Yes (${reservationRecord.contractAcceptedName})` : 'No'}
      </li>
      <li>
        30% payment received:{' '}
        {reservationRecord.confirmationPaymentReceivedAt ? (
          'Yes'
        ) : (
          <button type="button" onClick={handleMarkPaymentReceived}>
            Mark 30% payment received
          </button>
        )}
      </li>
      <li>
        Deposit received:{' '}
        {reservationRecord.depositReceivedAt ? (
          'Yes'
        ) : (
          <button type="button" onClick={handleMarkDepositReceived}>
            Mark deposit received
          </button>
        )}
      </li>
      <li>
        Deposit returned:{' '}
        {reservationRecord.depositReturnedAt ? (
          'Yes'
        ) : (
          <button type="button" onClick={handleMarkDepositReturned}>
            Mark deposit returned
          </button>
        )}
      </li>
    </ul>
    <button type="button" onClick={copyGuestLink}>
      Copy guest confirmation link
    </button>

    <h2>Event history</h2>
    <ul>
      {events.map((event) => (
        <li key={event.id}>
          {event.type} — {new Date(event.createdAt).toLocaleString()}
          {event.detail ? `: ${event.detail}` : ''}
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/reservations/ReservationFormPage.test.tsx`
Expected: PASS (both the original create-mode test and the new onboarding-actions test)

- [ ] **Step 8: Rebuild and verify manually**

Run: `docker compose up -d --build admin-web`
Open an existing reservation's edit page — expected: "Onboarding progress" and "Event history" sections render below the form, with working mark-received/returned buttons and a working "copy guest confirmation link" button.

- [ ] **Step 9: Commit**

```bash
git add admin-web/src .env.example docker-compose.yml docker-compose.prod.yml admin-web/Dockerfile
git commit -m "Add onboarding progress, event history, and mark-received controls to the reservation detail view"
```

---

### Task 9: Guest-web foundations — design system, test setup, routing shell

**Files:**
- Modify: `guest-web/src/index.css`, `guest-web/index.html`, `guest-web/src/App.tsx`, `guest-web/vite.config.ts`, `guest-web/package.json`
- Create: `guest-web/src/setupTests.ts`, `guest-web/src/confirmation/ConfirmationPage.tsx` (stub)

**Interfaces:**
- Produces: the design system (CSS custom properties + base styles), Vitest test infrastructure, and a routing shell (`/` placeholder, `/r/:token` → `ConfirmationPage`) — consumed by Task 10.

- [ ] **Step 1: Install routing and test dependencies**

Run:
```bash
docker compose exec guest-web npm install react-router-dom
docker compose exec guest-web npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
docker compose restart guest-web
```
If the latest `vitest`/`@testing-library/react` versions pull in something incompatible with this project's setup (as happened with `admin-web` in sub-project 1), pin to the same major versions `admin-web/package.json` already uses, and note it in your report.

- [ ] **Step 2: Add the design system to `guest-web/src/index.css`**

Replace the entire contents of `guest-web/src/index.css`:
```css
:root {
  --color-dark: #101010;
  --color-teal: #0bb4aa;
  --color-teal-dark: #089990;
  --color-bg: #f9fafd;
  --color-white: #ffffff;
  --color-grey: #6c6c77;
  --color-light-grey: #d9d9d9;
  --max-width: 1140px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Inter', sans-serif;
  background: var(--color-bg);
  color: var(--color-dark);
}

h1,
h2,
h3 {
  font-family: 'Montserrat', sans-serif;
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 20px;
}

.btn {
  display: inline-block;
  padding: 0.85rem 2.5rem;
  background: var(--color-dark);
  color: var(--color-white);
  font-weight: 700;
  font-size: 0.875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 2px;
  border: none;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  transition: background 0.2s;
}

.btn:hover {
  background: var(--color-teal-dark);
}

.btn:disabled {
  background: var(--color-light-grey);
  cursor: not-allowed;
}

input,
textarea {
  width: 100%;
  padding: 0.65rem 0.9rem;
  border: 1px solid var(--color-light-grey);
  border-radius: 2px;
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
}

a {
  color: var(--color-teal);
}
```

- [ ] **Step 3: Load the Montserrat/Inter fonts**

In `guest-web/index.html`, add inside `<head>`, before the existing `<link rel="stylesheet" href="/src/index.css" />` or equivalent (check the actual existing `<head>` content and add these lines alongside it):
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Montserrat:wght@600;700&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 4: Configure Vitest**

Modify `guest-web/vite.config.ts`:
```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
});
```

`guest-web/src/setupTests.ts`:
```typescript
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
```

Add to `guest-web/package.json`'s `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 5: Create a stub `ConfirmationPage` and wire routing**

`guest-web/src/confirmation/ConfirmationPage.tsx` (stub — Task 10 replaces the body):
```tsx
export function ConfirmationPage() {
  return (
    <main className="container">
      <p>Loading...</p>
    </main>
  );
}
```

Modify `guest-web/src/App.tsx`:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfirmationPage } from './confirmation/ConfirmationPage';

function HomePlaceholder() {
  return (
    <main className="container">
      <h1>La Brisa de Mar del Plata</h1>
      <p>Guest portal coming soon.</p>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePlaceholder />} />
        <Route path="/r/:token" element={<ConfirmationPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Verify manually**

Run: `docker compose up -d --build guest-web`
Confirm the container builds and starts: `docker compose ps guest-web` shows `Up`. A full browser check isn't required for this foundations-only task — Task 10 will verify the real page content.

- [ ] **Step 7: Commit**

```bash
git add guest-web
git commit -m "Add guest-web design system, test setup, and routing shell"
```

---

### Task 10: Guest-web — the confirmation page

**Files:**
- Create: `guest-web/src/api/client.ts`, `guest-web/src/api/publicReservations.ts`, `guest-web/src/confirmation/types.ts`, `guest-web/src/confirmation/ConfirmationPage.test.tsx`
- Modify: `guest-web/src/confirmation/ConfirmationPage.tsx`
- Modify: `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `guest-web/Dockerfile`

**Interfaces:**
- Consumes: `GET /public/reservations/:token`, `POST .../confirm-dates`, `POST .../accept-contract` (Task 5).
- Produces: nothing consumed by later tasks — this is the final task of this plan.

- [ ] **Step 1: Wire `VITE_API_URL` into guest-web (dev + prod), learning from sub-project 1's production bug**

Add to `.env.example`'s frontend section (guest-web didn't need this in sub-project 1 since it was a placeholder — add it now):

Confirm `.env.example` already has `VITE_API_URL=http://localhost:3001` from sub-project 1 — it does, and it's shared by both frontends, so no new variable is needed, only new wiring:

Modify `docker-compose.yml`'s `guest-web` service — add:
```yaml
    environment:
      VITE_API_URL: ${VITE_API_URL}
```

Modify `docker-compose.prod.yml`'s `guest-web` service — add under `build:`:
```yaml
      args:
        VITE_API_URL: ${VITE_API_URL}
```

Modify `guest-web/Dockerfile`'s `build` stage — add before `RUN npm run build`:
```dockerfile
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
```

- [ ] **Step 2: Write the API client and public-reservations functions**

`guest-web/src/api/client.ts`:
```typescript
const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  return response.json() as Promise<T>;
}
```

`guest-web/src/confirmation/types.ts`:
```typescript
export interface GuestReservation {
  guestName: string;
  checkIn: string;
  checkOut: string;
  paxCount: number;
  totalAmount: number;
  currency: string;
  datesConfirmedAt: string | null;
  contractAcceptedAt: string | null;
  contractAcceptedName: string | null;
  confirmationPaymentReceivedAt: string | null;
  depositReceivedAt: string | null;
  houseRulesText: string;
  paymentInstructions: string;
}
```

`guest-web/src/api/publicReservations.ts`:
```typescript
import { request } from './client';
import { GuestReservation } from '../confirmation/types';

export function getReservationByToken(token: string): Promise<GuestReservation> {
  return request(`/public/reservations/${token}`);
}

export function confirmDates(token: string): Promise<{ datesConfirmedAt: string }> {
  return request(`/public/reservations/${token}/confirm-dates`, { method: 'POST' });
}

export function acceptContract(token: string, fullName: string): Promise<{ contractAcceptedAt: string }> {
  return request(`/public/reservations/${token}/accept-contract`, {
    method: 'POST',
    body: JSON.stringify({ fullName }),
  });
}
```

- [ ] **Step 3: Write the failing `ConfirmationPage` tests**

`guest-web/src/confirmation/ConfirmationPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationPage } from './ConfirmationPage';
import * as publicApi from '../api/publicReservations';

const baseReservation = {
  guestName: 'Jane Doe',
  checkIn: '2026-03-01',
  checkOut: '2026-03-05',
  paxCount: 2,
  totalAmount: 100000,
  currency: 'ARS',
  datesConfirmedAt: null,
  contractAcceptedAt: null,
  contractAcceptedName: null,
  confirmationPaymentReceivedAt: null,
  depositReceivedAt: null,
  houseRulesText: 'No parties.',
  paymentInstructions: 'Transfer to bank X.',
};

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/r/${token}`]}>
      <Routes>
        <Route path="/r/:token" element={<ConfirmationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConfirmationPage', () => {
  it('shows a not-found message for an invalid token', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockRejectedValue(new Error('404'));

    renderAt('bad-token');

    expect(await screen.findByText(/reservation not found/i)).toBeInTheDocument();
  });

  it('renders reservation details and confirms dates', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const confirmSpy = vi
      .spyOn(publicApi, 'confirmDates')
      .mockResolvedValue({ datesConfirmedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    expect(await screen.findByText(/jane doe/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm dates and guests/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith('tok-1'));
  });

  it('submits the contract acceptance form with the typed name', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    const acceptSpy = vi
      .spyOn(publicApi, 'acceptContract')
      .mockResolvedValue({ contractAcceptedAt: '2026-01-01T00:00:00.000Z' });

    renderAt('tok-1');

    await screen.findByText(/jane doe/i);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: /i accept the house rules/i }));

    await waitFor(() => expect(acceptSpy).toHaveBeenCalledWith('tok-1', 'Jane Doe'));
  });

  it('shows the final confirmed message once all 4 steps are done', async () => {
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedName: 'Jane Doe',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });

    renderAt('tok-1');

    expect(await screen.findByText(/fully confirmed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx`
Expected: FAIL (the stub page doesn't have any of this behavior yet)

- [ ] **Step 5: Implement the real `ConfirmationPage`**

Replace `guest-web/src/confirmation/ConfirmationPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { acceptContract, confirmDates, getReservationByToken } from '../api/publicReservations';
import { GuestReservation } from './types';

export function ConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const [reservation, setReservation] = useState<GuestReservation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!token) return;
    getReservationByToken(token)
      .then(setReservation)
      .catch(() => setNotFound(true));
  }

  useEffect(load, [token]);

  async function handleConfirmDates() {
    if (!token) return;
    setError(null);
    try {
      await confirmDates(token);
      load();
    } catch {
      setError('Could not confirm dates. Please try again.');
    }
  }

  async function handleAcceptContract(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    try {
      await acceptContract(token, fullName);
      load();
    } catch {
      setError('Could not accept the contract. Please try again.');
    }
  }

  if (notFound) {
    return (
      <main className="container">
        <h1>Reservation not found</h1>
        <p>This confirmation link is invalid. Please contact us directly.</p>
      </main>
    );
  }

  if (!reservation) {
    return (
      <main className="container">
        <p>Loading...</p>
      </main>
    );
  }

  const allDone = Boolean(
    reservation.datesConfirmedAt &&
      reservation.contractAcceptedAt &&
      reservation.confirmationPaymentReceivedAt &&
      reservation.depositReceivedAt,
  );

  return (
    <main className="container">
      <h1>La Brisa de Mar del Plata</h1>
      <h2>Reservation for {reservation.guestName}</h2>
      <p>Check-in: {reservation.checkIn.slice(0, 10)}</p>
      <p>Check-out: {reservation.checkOut.slice(0, 10)}</p>
      <p>Guests: {reservation.paxCount}</p>
      <p>
        Total: {reservation.totalAmount} {reservation.currency}
      </p>

      {error && <p role="alert">{error}</p>}

      <section>
        <h3>1. Confirm your dates</h3>
        {reservation.datesConfirmedAt ? (
          <p>Confirmed.</p>
        ) : (
          <button type="button" className="btn" onClick={handleConfirmDates}>
            Confirm dates and guests
          </button>
        )}
      </section>

      <section>
        <h3>2. Accept the house rules</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{reservation.houseRulesText}</p>
        {reservation.contractAcceptedAt ? (
          <p>Accepted by {reservation.contractAcceptedName}.</p>
        ) : (
          <form onSubmit={handleAcceptContract}>
            <label>
              Full name
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <button type="submit" className="btn">
              I accept the house rules
            </button>
          </form>
        )}
      </section>

      <section>
        <h3>3. Payment</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{reservation.paymentInstructions}</p>
        <p>30% confirmation payment: {reservation.confirmationPaymentReceivedAt ? 'Received' : 'Pending'}</p>
        <p>Security deposit: {reservation.depositReceivedAt ? 'Received' : 'Pending'}</p>
      </section>

      {allDone && <p>Your reservation is fully confirmed. We look forward to hosting you!</p>}
    </main>
  );
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 7: Verify manually end-to-end**

Run: `docker compose up -d --build guest-web api`
Create a test reservation via the admin app, copy its guest confirmation link (Task 8's button), open it in a browser at `http://localhost:5174/r/<token>` — expected: reservation details render with the actual house rules/payment instructions from Settings, "Confirm dates" and contract acceptance both work and persist across a page refresh, and marking payment/deposit received in admin (Task 8) plus completing both guest steps here results in the "fully confirmed" message appearing.

- [ ] **Step 8: Commit**

```bash
git add guest-web/src guest-web/Dockerfile .env.example docker-compose.yml docker-compose.prod.yml
git commit -m "Add the guest confirmation page: dates, contract, and payment instructions"
```
