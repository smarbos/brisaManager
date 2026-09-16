# Twilio WhatsApp Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send guests two WhatsApp reminders (reservation reminder, deposit reminder) via Twilio once their phone number is known, as a channel additional to (never replacing) the existing email flow.

**Architecture:** A new `api/src/whatsapp/` NestJS module mirrors the shape of the existing `api/src/email/` module: a `WhatsappService` wraps the Twilio SDK and never throws, and a daily `@Cron` scheduler (mirroring `GoogleCalendarSchedulerService`'s pattern exactly) finds due reservations, renders a staff-editable template (same `{{placeholder}}` mechanism the email templates already use), and sends. Message copy and timing thresholds live on the existing `Settings` singleton row, editable from the existing admin-web Settings page.

**Tech Stack:** NestJS, Prisma/Postgres, the `twilio` npm package (new), React/Vite admin-web, Jest, Vitest/RTL.

**Spec:** `docs/superpowers/specs/2026-09-15-twilio-whatsapp-integration-design.md`

## Global Constraints

- WhatsApp is strictly additional: email sending is never modified or removed by this plan.
- `WhatsappService.sendMessage()` never throws — every failure path (bad phone, missing credentials, Twilio API error) resolves `false` and logs; callers always get a `boolean`.
- A reminder's `*SentAt` column is stamped **only** on a successful send. A failed send leaves it `null` so the next day's cron run retries automatically — no separate retry/dead-letter mechanism.
- One reservation failing inside the scheduler's loop must never stop the rest of the batch — each reservation is wrapped in its own try/catch.
- No WhatsApp-specific debug-mode toggle in this plan (unlike email's `EMAIL_DEBUG_MODE`) — the Twilio Sandbox itself is the safety net right now, since only numbers that texted the join code can receive anything.
- Tests must never hit the real Twilio API — `twilio` is mocked in every unit test the same way `resend` is already mocked in `email.service.spec.ts`.
- Default reminder thresholds: `reservationReminderDaysBefore = 3`, `depositReminderDaysAfter = 3`.
- Default templates (exact text, used as Prisma column defaults):
  - `reservationReminderWhatsappTemplate`: `Hola {{guestName}}! Te recordamos tu reserva en La Brisa de Mar del Plata del {{checkIn}} al {{checkOut}}. ¡Te esperamos!`
  - `depositReminderWhatsappTemplate`: `Hola {{guestName}}, todavía no registramos el depósito de tu reserva del {{checkIn}}. {{paymentInstructions}}`

---

### Task 1: Extract the shared template renderer

**Files:**
- Create: `api/src/common/render-template.ts`
- Modify: `api/src/email/email.service.ts`

**Interfaces:**
- Produces: `renderTemplate(template: string, vars: Record<string, string>): string` — exported from `api/src/common/render-template.ts`. Task 5's `WhatsappReminderSchedulerService` imports this exact function.

This is a pure mechanical extraction — `renderTemplate` already exists verbatim inside `email.service.ts` as a private, untested-in-isolation function. No behavior changes.

- [ ] **Step 1: Create the shared module**

`api/src/common/render-template.ts`:
```typescript
// Simple string-replace substitution, not a template engine: `{{key}}` in staff-edited
// template text is replaced with vars[key]. split/join avoids needing to escape `{{...}}`
// as a regex, since it's matched as a literal string.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((result, [key, value]) => result.split(`{{${key}}}`).join(value), template);
}
```

- [ ] **Step 2: Remove the duplicate from `email.service.ts` and import the shared one**

In `api/src/email/email.service.ts`, delete this block (currently near the top of the file, right after the imports):
```typescript
// Simple string-replace substitution, not a template engine: `{{key}}` in the staff-edited
// template text is replaced with vars[key]. split/join avoids needing to escape `{{...}}` as
// a regex, since it's matched as a literal string.
function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((result, [key, value]) => result.split(`{{${key}}}`).join(value), template);
}
```

Replace the file's import block:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service';
```
with:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service';
import { renderTemplate } from '../common/render-template';
```

Nothing else in `email.service.ts` changes — every call site already just calls `renderTemplate(...)` and keeps working identically.

- [ ] **Step 3: Confirm no regression**

Run: `docker compose exec api npm test -- email.service.spec.ts`
Expected: all existing tests pass unchanged (this file doesn't import or test `renderTemplate` directly — it only exercises it through `EmailService`'s public methods).

- [ ] **Step 4: Commit**

```bash
git add api/src/common/render-template.ts api/src/email/email.service.ts
git commit -m "refactor: extract renderTemplate into a shared module"
```

---

### Task 2: Argentina phone number normalizer

**Files:**
- Create: `api/src/whatsapp/phone-normalizer.ts`, `api/src/whatsapp/phone-normalizer.spec.ts`

**Interfaces:**
- Produces: `normalizeArgentinePhoneForWhatsapp(raw: string): string | null` — pure function. Task 4's `WhatsappService.sendMessage()` is the sole caller.

This is the trickiest, most error-prone part of the feature (see the spec's "Argentina phone number normalization" section for the full rationale) — build it test-first, independent of Twilio or any other code.

- [ ] **Step 1: Write the failing tests**

`api/src/whatsapp/phone-normalizer.spec.ts`:
```typescript
import { normalizeArgentinePhoneForWhatsapp } from './phone-normalizer';

describe('normalizeArgentinePhoneForWhatsapp', () => {
  it('accepts an already-correct E.164 WhatsApp number', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+5491122334455')).toBe('whatsapp:+5491122334455');
  });

  it('inserts the missing 9 after the country code', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+541122334455')).toBe('whatsapp:+5491122334455');
  });

  it('prepends the country code when missing, and inserts the 9', () => {
    expect(normalizeArgentinePhoneForWhatsapp('1122334455')).toBe('whatsapp:+5491122334455');
  });

  it('strips a leading trunk 0', () => {
    expect(normalizeArgentinePhoneForWhatsapp('01122334455')).toBe('whatsapp:+5491122334455');
  });

  it('strips an internal old-style 15 mobile prefix', () => {
    expect(normalizeArgentinePhoneForWhatsapp('011 15 2233-4455')).toBe('whatsapp:+5491122334455');
  });

  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizeArgentinePhoneForWhatsapp('+54 9 (11) 2233-4455')).toBe('whatsapp:+5491122334455');
  });

  it('handles the country code with no + prefix and no 9', () => {
    expect(normalizeArgentinePhoneForWhatsapp('54 11 2233 4455')).toBe('whatsapp:+5491122334455');
  });

  it('returns null for obviously invalid input (too short)', () => {
    expect(normalizeArgentinePhoneForWhatsapp('12345')).toBeNull();
  });

  it('returns null for input with no digits at all', () => {
    expect(normalizeArgentinePhoneForWhatsapp('not a phone number')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizeArgentinePhoneForWhatsapp('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `docker compose exec api npx jest phone-normalizer.spec.ts`
Expected: FAIL — `Cannot find module './phone-normalizer'`.

- [ ] **Step 3: Implement**

`api/src/whatsapp/phone-normalizer.ts`:
```typescript
// Argentine mobile numbers need a `9` inserted right after the `54` country code for
// WhatsApp addressing specifically — this is not how anyone writes or dials the number
// locally, and getting it wrong is a silent failure (the message just never arrives).
// See the design spec's "Argentina phone number normalization" section.
export function normalizeArgentinePhoneForWhatsapp(raw: string): string | null {
  const hasPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (digits.length === 0) {
    return null;
  }

  // Strip a leading trunk 0, used when dialing locally without a country code
  // (e.g. "011 2233-4455" for a Buenos Aires-area number).
  if (!hasPlus && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Assume Argentina when no country code is present.
  if (!digits.startsWith('54')) {
    digits = `54${digits}`;
  }

  // Strip an internal old-style "15" mobile prefix, which appears right after the area
  // code in locally-dialed numbers (e.g. "011 15 2233-4455") and must not appear in the
  // WhatsApp-addressable form.
  const afterCountryCode = digits.slice(2);
  const withoutNineIfPresent = afterCountryCode.startsWith('9') ? afterCountryCode.slice(1) : afterCountryCode;
  const fifteenIndex = withoutNineIfPresent.indexOf('15');
  // Only strip "15" when it appears early (area codes here run 2-4 digits), to avoid
  // accidentally eating "15" if it happens to appear later inside a local number.
  const withoutFifteen =
    fifteenIndex >= 0 && fifteenIndex <= 4
      ? withoutNineIfPresent.slice(0, fifteenIndex) + withoutNineIfPresent.slice(fifteenIndex + 2)
      : withoutNineIfPresent;

  const national = `9${withoutFifteen}`;
  const result = `54${national}`;

  // A real Argentine WhatsApp number is 54 + 9 + 10 digits = 13 digits total.
  if (result.length !== 13) {
    return null;
  }

  return `whatsapp:+${result}`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `docker compose exec api npx jest phone-normalizer.spec.ts`
Expected: PASS, 10/10 tests.

If any case fails, adjust the implementation (not the test) — each test encodes a real input shape from the spec.

- [ ] **Step 5: Commit**

```bash
git add api/src/whatsapp/phone-normalizer.ts api/src/whatsapp/phone-normalizer.spec.ts
git commit -m "feat: add Argentina phone number normalizer for WhatsApp"
```

---

### Task 3: Data model — Settings and Reservation columns

**Files:**
- Modify: `api/prisma/schema.prisma`
- Modify: `api/src/settings/settings.service.ts`
- Modify: `api/src/settings/settings.service.spec.ts`
- Modify: `api/src/settings/dto/update-settings.dto.ts`
- Create: a new Prisma migration (generated, not hand-written)

**Interfaces:**
- Produces: `Settings.reservationReminderDaysBefore: number`, `Settings.depositReminderDaysAfter: number`, `Settings.reservationReminderWhatsappTemplate: string`, `Settings.depositReminderWhatsappTemplate: string`, `Reservation.reservationReminderSentAt: Date | null`, `Reservation.depositReminderSentAt: Date | null`. Task 5's scheduler reads/writes all six of these.

- [ ] **Step 1: Add the new columns to the schema**

In `api/prisma/schema.prisma`, find the `Settings` model and add these four lines right after `cancellationEmailTemplate`:
```prisma
  cancellationEmailTemplate String    @default("")
  reservationReminderDaysBefore       Int    @default(3)
  depositReminderDaysAfter            Int    @default(3)
  reservationReminderWhatsappTemplate String @default("Hola {{guestName}}! Te recordamos tu reserva en La Brisa de Mar del Plata del {{checkIn}} al {{checkOut}}. ¡Te esperamos!")
  depositReminderWhatsappTemplate     String @default("Hola {{guestName}}, todavía no registramos el depósito de tu reserva del {{checkIn}}. {{paymentInstructions}}")
```

Find the `Reservation` model and add these two lines right after `finalConfirmationEmailSentAt`:
```prisma
  finalConfirmationEmailSentAt  DateTime?
  reservationReminderSentAt     DateTime?
  depositReminderSentAt         DateTime?
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
docker compose exec api npx prisma migrate dev --name add_whatsapp_reminders
```
Expected: a new directory under `api/prisma/migrations/` containing a `migration.sql` with `ALTER TABLE "Settings" ADD COLUMN ...` and `ALTER TABLE "Reservation" ADD COLUMN ...` statements, applied automatically to the dev database.

- [ ] **Step 3: Update `SettingsService`'s defaults**

In `api/src/settings/settings.service.ts`, add two new constants right after `DEFAULT_CANCELLATION_EMAIL_TEMPLATE`:
```typescript
const DEFAULT_RESERVATION_REMINDER_WHATSAPP_TEMPLATE =
  'Hola {{guestName}}! Te recordamos tu reserva en La Brisa de Mar del Plata del {{checkIn}} al {{checkOut}}. ¡Te esperamos!';

const DEFAULT_DEPOSIT_REMINDER_WHATSAPP_TEMPLATE =
  'Hola {{guestName}}, todavía no registramos el depósito de tu reserva del {{checkIn}}. {{paymentInstructions}}';
```

In the same file's `get()` method, add these fields to the `data` object passed to `this.prisma.settings.create(...)`:
```typescript
        cancellationEmailTemplate: DEFAULT_CANCELLATION_EMAIL_TEMPLATE,
        reservationReminderDaysBefore: 3,
        depositReminderDaysAfter: 3,
        reservationReminderWhatsappTemplate: DEFAULT_RESERVATION_REMINDER_WHATSAPP_TEMPLATE,
        depositReminderWhatsappTemplate: DEFAULT_DEPOSIT_REMINDER_WHATSAPP_TEMPLATE,
```
(This mirrors the existing `initialEmailTemplate`/`finalEmailTemplate`/`cancellationEmailTemplate` lines immediately above it — the Prisma column `@default(...)` only applies when a row is inserted without that field ever being mentioned; this codebase's convention is to also list every field explicitly in `create()`, so follow that.)

- [ ] **Step 4: Update the DTO**

In `api/src/settings/dto/update-settings.dto.ts`, change the import line:
```typescript
import { IsOptional, IsString, MinLength } from 'class-validator';
```
to:
```typescript
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
```

Add these fields at the end of the class, right before the closing `}`:
```typescript
  @IsInt()
  @Min(1)
  reservationReminderDaysBefore: number;

  @IsInt()
  @Min(1)
  depositReminderDaysAfter: number;

  @IsString()
  @MinLength(1)
  reservationReminderWhatsappTemplate: string;

  @IsString()
  @MinLength(1)
  depositReminderWhatsappTemplate: string;
```

- [ ] **Step 5: Update `settings.service.spec.ts`'s `update` test**

In `api/src/settings/settings.service.spec.ts`, the `'updates settings'` test calls `service.update({...})` with an object that must satisfy `UpdateSettingsDto`. Add the four new fields to that call's argument object:
```typescript
    const result = await service.update({
      houseRulesText: 'new rules',
      paymentInstructions: 'new payment info',
      depositInstructions: 'new deposit info',
      propertyAddress: 'new address',
      googleMapsUrl: 'https://maps.example/new',
      initialEmailTemplate: 'new initial template',
      finalEmailTemplate: 'new final template',
      cancellationEmailTemplate: 'new cancellation template',
      reservationReminderDaysBefore: 3,
      depositReminderDaysAfter: 3,
      reservationReminderWhatsappTemplate: 'new reservation reminder template',
      depositReminderWhatsappTemplate: 'new deposit reminder template',
    });
```

- [ ] **Step 6: Run the tests**

Run: `docker compose exec api npm test -- settings.service.spec.ts`
Expected: PASS, all tests green (TypeScript would otherwise fail to compile this file if the DTO shape and the test call don't match).

Run: `docker compose exec api npm run build`
Expected: clean build — this confirms the Prisma client (regenerated automatically by `prisma migrate dev`) and the DTO changes are all consistent.

- [ ] **Step 7: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/migrations api/src/settings/settings.service.ts api/src/settings/settings.service.spec.ts api/src/settings/dto/update-settings.dto.ts
git commit -m "feat: add WhatsApp reminder settings fields and Reservation tracking columns"
```

---

### Task 4: `WhatsappService`

**Files:**
- Create: `api/src/whatsapp/whatsapp.service.ts`, `api/src/whatsapp/whatsapp.service.spec.ts`
- Modify: `api/package.json` (new `twilio` dependency)

**Interfaces:**
- Consumes: `normalizeArgentinePhoneForWhatsapp` from Task 2 (`api/src/whatsapp/phone-normalizer.ts`).
- Produces: `WhatsappService.sendMessage(rawPhone: string, body: string): Promise<boolean>` — Task 5's scheduler is the sole caller.

- [ ] **Step 1: Install the Twilio SDK**

Run:
```bash
docker compose exec api npm install twilio
```
Expected: `api/package.json` gains a `twilio` entry under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`api/src/whatsapp/whatsapp.service.spec.ts`:
```typescript
const createMock = jest.fn();

jest.mock('twilio', () => jest.fn().mockImplementation(() => ({ messages: { create: createMock } })));

import { WhatsappService } from './whatsapp.service';

describe('WhatsappService', () => {
  let service: WhatsappService;

  beforeEach(() => {
    createMock.mockReset();
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
    service = new WhatsappService();
  });

  it('sends a message to a normalized phone number and returns true', async () => {
    createMock.mockResolvedValue({ sid: 'SM123' });

    const result = await service.sendMessage('+54 9 11 2233-4455', 'Hola!');

    expect(result).toBe(true);
    expect(createMock).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+5491122334455',
      body: 'Hola!',
    });
  });

  it('returns false and never calls Twilio when the phone cannot be normalized', async () => {
    const result = await service.sendMessage('not a phone number', 'Hola!');

    expect(result).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns false when the Twilio API call throws', async () => {
    createMock.mockRejectedValue(new Error('Twilio is down'));

    const result = await service.sendMessage('+5491122334455', 'Hola!');

    expect(result).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `docker compose exec api npx jest whatsapp.service.spec.ts`
Expected: FAIL — `Cannot find module './whatsapp.service'`.

- [ ] **Step 4: Implement**

`api/src/whatsapp/whatsapp.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import Twilio from 'twilio';
import { normalizeArgentinePhoneForWhatsapp } from './phone-normalizer';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  private readonly from = process.env.TWILIO_WHATSAPP_FROM as string;

  // Never throws: every caller gets a plain boolean, matching this feature's "log it
  // silently, never block anything else" failure-handling decision (see the design spec).
  async sendMessage(rawPhone: string, body: string): Promise<boolean> {
    const to = normalizeArgentinePhoneForWhatsapp(rawPhone);
    if (!to) {
      this.logger.warn(`Could not normalize phone number for WhatsApp: ${rawPhone}`);
      return false;
    }

    try {
      await this.client.messages.create({ from: this.from, to, body });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp message to ${to}: ${(error as Error).message}`);
      return false;
    }
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `docker compose exec api npx jest whatsapp.service.spec.ts`
Expected: PASS, 3/3 tests.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json api/src/whatsapp/whatsapp.service.ts api/src/whatsapp/whatsapp.service.spec.ts
git commit -m "feat: add WhatsappService wrapping the Twilio SDK"
```

---

### Task 5: `WhatsappReminderSchedulerService`

**Files:**
- Create: `api/src/whatsapp/whatsapp-reminder.scheduler.ts`, `api/src/whatsapp/whatsapp-reminder.scheduler.spec.ts`

**Interfaces:**
- Consumes: `WhatsappService.sendMessage(rawPhone, body): Promise<boolean>` (Task 4), `renderTemplate(template, vars): string` (Task 1), `SettingsService.get()` (existing — now also returns the four new fields from Task 3), `PrismaService.reservation.findMany(...)` / `.update(...)` (existing).
- Produces: `WhatsappReminderSchedulerService` with a single `@Cron`-decorated method `handleDailyReminders(): Promise<void>` — registered as a provider in Task 6's `WhatsappModule`, never called directly by anything else.

First, read the existing pattern this mirrors:

`api/src/google-calendar/google-calendar-scheduler.service.ts` (for reference — do not modify this file):
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

- [ ] **Step 1: Write the failing tests**

`api/src/whatsapp/whatsapp-reminder.scheduler.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { WhatsappReminderSchedulerService } from './whatsapp-reminder.scheduler';
import { WhatsappService } from './whatsapp.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WhatsappReminderSchedulerService', () => {
  let scheduler: WhatsappReminderSchedulerService;
  let prisma: { reservation: { findMany: jest.Mock; update: jest.Mock } };
  let whatsappService: { sendMessage: jest.Mock };
  let settingsService: { get: jest.Mock };

  const baseSettings = {
    reservationReminderDaysBefore: 3,
    depositReminderDaysAfter: 3,
    reservationReminderWhatsappTemplate: 'Reminder for {{guestName}}: {{checkIn}} to {{checkOut}}',
    depositReminderWhatsappTemplate: 'Deposit reminder for {{guestName}}: {{checkIn}}. {{paymentInstructions}}',
    paymentInstructions: 'Transfer to CBU 123',
  };

  beforeEach(async () => {
    prisma = { reservation: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } };
    whatsappService = { sendMessage: jest.fn() };
    settingsService = { get: jest.fn().mockResolvedValue(baseSettings) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappReminderSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsappService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    scheduler = moduleRef.get(WhatsappReminderSchedulerService);
  });

  it('sends a reservation reminder and stamps reservationReminderSentAt on success', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([
        { id: 'res-1', guestName: 'Jane', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
      ])
      .mockResolvedValueOnce([]);
    whatsappService.sendMessage.mockResolvedValue(true);

    await scheduler.handleDailyReminders();

    expect(whatsappService.sendMessage).toHaveBeenCalledWith(
      '+5491122334455',
      expect.stringContaining('Jane'),
    );
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { reservationReminderSentAt: expect.any(Date) },
    });
  });

  it('does not stamp reservationReminderSentAt when the send fails', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([
        { id: 'res-1', guestName: 'Jane', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
      ])
      .mockResolvedValueOnce([]);
    whatsappService.sendMessage.mockResolvedValue(false);

    await scheduler.handleDailyReminders();

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('sends a deposit reminder and stamps depositReminderSentAt on success', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'res-2', guestName: 'John', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18') },
      ]);
    whatsappService.sendMessage.mockResolvedValue(true);

    await scheduler.handleDailyReminders();

    expect(whatsappService.sendMessage).toHaveBeenCalledWith(
      '+5491122334455',
      expect.stringContaining('CBU 123'),
    );
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-2' },
      data: { depositReminderSentAt: expect.any(Date) },
    });
  });

  it('continues processing remaining reservations when one send throws', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([
        { id: 'res-1', guestName: 'Jane', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
        { id: 'res-2', guestName: 'Bob', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
      ])
      .mockResolvedValueOnce([]);
    whatsappService.sendMessage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);

    await scheduler.handleDailyReminders();

    expect(prisma.reservation.update).toHaveBeenCalledTimes(1);
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-2' },
      data: { reservationReminderSentAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `docker compose exec api npx jest whatsapp-reminder.scheduler.spec.ts`
Expected: FAIL — `Cannot find module './whatsapp-reminder.scheduler'`.

- [ ] **Step 3: Implement**

`api/src/whatsapp/whatsapp-reminder.scheduler.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsappService } from './whatsapp.service';
import { renderTemplate } from '../common/render-template';

function startOfUtcDayOffset(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

@Injectable()
export class WhatsappReminderSchedulerService {
  private readonly logger = new Logger(WhatsappReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleDailyReminders(): Promise<void> {
    const settings = await this.settingsService.get();

    await this.sendReservationReminders(settings);
    await this.sendDepositReminders(settings);
  }

  private async sendReservationReminders(settings: {
    reservationReminderDaysBefore: number;
    reservationReminderWhatsappTemplate: string;
  }): Promise<void> {
    // checkIn/checkOut are stored as UTC midnight with no time-of-day component (same
    // convention EmailService's cancellation email relies on), so an exact-date match
    // is a plain equality check against that midnight timestamp.
    const targetCheckIn = startOfUtcDayOffset(settings.reservationReminderDaysBefore);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        guestPhone: { not: null },
        reservationReminderSentAt: null,
        checkIn: targetCheckIn,
      },
    });

    for (const reservation of reservations) {
      try {
        const body = renderTemplate(settings.reservationReminderWhatsappTemplate, {
          guestName: reservation.guestName,
          checkIn: formatDateOnly(reservation.checkIn),
          checkOut: formatDateOnly(reservation.checkOut),
        });
        const sent = await this.whatsappService.sendMessage(reservation.guestPhone as string, body);
        if (sent) {
          await this.prisma.reservation.update({
            where: { id: reservation.id },
            data: { reservationReminderSentAt: new Date() },
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to send reservation reminder for ${reservation.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async sendDepositReminders(settings: {
    depositReminderDaysAfter: number;
    depositReminderWhatsappTemplate: string;
    paymentInstructions: string;
  }): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - settings.depositReminderDaysAfter);

    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: { not: 'CANCELLED' },
        guestPhone: { not: null },
        confirmationPaymentReceivedAt: null,
        depositReminderSentAt: null,
        confirmationEmailSentAt: { not: null, lte: cutoff },
      },
    });

    for (const reservation of reservations) {
      try {
        const body = renderTemplate(settings.depositReminderWhatsappTemplate, {
          guestName: reservation.guestName,
          checkIn: formatDateOnly(reservation.checkIn),
          paymentInstructions: settings.paymentInstructions,
        });
        const sent = await this.whatsappService.sendMessage(reservation.guestPhone as string, body);
        if (sent) {
          await this.prisma.reservation.update({
            where: { id: reservation.id },
            data: { depositReminderSentAt: new Date() },
          });
        }
      } catch (error) {
        this.logger.error(`Failed to send deposit reminder for ${reservation.id}: ${(error as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `docker compose exec api npx jest whatsapp-reminder.scheduler.spec.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/whatsapp/whatsapp-reminder.scheduler.ts api/src/whatsapp/whatsapp-reminder.scheduler.spec.ts
git commit -m "feat: add daily WhatsApp reminder scheduler"
```

---

### Task 6: Wire up `WhatsappModule`

**Files:**
- Create: `api/src/whatsapp/whatsapp.module.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `WhatsappService` (Task 4), `WhatsappReminderSchedulerService` (Task 5), `SettingsModule` (existing).
- Produces: `WhatsappModule`, registered in `AppModule` — nothing outside this module needs to import it directly, since the scheduler is self-contained (Nest's `@Cron` wiring happens automatically once the provider is registered and `ScheduleModule.forRoot()` is imported, which `AppModule` already does).

- [ ] **Step 1: Create the module**

`api/src/whatsapp/whatsapp.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappReminderSchedulerService } from './whatsapp-reminder.scheduler';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [WhatsappService, WhatsappReminderSchedulerService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
```

- [ ] **Step 2: Register it in `AppModule`**

In `api/src/app.module.ts`, add the import:
```typescript
import { ChannelImportModule } from './channel-import/channel-import.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
```

And add `WhatsappModule` to the `imports` array, right after `ChannelImportModule`:
```typescript
    ReservationImportModule,
    ChannelImportModule,
    WhatsappModule,
  ],
```

- [ ] **Step 3: Confirm the app still boots and builds**

Run: `docker compose exec api npm run build`
Expected: clean build, no errors.

Run: `docker compose exec api npm run test:e2e -- app.e2e-spec.ts`
Expected: PASS — this test boots the full `AppModule`, so it's a real smoke test that `WhatsappModule` wires up without errors (missing `TWILIO_*` env vars won't throw at boot time since `WhatsappService`'s constructor just reads `process.env.*` into fields — it only fails when `sendMessage` is actually called).

- [ ] **Step 4: Commit**

```bash
git add api/src/whatsapp/whatsapp.module.ts api/src/app.module.ts
git commit -m "feat: register WhatsappModule in AppModule"
```

---

### Task 7: Settings API — e2e coverage and deployment docs

**Files:**
- Modify: `api/test/settings.e2e-spec.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `GET /settings` / `PUT /settings` (existing endpoints, now returning/accepting the four new fields from Task 3).

- [ ] **Step 1: Extend the e2e test's type and PUT payload**

In `api/test/settings.e2e-spec.ts`, extend the `originalSettings` type declaration:
```typescript
  let originalSettings: {
    houseRulesText: string;
    paymentInstructions: string;
    depositInstructions: string;
    propertyAddress: string;
    googleMapsUrl: string;
    initialEmailTemplate: string;
    finalEmailTemplate: string;
    cancellationEmailTemplate: string;
    bookingIcalUrl: string | null;
    airbnbIcalUrl: string | null;
    reservationReminderDaysBefore: number;
    depositReminderDaysAfter: number;
    reservationReminderWhatsappTemplate: string;
    depositReminderWhatsappTemplate: string;
  } | null;
```

Add a new test right after the existing `'persists bookingIcalUrl and airbnbIcalUrl through PUT /settings'` test:
```typescript
  it('persists the WhatsApp reminder settings through PUT /settings', async () => {
    const response = await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        houseRulesText: 'E2E house rules',
        paymentInstructions: 'E2E payment instructions',
        depositInstructions: 'E2E deposit instructions',
        propertyAddress: 'E2E property address',
        googleMapsUrl: 'https://maps.example/e2e',
        initialEmailTemplate: 'E2E initial template {{guestName}}',
        finalEmailTemplate: 'E2E final template {{guestName}}',
        cancellationEmailTemplate: 'E2E cancellation template {{guestName}}',
        reservationReminderDaysBefore: 5,
        depositReminderDaysAfter: 4,
        reservationReminderWhatsappTemplate: 'E2E WhatsApp reservation reminder {{guestName}}',
        depositReminderWhatsappTemplate: 'E2E WhatsApp deposit reminder {{guestName}}',
      })
      .expect(200);

    expect(response.body.reservationReminderDaysBefore).toBe(5);
    expect(response.body.depositReminderDaysAfter).toBe(4);
    expect(response.body.reservationReminderWhatsappTemplate).toBe('E2E WhatsApp reservation reminder {{guestName}}');
    expect(response.body.depositReminderWhatsappTemplate).toBe('E2E WhatsApp deposit reminder {{guestName}}');

    const getResponse = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(getResponse.body.reservationReminderDaysBefore).toBe(5);
    expect(getResponse.body.depositReminderDaysAfter).toBe(4);
  });
```

- [ ] **Step 2: Run the e2e test**

Run: `docker compose exec api npm run test:e2e -- settings.e2e-spec.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 3: Document the new env vars**

In `.env.example`, add a new section right after the existing `# Google Calendar` block:
```
# Twilio WhatsApp
TWILIO_ACCOUNT_SID=ACchangeme
TWILIO_AUTH_TOKEN=changeme
# The Sandbox number while testing (each recipient must first text the Sandbox's join
# code to this number); becomes the approved Business Sender number once you have one.
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

In `README.md`'s "Production deployment" section, add a new bullet to the numbered list of env vars to set on the server, right after the existing "**Email:**" bullet:
```
   - **WhatsApp (Twilio):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` — while
     using Twilio's WhatsApp Sandbox, any phone number you want to test with must first text the
     Sandbox's join code to the Sandbox number before it can receive anything. Real, un-prompted
     guest messaging requires a verified WhatsApp Business Sender (a Twilio/Meta business
     verification process, not a config change).
```

- [ ] **Step 4: Commit**

```bash
git add api/test/settings.e2e-spec.ts .env.example README.md
git commit -m "test: cover WhatsApp settings fields; docs: document Twilio env vars"
```

---

### Task 8: admin-web Settings page — WhatsApp section

**Files:**
- Modify: `admin-web/src/api/settings.ts`
- Modify: `admin-web/src/settings/SettingsPage.tsx`
- Modify: `admin-web/src/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `getSettings()` / `updateSettings()` (existing, now round-tripping the four new fields).

- [ ] **Step 1: Extend the `Settings` interface and both API functions' implicit shape**

In `admin-web/src/api/settings.ts`, add four fields to the `Settings` interface, right after `cancellationEmailTemplate`:
```typescript
export interface Settings {
  houseRulesText: string;
  paymentInstructions: string;
  depositInstructions: string;
  propertyAddress: string;
  googleMapsUrl: string;
  initialEmailTemplate: string;
  finalEmailTemplate: string;
  cancellationEmailTemplate: string;
  reservationReminderDaysBefore: number;
  depositReminderDaysAfter: number;
  reservationReminderWhatsappTemplate: string;
  depositReminderWhatsappTemplate: string;
  bookingIcalUrl: string | null;
  airbnbIcalUrl: string | null;
  lastChannelSyncAt: string | null;
  lastChannelSyncError: string | null;
}
```
(`getSettings`/`updateSettings` themselves don't change — they already just pass the whole object through.)

- [ ] **Step 2: Add state, load, save, and the new form section in `SettingsPage.tsx`**

Add four new `useState` declarations right after `cancellationEmailTemplate`'s:
```typescript
  const [cancellationEmailTemplate, setCancellationEmailTemplate] = useState('');
  const [reservationReminderDaysBefore, setReservationReminderDaysBefore] = useState(3);
  const [depositReminderDaysAfter, setDepositReminderDaysAfter] = useState(3);
  const [reservationReminderWhatsappTemplate, setReservationReminderWhatsappTemplate] = useState('');
  const [depositReminderWhatsappTemplate, setDepositReminderWhatsappTemplate] = useState('');
```

In the `getSettings().then(...)` block, add four lines right after `setCancellationEmailTemplate(...)`:
```typescript
        setCancellationEmailTemplate(settings.cancellationEmailTemplate);
        setReservationReminderDaysBefore(settings.reservationReminderDaysBefore);
        setDepositReminderDaysAfter(settings.depositReminderDaysAfter);
        setReservationReminderWhatsappTemplate(settings.reservationReminderWhatsappTemplate);
        setDepositReminderWhatsappTemplate(settings.depositReminderWhatsappTemplate);
```

In `handleSubmit`'s call to `updateSettings({...})`, add four fields right after `cancellationEmailTemplate,`:
```typescript
        cancellationEmailTemplate,
        reservationReminderDaysBefore,
        depositReminderDaysAfter,
        reservationReminderWhatsappTemplate,
        depositReminderWhatsappTemplate,
```

In the JSX, add a new section right after the existing cancellation-email `FormField`/variables paragraph and before `{saved && <Alert tone="success">Guardado</Alert>}`:
```tsx
        <div className="mt-4">
          <h2 className="mb-1 font-heading text-lg font-semibold text-heading">Recordatorios de WhatsApp</h2>
          <p className="mb-4 text-sm text-text-muted">
            Se envían automáticamente por WhatsApp (vía Twilio) cuando el huésped tiene un
            número de teléfono cargado. Podés usar las mismas variables entre llaves dobles
            indicadas debajo de cada uno.
          </p>
        </div>
        <FormField label="Días antes del check-in para el recordatorio de reserva">
          <Input
            type="number"
            min={1}
            value={reservationReminderDaysBefore}
            onChange={(e) => setReservationReminderDaysBefore(Number(e.target.value))}
          />
        </FormField>
        <FormField label="Mensaje de recordatorio de reserva">
          <Textarea
            value={reservationReminderWhatsappTemplate}
            onChange={(e) => setReservationReminderWhatsappTemplate(e.target.value)}
            rows={4}
          />
        </FormField>
        <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{checkIn}} {{checkOut}}'}</p>

        <FormField label="Días después del email inicial para el recordatorio de depósito">
          <Input
            type="number"
            min={1}
            value={depositReminderDaysAfter}
            onChange={(e) => setDepositReminderDaysAfter(Number(e.target.value))}
          />
        </FormField>
        <FormField label="Mensaje de recordatorio de depósito">
          <Textarea
            value={depositReminderWhatsappTemplate}
            onChange={(e) => setDepositReminderWhatsappTemplate(e.target.value)}
            rows={4}
          />
        </FormField>
        <p className="-mt-2 text-xs text-text-muted">Variables: {'{{guestName}} {{checkIn}} {{paymentInstructions}}'}</p>
```

- [ ] **Step 3: Extend `SettingsPage.test.tsx`**

Add the four new fields to `baseSettings`:
```typescript
const baseSettings: settingsApi.Settings = {
  houseRulesText: 'Rules',
  paymentInstructions: 'Pay',
  depositInstructions: 'Deposit info',
  propertyAddress: '123 Main St',
  googleMapsUrl: 'https://maps.example/labrisa',
  initialEmailTemplate: 'Hi {{guestName}}, {{confirmationUrl}}',
  finalEmailTemplate: 'Hi {{guestName}}, {{propertyAddress}} {{googleMapsUrl}}',
  cancellationEmailTemplate: 'Hi {{guestName}}, {{checkIn}} to {{checkOut}}',
  reservationReminderDaysBefore: 3,
  depositReminderDaysAfter: 3,
  reservationReminderWhatsappTemplate: 'Reminder for {{guestName}}: {{checkIn}} to {{checkOut}}',
  depositReminderWhatsappTemplate: 'Deposit reminder for {{guestName}}: {{checkIn}}',
  bookingIcalUrl: null,
  airbnbIcalUrl: null,
  lastChannelSyncAt: null,
  lastChannelSyncError: null,
};
```

Add a new test, right after the existing `'loads and saves the deposit description, address, maps link, and email templates'` test:
```typescript
  it('loads and saves the WhatsApp reminder settings', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue(baseSettings);
    const updateSpy = vi.spyOn(settingsApi, 'updateSettings').mockResolvedValue(baseSettings);

    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/días antes del check-in/i)).toHaveValue(3),
    );
    expect(screen.getByLabelText(/mensaje de recordatorio de reserva/i)).toHaveValue(
      'Reminder for {{guestName}}: {{checkIn}} to {{checkOut}}',
    );
    expect(screen.getByLabelText(/días después del email inicial/i)).toHaveValue(3);
    expect(screen.getByLabelText(/mensaje de recordatorio de depósito/i)).toHaveValue(
      'Deposit reminder for {{guestName}}: {{checkIn}}',
    );

    fireEvent.change(screen.getByLabelText(/mensaje de recordatorio de reserva/i), {
      target: { value: 'Updated reservation reminder' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reservationReminderWhatsappTemplate: 'Updated reservation reminder' }),
      ),
    );
  });
```

- [ ] **Step 4: Run the tests and the build**

Run: `docker compose exec admin-web npx vitest run src/settings/SettingsPage.test.tsx`
Expected: PASS, all tests including the new one.

Run: `docker compose exec admin-web npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/api/settings.ts admin-web/src/settings/SettingsPage.tsx admin-web/src/settings/SettingsPage.test.tsx
git commit -m "feat: add WhatsApp reminder settings to the admin Settings page"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Full API unit suite**

Run: `docker compose exec api npm test`
Expected: all suites pass (this repo is currently at 18 suites / 159 tests before this plan; expect that plus the new `phone-normalizer.spec.ts`, `whatsapp.service.spec.ts`, and `whatsapp-reminder.scheduler.spec.ts` files, each fully green).

- [ ] **Step 2: Full API e2e suite**

Run: `docker compose exec api npm run test:e2e`
Expected: all suites pass. If exactly one unrelated suite fails on a shared-Postgres-row race (a known, previously-diagnosed flake in this repo's e2e suite — not something this plan's changes would cause), re-run that suite alone (`docker compose exec api npx jest --config ./test/jest-e2e.json <suite-name>`) to confirm it passes in isolation, then re-run the full suite once more to confirm a clean run. Do not chase this flake further — it predates this plan.

- [ ] **Step 3: Full admin-web suite and build**

Run: `docker compose exec admin-web npm test`
Expected: all suites pass.

Run: `docker compose exec admin-web npm run build`
Expected: clean build.

- [ ] **Step 4: Report**

No commit for this task (verification-only) — report the final suite/test counts.
