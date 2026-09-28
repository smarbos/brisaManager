# Guest Change History / Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every change to a `Guest`'s name, phone, email, or unsubscribe status as a `GuestEvent`, and surface that history on admin-web's guest detail page and as a new tab on the activity log page.

**Architecture:** A new `GuestEvent` Prisma model, structurally identical to the existing `ReservationEvent`, written by a new `GuestEventsService` that mirrors `ReservationEventsService` field-for-field. The only two places a `Guest`'s tracked fields are ever written — `GuestsService.syncFromReservation()` and `GuestsService.unsubscribeByToken()` — are extended to diff old vs. new values and call `GuestEventsService.record()` for each field that actually changed. Frontend surfaces reuse the existing `ExtensionErrorsTab`/`ReservationFormPage` event-list patterns rather than inventing new ones.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest (backend unit + e2e), React 19, Vitest + Testing Library (frontend), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-24-guest-change-history-design.md`

## Global Constraints

- `GuestEvent` mirrors `ReservationEvent`'s shape exactly: `{ id, <parent>Id, <parent relation>, type (enum), detail (String?), createdAt }`. No extra columns.
- Only `syncFromReservation()` and `unsubscribeByToken()` write `Guest.name`/`phone`/`email`/`unsubscribedAt` — confirmed by grepping every `prisma.guest.update`/`upsert`/`updateMany` call site in the repo. No other file needs touching to make event recording complete.
- `detail` strings use the format `<Campo>: "<antes>" → "<después>"` with Spanish field labels (`Nombre`, `Teléfono`, `Email`) matching existing admin-web copy; a previously-empty value reads `(vacío)` on the "before" side. `UNSUBSCRIBED` has no `detail` (null).
- `name` is trimmed before both storage and comparison (matching how `email`/`phone` are already trimmed) so incidental whitespace never produces a false "changed" event.
- `phone`/`email` are only compared (and only ever get recorded as changed) when the current sync's input actually supplies a non-null value — when the input omits one, Prisma's `?? undefined` leaves the stored value untouched, so there is nothing to diff.
- A brand-new guest (no pre-existing row to diff against) never produces any `GuestEvent`.
- Every new backend file/route follows the exact JWT-guard and route-naming conventions already used by `ReservationEventsService`/`Controller`/`Module` — copy their structure, don't invent a new one.

---

### Task 1: Prisma schema — `GuestEvent` model and migration

**Files:**
- Modify: `api/prisma/schema.prisma`

**Interfaces:**
- Produces: `GuestEvent` model (`id`, `guestId`, `guest`, `type: GuestEventType`, `detail: String?`, `createdAt`), `GuestEventType` enum (`NAME_CHANGED`, `PHONE_CHANGED`, `EMAIL_CHANGED`, `UNSUBSCRIBED`), and `Guest.guestEvents GuestEvent[]` — every later task's Prisma calls depend on these existing in the generated client.

- [ ] **Step 1: Add the enum and model to `schema.prisma`**

Find the existing `Guest` model (starts `model Guest {`) and the existing `ReservationEvent` model (for the enum placement — put the new enum next to `ReservationEventType`, around line 24-39). Add this enum right after `enum ReservationEventType { ... }`:

```prisma
enum GuestEventType {
  NAME_CHANGED
  PHONE_CHANGED
  EMAIL_CHANGED
  UNSUBSCRIBED
}
```

Add the `guestEvents` relation field inside `model Guest { ... }`, alongside the existing `reservations`/`campaignRecipients` relation fields:

```prisma
model Guest {
  id                 String              @id @default(uuid())
  email              String?             @unique
  name               String
  phone              String?             @unique
  totalStays         Int                 @default(0)
  lastStayAt         DateTime?
  unsubscribedAt     DateTime?
  unsubscribeToken   String              @unique @default(uuid())
  reservations       Reservation[]
  campaignRecipients CampaignRecipient[]
  guestEvents        GuestEvent[]
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
}
```

(Keep the existing comment above `email` untouched — only the new `guestEvents` line is added.)

Add the new model right after `model Guest { ... }` closes, before `model CampaignTemplate`:

```prisma
// One row per actual change to a Guest's tracked fields — written only by
// GuestsService.syncFromReservation() (name/phone/email) and
// GuestsService.unsubscribeByToken() (UNSUBSCRIBED), the only two places those
// fields are ever written. Mirrors ReservationEvent's shape exactly.
model GuestEvent {
  id        String         @id @default(uuid())
  guestId   String
  guest     Guest          @relation(fields: [guestId], references: [id])
  type      GuestEventType
  detail    String?
  createdAt DateTime       @default(now())
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `docker compose exec api npx prisma migrate dev --name add_guest_event`

Expected: output ends with `Your database is now in sync with your schema.` and `✔ Generated Prisma Client`. A new directory appears under `api/prisma/migrations/` containing a `migration.sql` that creates the `GuestEvent` table and `GuestEventType` enum type.

- [ ] **Step 3: Verify the schema is valid**

Run: `docker compose exec api npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/migrations/
git commit -m "Add GuestEvent model and migration"
```

---

### Task 2: Backend — `GuestEventsService`, `GuestEventsController`, `GuestEventsModule`

**Files:**
- Create: `api/src/guest-events/guest-events.service.ts`
- Create: `api/src/guest-events/guest-events.service.spec.ts`
- Create: `api/src/guest-events/guest-events.controller.ts`
- Create: `api/src/guest-events/guest-events.module.ts`
- Modify: `api/src/app.module.ts`

**Interfaces:**
- Consumes: `GuestEventType` from `@prisma/client` (Task 1).
- Produces: `GuestEventsService.record(guestId: string, type: GuestEventType, detail?: string): Promise<GuestEvent>`, `GuestEventsService.listForGuest(guestId: string): Promise<GuestEvent[]>`, `GuestEventsService.listAll(): Promise<GuestEvent[]>` — Task 3, 4, 5 inject and call these exact methods.

- [ ] **Step 1: Write the failing service test**

Create `api/src/guest-events/guest-events.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { GuestEventsService } from './guest-events.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GuestEventsService', () => {
  let service: GuestEventsService;
  let prisma: {
    guestEvent: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = { guestEvent: { create: jest.fn(), findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [GuestEventsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(GuestEventsService);
  });

  it('records an event', async () => {
    prisma.guestEvent.create.mockResolvedValue({ id: '1' });

    await service.record('guest-1', 'UNSUBSCRIBED');

    expect(prisma.guestEvent.create).toHaveBeenCalledWith({
      data: { guestId: 'guest-1', type: 'UNSUBSCRIBED', detail: undefined },
    });
  });

  it('records an event with a detail message', async () => {
    prisma.guestEvent.create.mockResolvedValue({ id: '1' });

    await service.record('guest-1', 'NAME_CHANGED', 'Nombre: "Jane" → "Jane Doe"');

    expect(prisma.guestEvent.create).toHaveBeenCalledWith({
      data: { guestId: 'guest-1', type: 'NAME_CHANGED', detail: 'Nombre: "Jane" → "Jane Doe"' },
    });
  });

  it('lists events for a guest ordered most-recent-first', async () => {
    prisma.guestEvent.findMany.mockResolvedValue([]);

    await service.listForGuest('guest-1');

    expect(prisma.guestEvent.findMany).toHaveBeenCalledWith({
      where: { guestId: 'guest-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('lists every event across all guests, most-recent-first, with the guest it belongs to', async () => {
    prisma.guestEvent.findMany.mockResolvedValue([]);

    await service.listAll();

    expect(prisma.guestEvent.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { guest: { select: { name: true, email: true } } },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec api npx jest guest-events.service`
Expected: FAIL — `Cannot find module './guest-events.service'`

- [ ] **Step 3: Write the service**

Create `api/src/guest-events/guest-events.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { GuestEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GuestEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(guestId: string, type: GuestEventType, detail?: string) {
    return this.prisma.guestEvent.create({
      data: { guestId, type, detail },
    });
  }

  listForGuest(guestId: string) {
    return this.prisma.guestEvent.findMany({
      where: { guestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll() {
    return this.prisma.guestEvent.findMany({
      orderBy: { createdAt: 'desc' },
      include: { guest: { select: { name: true, email: true } } },
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose exec api npx jest guest-events.service`
Expected: PASS, 4 tests

- [ ] **Step 5: Write the controller**

Create `api/src/guest-events/guest-events.controller.ts`:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuestEventsService } from './guest-events.service';

@UseGuards(JwtAuthGuard)
@Controller('guest-events')
export class GuestEventsController {
  constructor(private readonly guestEventsService: GuestEventsService) {}

  @Get()
  listAll() {
    return this.guestEventsService.listAll();
  }
}
```

- [ ] **Step 6: Write the module**

Create `api/src/guest-events/guest-events.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { GuestEventsService } from './guest-events.service';
import { GuestEventsController } from './guest-events.controller';

@Global()
@Module({
  controllers: [GuestEventsController],
  providers: [GuestEventsService],
  exports: [GuestEventsService],
})
export class GuestEventsModule {}
```

- [ ] **Step 7: Register the module in `AppModule`**

In `api/src/app.module.ts`, add the import alongside the existing `ReservationEventsModule` import:

```typescript
import { ReservationEventsModule } from './reservation-events/reservation-events.module';
import { GuestEventsModule } from './guest-events/guest-events.module';
```

And add `GuestEventsModule` to the `imports` array in the `@Module({...})` decorator, next to `ReservationEventsModule`:

```typescript
    ReservationEventsModule,
    GuestEventsModule,
```

- [ ] **Step 8: Verify the app still compiles with the new module wired in**

Run: `docker compose exec api npx tsc --noEmit`
Expected: no output (no errors)

- [ ] **Step 9: Commit**

```bash
git add api/src/guest-events/ api/src/app.module.ts
git commit -m "Add GuestEventsService, controller, and module"
```

---

### Task 3: Backend — `GuestsService.syncFromReservation()` records field changes

**Files:**
- Modify: `api/src/guests/guests.service.ts`
- Modify: `api/src/guests/guests.service.spec.ts`

**Interfaces:**
- Consumes: `GuestEventsService.record(guestId, type, detail?)` from Task 2.
- Produces: nothing new consumed by later tasks — this task's behavior is verified directly by its own tests and by the e2e test in Task 6.

- [ ] **Step 1: Update the test file's mock scaffold to inject `GuestEventsService`**

In `api/src/guests/guests.service.spec.ts`, add the import and update the `beforeEach` block:

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GuestsService } from './guests.service';
import { PrismaService } from '../prisma/prisma.service';
import { GuestEventsService } from '../guest-events/guest-events.service';

describe('GuestsService', () => {
  let service: GuestsService;
  let prisma: {
    guest: {
      upsert: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
    };
    reservation: { update: jest.Mock; aggregate: jest.Mock };
  };
  let guestEventsService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      guest: {
        upsert: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      reservation: { update: jest.fn(), aggregate: jest.fn() },
    };
    guestEventsService = { record: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GuestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GuestEventsService, useValue: guestEventsService },
      ],
    }).compile();

    service = moduleRef.get(GuestsService);
  });
```

- [ ] **Step 2: Update the two existing `syncFromReservation` tests to mock `findUnique`**

The existing `'upserts a Guest by lowercased email...'` test currently doesn't mock `prisma.guest.findUnique`, which the new code will call before the upsert. Add `prisma.guest.findUnique.mockResolvedValue(null);` as its first line (this guest is new — `findUnique` returning `null` means no pre-existing row, so no event should fire):

```typescript
    it('upserts a Guest by lowercased email, links the reservation, and recomputes stats', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1', email: 'jane@example.com' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 3 }, _max: { checkOut: new Date('2026-05-01') } });

      await service.syncFromReservation('res-1', { email: 'Jane@Example.com', name: 'Jane Doe', phone: '+54911' });

      expect(prisma.guest.findUnique).toHaveBeenCalledWith({ where: { email: 'jane@example.com' } });
      expect(prisma.guest.upsert).toHaveBeenCalledWith({
        where: { email: 'jane@example.com' },
        create: { email: 'jane@example.com', name: 'Jane Doe', phone: '+54911' },
        update: { name: 'Jane Doe', phone: '+54911' },
      });
      expect(prisma.reservation.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { guestId: 'guest-1' },
      });
      expect(prisma.guest.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: { totalStays: 3, lastStayAt: new Date('2026-05-01') },
      });
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });
```

Do the same for `'upserts a Guest by phone when there is no email, keyed on phone'` — add `prisma.guest.findUnique.mockResolvedValue(null);` as its first line and `expect(prisma.guest.findUnique).toHaveBeenCalledWith({ where: { phone: '+591 75278095' } });` after the upsert assertion.

- [ ] **Step 3: Write the new failing tests for change recording**

Add these inside the `describe('syncFromReservation', ...)` block, after the existing tests:

```typescript
    it('records NAME_CHANGED when an existing guest is re-synced with a different name', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane', phone: '+54911', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+54911' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'guest-1',
        'NAME_CHANGED',
        'Nombre: "Jane" → "Jane Doe"',
      );
    });

    it('records PHONE_CHANGED when an existing guest is re-synced with a different phone', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+5491100000000', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+5492200000000' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'guest-1',
        'PHONE_CHANGED',
        'Teléfono: "+5491100000000" → "+5492200000000"',
      );
    });

    it('records PHONE_CHANGED with "(vacío)" for the previous value when the guest had no phone on file', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: null, email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+5492200000000' });

      expect(guestEventsService.record).toHaveBeenCalledWith(
        'guest-1',
        'PHONE_CHANGED',
        'Teléfono: (vacío) → "+5492200000000"',
      );
    });

    it('does not record PHONE_CHANGED when this sync has no phone at all, even if the guest previously had one', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+5491100000000', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('records nothing when nothing actually changed', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+54911', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe', phone: '+54911' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('trims the input name before comparing and storing, so incidental whitespace is not logged as a change', async () => {
      prisma.guest.findUnique.mockResolvedValue({ id: 'guest-1', name: 'Jane Doe', phone: '+54911', email: 'jane@example.com' });
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'jane@example.com', name: '  Jane Doe  ', phone: '+54911' });

      expect(prisma.guest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ name: 'Jane Doe' }) }),
      );
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });

    it('records no event for a brand-new guest, since there is nothing to diff against', async () => {
      prisma.guest.findUnique.mockResolvedValue(null);
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-new' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 1 }, _max: { checkOut: null } });

      await service.syncFromReservation('res-1', { email: 'new@example.com', name: 'New Guest' });

      expect(guestEventsService.record).not.toHaveBeenCalled();
    });
```

- [ ] **Step 4: Run the tests to verify the new ones fail**

Run: `docker compose exec api npx jest guests.service`
Expected: the 7 new tests FAIL (the 2 updated existing tests also fail, since `findUnique` isn't called yet by the current implementation)

- [ ] **Step 5: Implement the change-recording logic**

In `api/src/guests/guests.service.ts`, replace the full file:

```typescript
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CampaignFilterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuestEventsService } from '../guest-events/guest-events.service';

interface SyncInput {
  email?: string | null;
  name: string;
  phone?: string | null;
}

interface GuestSnapshot {
  name: string;
  phone: string | null;
  email: string | null;
}

function formatPreviousValue(value: string | null): string {
  return value === null ? '(vacío)' : `"${value}"`;
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestEventsService: GuestEventsService,
  ) {}

  async syncFromReservation(reservationId: string, input: SyncInput): Promise<void> {
    try {
      const email = input.email?.trim().toLowerCase() || null;
      const phone = input.phone?.trim() || null;
      const name = input.name.trim();
      if (!email && !phone) {
        return;
      }

      // Airbnb's hosting messages page never exposes the guest's email, only their phone —
      // key the upsert on whichever identifier is actually present.
      const existing = email
        ? await this.prisma.guest.findUnique({ where: { email } })
        : await this.prisma.guest.findUnique({ where: { phone: phone as string } });

      const guest = email
        ? await this.prisma.guest.upsert({
            where: { email },
            create: { email, name, phone: phone ?? undefined },
            update: { name, phone: phone ?? undefined },
          })
        : await this.prisma.guest.upsert({
            where: { phone: phone as string },
            create: { phone: phone as string, name },
            update: { name },
          });

      if (existing) {
        await this.recordFieldChanges(guest.id, existing, { name, phone, email });
      }

      await this.prisma.reservation.update({
        where: { id: reservationId },
        data: { guestId: guest.id },
      });

      const stats = await this.prisma.reservation.aggregate({
        where: { guestId: guest.id },
        _count: { _all: true },
        _max: { checkOut: true },
      });

      await this.prisma.guest.update({
        where: { id: guest.id },
        data: { totalStays: stats._count._all, lastStayAt: stats._max.checkOut },
      });
    } catch (error) {
      this.logger.error(`Guest sync failed for reservation ${reservationId}: ${(error as Error).message}`);
    }
  }

  // Only compares/records a field as changed when this sync's input actually supplies a
  // value for it — when phone/email is omitted this time, Prisma's `?? undefined` in the
  // upsert above leaves the stored value untouched, so there is nothing to diff for it.
  // `name` is always present (required on SyncInput), so it's always compared.
  private async recordFieldChanges(
    guestId: string,
    existing: GuestSnapshot,
    next: { name: string; phone: string | null; email: string | null },
  ): Promise<void> {
    if (existing.name !== next.name) {
      await this.guestEventsService.record(
        guestId,
        'NAME_CHANGED',
        `Nombre: "${existing.name}" → "${next.name}"`,
      );
    }
    if (next.phone !== null && existing.phone !== next.phone) {
      await this.guestEventsService.record(
        guestId,
        'PHONE_CHANGED',
        `Teléfono: ${formatPreviousValue(existing.phone)} → "${next.phone}"`,
      );
    }
    if (next.email !== null && existing.email !== next.email) {
      await this.guestEventsService.record(
        guestId,
        'EMAIL_CHANGED',
        `Email: ${formatPreviousValue(existing.email)} → "${next.email}"`,
      );
    }
  }

  findAll() {
    return this.prisma.guest.findMany({ orderBy: { lastStayAt: 'desc' } });
  }

  async findOne(id: string) {
    const guest = await this.prisma.guest.findUnique({
      where: { id },
      include: { reservations: { orderBy: { checkIn: 'desc' } } },
    });
    if (!guest) {
      throw new NotFoundException(`Guest ${id} not found`);
    }
    return guest;
  }

  findEligibleForCampaign(filterType: CampaignFilterType, filterMonths?: number) {
    const where: Prisma.GuestWhereInput = { unsubscribedAt: null, email: { not: null } };

    if (filterType === 'STAYED_WITHIN_MONTHS') {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - (filterMonths as number));
      where.lastStayAt = { gte: cutoff };
    } else if (filterType === 'NOT_STAYED_WITHIN_MONTHS') {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - (filterMonths as number));
      where.OR = [{ lastStayAt: { lt: cutoff } }, { lastStayAt: null }];
    }

    return this.prisma.guest.findMany({ where });
  }

  async unsubscribeByToken(token: string): Promise<void> {
    // A findFirst-then-update (rather than the previous anonymous updateMany) is what gives
    // us a guest id to attach the GuestEvent to — the "never leak whether a token is valid"
    // behavior is unchanged: an unknown token still silently no-ops with no error either way.
    const guest = await this.prisma.guest.findFirst({ where: { unsubscribeToken: token } });
    if (!guest) {
      return;
    }
    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { unsubscribedAt: new Date() },
    });
    await this.guestEventsService.record(guest.id, 'UNSUBSCRIBED');
  }
}
```

- [ ] **Step 6: Run the tests to verify they all pass**

Run: `docker compose exec api npx jest guests.service`
Expected: PASS — note `unsubscribeByToken`'s existing 2 tests will still fail here; that's expected, they're fixed in Task 4. Confirm specifically that every `syncFromReservation` test passes: `docker compose exec api npx jest guests.service -t syncFromReservation`

- [ ] **Step 7: Commit**

```bash
git add api/src/guests/guests.service.ts api/src/guests/guests.service.spec.ts
git commit -m "Record GuestEvents for name/phone changes in syncFromReservation"
```

---

### Task 4: Backend — `GuestsService.unsubscribeByToken()` records `UNSUBSCRIBED`

**Files:**
- Modify: `api/src/guests/guests.service.spec.ts`

(The implementation itself was already written in Task 3, Step 5 — this task only updates the two tests that referenced the old `updateMany`-based behavior, since Task 3 already replaced the method body.)

**Interfaces:**
- Consumes: `GuestsService.unsubscribeByToken(token: string)` (already implemented in Task 3).

- [ ] **Step 1: Replace the two outdated `unsubscribeByToken` tests**

In `api/src/guests/guests.service.spec.ts`, replace the entire `describe('unsubscribeByToken', ...)` block:

```typescript
  describe('unsubscribeByToken', () => {
    it('sets unsubscribedAt and records an UNSUBSCRIBED event for the matching token', async () => {
      prisma.guest.findFirst.mockResolvedValue({ id: 'guest-1' });

      await service.unsubscribeByToken('tok-1');

      expect(prisma.guest.findFirst).toHaveBeenCalledWith({ where: { unsubscribeToken: 'tok-1' } });
      expect(prisma.guest.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: { unsubscribedAt: expect.any(Date) },
      });
      expect(guestEventsService.record).toHaveBeenCalledWith('guest-1', 'UNSUBSCRIBED');
    });

    it('does nothing for an unknown token, without erroring', async () => {
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(service.unsubscribeByToken('unknown')).resolves.toBeUndefined();

      expect(prisma.guest.update).not.toHaveBeenCalled();
      expect(guestEventsService.record).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `docker compose exec api npx jest guests.service`
Expected: PASS, every test in the file (this is the full `guests.service.spec.ts` suite, including Task 3's tests)

- [ ] **Step 3: Commit**

```bash
git add api/src/guests/guests.service.spec.ts
git commit -m "Update unsubscribeByToken tests for the findFirst-based rewrite"
```

---

### Task 5: Backend — `GET /guests/:id/events` route

**Files:**
- Modify: `api/src/guests/guests.controller.ts`
- Modify: `api/src/guests/guests.module.ts`

**Interfaces:**
- Consumes: `GuestEventsService.listForGuest(guestId)` from Task 2.
- Produces: `GET /guests/:id/events` — Task 7's admin-web API client calls this exact route.

- [ ] **Step 1: Add the route to the controller**

Replace `api/src/guests/guests.controller.ts`:

```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuestsService } from './guests.service';
import { GuestEventsService } from '../guest-events/guest-events.service';

@UseGuards(JwtAuthGuard)
@Controller('guests')
export class GuestsController {
  constructor(
    private readonly guestsService: GuestsService,
    private readonly guestEventsService: GuestEventsService,
  ) {}

  @Get()
  findAll() {
    return this.guestsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.guestsService.findOne(id);
  }

  @Get(':id/events')
  listEvents(@Param('id') id: string) {
    return this.guestEventsService.listForGuest(id);
  }
}
```

- [ ] **Step 2: `GuestsModule` needs no change for DI**

`GuestEventsModule` is `@Global()` (Task 2), so `GuestEventsService` is already injectable anywhere without `GuestsModule` needing to list it in `imports`. Confirm `api/src/guests/guests.module.ts` is unchanged — no edit needed here.

- [ ] **Step 3: Verify the app compiles**

Run: `docker compose exec api npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add api/src/guests/guests.controller.ts
git commit -m "Add GET /guests/:id/events route"
```

---

### Task 6: Backend e2e tests

**Files:**
- Modify: `api/test/guests.e2e-spec.ts`
- Modify: `api/test/public-guests.e2e-spec.ts`

**Interfaces:**
- Consumes: `GET /guests/:id/events`, `POST /public/reservations/:token/confirm-dates`, `GET /public/guests/:token/unsubscribe` — all already implemented by Tasks 3-5.

- [ ] **Step 1: Add a name-change test to `guests.e2e-spec.ts`**

In `api/test/guests.e2e-spec.ts`, add this test inside the `describe('GuestsController (e2e)', ...)` block, after the existing `'lists guests'` test:

```typescript
  it('records a GuestEvent when an existing guest is re-synced with a different name', async () => {
    const reservationA = await prisma.reservation.create({
      data: {
        guestName: 'Placeholder',
        checkIn: new Date('2026-03-01'),
        checkOut: new Date('2026-03-05'),
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 50000,
        currency: 'ARS',
      },
    });
    const reservationB = await prisma.reservation.create({
      data: {
        guestName: 'Placeholder',
        checkIn: new Date('2026-04-01'),
        checkOut: new Date('2026-04-05'),
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 50000,
        currency: 'ARS',
      },
    });

    await request(app.getHttpServer())
      .post(`/public/reservations/${reservationA.confirmationToken}/confirm-dates`)
      .send({ fullName: 'Jane', phone: '+5491100000001', email: 'e2e-guest-history@example.com' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/public/reservations/${reservationB.confirmationToken}/confirm-dates`)
      .send({ fullName: 'Jane Doe', phone: '+5491100000001', email: 'e2e-guest-history@example.com' })
      .expect(201);

    const guest = await prisma.guest.findUnique({ where: { email: 'e2e-guest-history@example.com' } });
    const response = await request(app.getHttpServer())
      .get(`/guests/${guest!.id}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.some((e: { type: string; detail: string }) =>
      e.type === 'NAME_CHANGED' && e.detail === 'Nombre: "Jane" → "Jane Doe"',
    )).toBe(true);

    await prisma.reservationEvent.deleteMany({ where: { reservationId: { in: [reservationA.id, reservationB.id] } } });
    await prisma.reservation.deleteMany({ where: { id: { in: [reservationA.id, reservationB.id] } } });
    await prisma.guestEvent.deleteMany({ where: { guestId: guest!.id } });
    await prisma.guest.delete({ where: { id: guest!.id } });
  });
```

- [ ] **Step 2: Run it**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json guests.e2e-spec`
Expected: PASS

- [ ] **Step 3: Add an UNSUBSCRIBED event test to `public-guests.e2e-spec.ts`**

In `api/test/public-guests.e2e-spec.ts`, add this test after the existing `'unsubscribes a guest by their token...'` test, and add `GuestsController`-style auth to fetch the event (need the same login setup already used elsewhere — since this file currently has no `accessToken`, add the login boilerplate to `beforeAll`, matching the pattern from `guests.e2e-spec.ts`):

First, update the top of the file to add auth setup (mirroring `guests.e2e-spec.ts`'s `beforeAll`):

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('PublicGuestsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-public-guests@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    await prisma.guest.deleteMany({ where: { email: { in: ['e2e-unsubscribe@example.com', 'e2e-unsubscribe-2@example.com'] } } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-public-guests@labrisa.com.ar' } });
    await app.close();
  });
```

Then add the new test right after the existing `'unsubscribes a guest by their token, with no authentication required'` test:

```typescript
  it('records an UNSUBSCRIBED GuestEvent when unsubscribing succeeds', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'e2e-unsubscribe-event@example.com', name: 'E2E Unsubscribe Event Guest' },
    });

    await request(app.getHttpServer())
      .get(`/public/guests/${guest.unsubscribeToken}/unsubscribe`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/guests/${guest.id}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.some((e: { type: string }) => e.type === 'UNSUBSCRIBED')).toBe(true);

    await prisma.guestEvent.deleteMany({ where: { guestId: guest.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });
```

Also add `'e2e-unsubscribe-event@example.com'` to the `afterAll` cleanup's email list:

```typescript
    await prisma.guest.deleteMany({ where: { email: { in: ['e2e-unsubscribe@example.com', 'e2e-unsubscribe-2@example.com', 'e2e-unsubscribe-event@example.com'] } } });
```

- [ ] **Step 4: Run the full e2e suite**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json`
Expected: PASS for `guests.e2e-spec.ts` and `public-guests.e2e-spec.ts`. (The pre-existing unrelated `app.e2e-spec.ts` failure about a `version` field is not caused by this work — ignore it.)

- [ ] **Step 5: Commit**

```bash
git add api/test/guests.e2e-spec.ts api/test/public-guests.e2e-spec.ts
git commit -m "Add e2e coverage for guest change-history events"
```

---

### Task 7: admin-web — API clients and label function

**Files:**
- Create: `admin-web/src/api/guest-events.ts`
- Modify: `admin-web/src/api/guests.ts`
- Modify: `admin-web/src/lib/labels.ts`
- Modify: `admin-web/src/lib/labels.test.ts`

**Interfaces:**
- Consumes: `GET /guest-events`, `GET /guests/:id/events` from Tasks 2 and 5.
- Produces: `listGuestActivityLog(): Promise<GuestEventEntry[]>`, `listGuestEvents(id: string): Promise<GuestEvent[]>`, `guestEventTypeLabel(type: string): string` — Tasks 8 and 9 import these exact names.

- [ ] **Step 1: Create the flat activity-log API client**

Create `admin-web/src/api/guest-events.ts`:

```typescript
import { apiClient } from './client';

export interface GuestEventEntry {
  id: string;
  guestId: string;
  type: string;
  detail: string | null;
  createdAt: string;
  guest: {
    name: string;
    email: string | null;
  };
}

export function listGuestActivityLog(): Promise<GuestEventEntry[]> {
  return apiClient.request('/guest-events');
}
```

- [ ] **Step 2: Add the per-guest API client function**

In `admin-web/src/api/guests.ts`, add a `GuestEvent` interface and `listGuestEvents` function:

```typescript
import { apiClient } from './client';
import { Reservation } from '../reservations/types';

export interface Guest {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  totalStays: number;
  lastStayAt: string | null;
  unsubscribedAt: string | null;
}

export interface GuestWithReservations extends Guest {
  reservations: Reservation[];
}

export interface GuestEvent {
  id: string;
  guestId: string;
  type: string;
  detail: string | null;
  createdAt: string;
}

export function listGuests(): Promise<Guest[]> {
  return apiClient.request('/guests');
}

export function getGuest(id: string): Promise<GuestWithReservations> {
  return apiClient.request(`/guests/${id}`);
}

export function listGuestEvents(id: string): Promise<GuestEvent[]> {
  return apiClient.request(`/guests/${id}/events`);
}
```

- [ ] **Step 3: Write the failing label test**

In `admin-web/src/lib/labels.test.ts`, find the existing tests for `notificationTypeLabel` (or `eventTypeLabel`) and add, in the same style:

```typescript
describe('guestEventTypeLabel', () => {
  it('returns the Spanish label for a known type', () => {
    expect(guestEventTypeLabel('NAME_CHANGED')).toBe('Nombre modificado');
    expect(guestEventTypeLabel('PHONE_CHANGED')).toBe('Teléfono modificado');
    expect(guestEventTypeLabel('EMAIL_CHANGED')).toBe('Email modificado');
    expect(guestEventTypeLabel('UNSUBSCRIBED')).toBe('Se dio de baja');
  });

  it('falls back to the raw type for an unknown value', () => {
    expect(guestEventTypeLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });
});
```

Add `guestEventTypeLabel` to the existing import line at the top of the file (find the `import { ... } from './labels';` line and add it to the destructured list).

- [ ] **Step 4: Run the test to verify it fails**

Run: `docker compose exec admin-web npx vitest run src/lib/labels.test.ts`
Expected: FAIL — `guestEventTypeLabel is not defined` / TypeScript error

- [ ] **Step 5: Implement the label function**

In `admin-web/src/lib/labels.ts`, add after `notificationTypeLabel`:

```typescript
const GUEST_EVENT_TYPE_LABELS: Record<string, string> = {
  NAME_CHANGED: 'Nombre modificado',
  PHONE_CHANGED: 'Teléfono modificado',
  EMAIL_CHANGED: 'Email modificado',
  UNSUBSCRIBED: 'Se dio de baja',
};

export function guestEventTypeLabel(type: string): string {
  return GUEST_EVENT_TYPE_LABELS[type] ?? type;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose exec admin-web npx vitest run src/lib/labels.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck**

Run: `docker compose exec admin-web npx tsc -b`
Expected: no output

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/api/guest-events.ts admin-web/src/api/guests.ts admin-web/src/lib/labels.ts admin-web/src/lib/labels.test.ts
git commit -m "Add guest-events API clients and guestEventTypeLabel"
```

---

### Task 8: admin-web — "Historial de cambios" on `GuestDetailPage`

**Files:**
- Modify: `admin-web/src/guests/GuestDetailPage.tsx`
- Modify: `admin-web/src/guests/GuestDetailPage.test.tsx`

**Interfaces:**
- Consumes: `listGuestEvents(id)` from Task 7.

- [ ] **Step 1: Write the failing tests**

In `admin-web/src/guests/GuestDetailPage.test.tsx`, add these two tests after the existing `'lists the guest reservations with a link to each one'` test:

```typescript
  it("shows the guest's change history", async () => {
    vi.spyOn(guestsApi, 'getGuest').mockResolvedValue({
      id: 'guest-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: '+54911',
      totalStays: 1,
      lastStayAt: null,
      unsubscribedAt: null,
      reservations: [],
    });
    vi.spyOn(guestsApi, 'listGuestEvents').mockResolvedValue([
      {
        id: 'evt-1',
        guestId: 'guest-1',
        type: 'NAME_CHANGED',
        detail: 'Nombre: "Jane" → "Jane Doe"',
        createdAt: '2026-09-20T12:00:00.000Z',
      },
    ]);

    renderAt('guest-1');

    expect(await screen.findByText('Nombre modificado')).toBeInTheDocument();
    expect(screen.getByText('Nombre: "Jane" → "Jane Doe"')).toBeInTheDocument();
  });

  it('shows an empty state when the guest has no change history', async () => {
    vi.spyOn(guestsApi, 'getGuest').mockResolvedValue({
      id: 'guest-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: '+54911',
      totalStays: 1,
      lastStayAt: null,
      unsubscribedAt: null,
      reservations: [],
    });
    vi.spyOn(guestsApi, 'listGuestEvents').mockResolvedValue([]);

    renderAt('guest-1');

    expect(await screen.findByText('Sin cambios registrados.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec admin-web npx vitest run src/guests/GuestDetailPage.test.tsx`
Expected: FAIL — `listGuestEvents` is not a spy-able export yet used by the component / text not found

- [ ] **Step 3: Implement the section**

Replace `admin-web/src/guests/GuestDetailPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getGuest, listGuestEvents, GuestEvent, GuestWithReservations } from '../api/guests';
import {
  PageContainer,
  PageHeader,
  Alert,
  Badge,
  Card,
  EmptyState,
  LoadingState,
  Table,
  tableThClass as thClass,
  tableTdClass as tdClass,
} from '../ui';
import { formatDate, formatDateTime } from '../lib/date';
import { shortId } from '../lib/id';
import { sourceLabel, statusLabel, statusBadgeTone, guestEventTypeLabel } from '../lib/labels';

export function GuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [guest, setGuest] = useState<GuestWithReservations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<GuestEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getGuest(id)
      .then(setGuest)
      .catch(() => setError('No se pudo cargar el huésped.'));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    listGuestEvents(id)
      .then(setEvents)
      .catch(() => {
        // Secondary section — a failed history fetch shouldn't block the rest of the page.
      })
      .finally(() => setEventsLoading(false));
  }, [id]);

  if (error) {
    return (
      <PageContainer>
        <Alert>{error}</Alert>
      </PageContainer>
    );
  }

  if (!guest) {
    return (
      <PageContainer>
        <p className="text-text-muted">Cargando...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={guest.name}
        subtitle={`ID de cliente: ${shortId(guest.id)}`}
        backTo="/guests"
        backLabel="Volver a huéspedes"
      />

      <Card className="mb-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Email</dt>
            <dd className="text-text">{guest.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Teléfono</dt>
            <dd className="text-text">{guest.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Estadías totales</dt>
            <dd className="text-text">{guest.totalStays}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Última estadía</dt>
            <dd className="text-text">{guest.lastStayAt ? formatDate(guest.lastStayAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-text-muted">Estado de suscripción</dt>
            <dd>
              <Badge tone={guest.unsubscribedAt ? 'warning' : 'success'}>
                {guest.unsubscribedAt ? `Dado de baja el ${formatDateTime(guest.unsubscribedAt)}` : 'Suscripto'}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Reservas</h2>
        {guest.reservations.length === 0 ? (
          <p className="text-text-muted">Este huésped todavía no tiene reservas.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>ID</th>
                <th className={thClass}>Check-in</th>
                <th className={thClass}>Check-out</th>
                <th className={thClass}>Canal</th>
                <th className={thClass}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {guest.reservations.map((r) => (
                <tr key={r.id}>
                  <td className={tdClass}>
                    <Link
                      to={`/reservations/${r.id}`}
                      title={r.id}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {shortId(r.id)}
                    </Link>
                  </td>
                  <td className={tdClass}>{formatDate(r.checkIn)}</td>
                  <td className={tdClass}>{formatDate(r.checkOut)}</td>
                  <td className={tdClass}>{sourceLabel(r.source)}</td>
                  <td className={tdClass}>
                    <Badge tone={statusBadgeTone(r.status)}>{statusLabel(r.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-heading text-lg font-semibold text-heading">Historial de cambios</h2>
        {eventsLoading ? (
          <LoadingState />
        ) : events.length === 0 ? (
          <EmptyState message="Sin cambios registrados." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Cambio</th>
                <th className={thClass}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className={tdClass}>{formatDateTime(event.createdAt)}</td>
                  <td className={tdClass}>{guestEventTypeLabel(event.type)}</td>
                  <td className={tdClass}>{event.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
```

(This also gives the existing "Reservas" `Card` a `mb-6` it didn't have before, matching the spacing already used between the top info card and it — a one-line, in-scope tidy since a third card is being added below it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec admin-web npx vitest run src/guests/GuestDetailPage.test.tsx`
Expected: PASS, all 6 tests (4 existing + 2 new)

- [ ] **Step 5: Typecheck**

Run: `docker compose exec admin-web npx tsc -b`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/guests/GuestDetailPage.tsx admin-web/src/guests/GuestDetailPage.test.tsx
git commit -m "Show guest change history on GuestDetailPage"
```

---

### Task 9: admin-web — new `GuestEventsTab` component

**Files:**
- Create: `admin-web/src/activity/GuestEventsTab.tsx`
- Create: `admin-web/src/activity/GuestEventsTab.test.tsx`

**Interfaces:**
- Consumes: `listGuestActivityLog()` from Task 7.
- Produces: `GuestEventsTab` React component — Task 10 imports and renders it.

- [ ] **Step 1: Write the failing tests**

Create `admin-web/src/activity/GuestEventsTab.test.tsx`, mirroring `ExtensionErrorsTab.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuestEventsTab } from './GuestEventsTab';
import * as guestEventsApi from '../api/guest-events';

describe('GuestEventsTab', () => {
  it('loads and displays guest change events with a readable type label', async () => {
    vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        guestId: 'guest-1',
        type: 'NAME_CHANGED',
        detail: 'Nombre: "Jane" → "Jane Doe"',
        createdAt: '2026-09-20T12:00:00.000Z',
        guest: { name: 'Jane Doe', email: 'jane@example.com' },
      },
    ]);

    render(<GuestEventsTab />);

    expect(await screen.findByText('Nombre modificado')).toBeInTheDocument();
    expect(screen.getByText('Nombre: "Jane" → "Jane Doe"')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows an empty state when there are no guest change events', async () => {
    vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockResolvedValue([]);

    render(<GuestEventsTab />);

    expect(await screen.findByText(/todavía no hay cambios de huéspedes registrados/i)).toBeInTheDocument();
  });

  it('shows an alert when the log cannot be loaded', async () => {
    vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockRejectedValue(new Error('network error'));

    render(<GuestEventsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar los cambios de huéspedes/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec admin-web npx vitest run src/activity/GuestEventsTab.test.tsx`
Expected: FAIL — `Cannot find module './GuestEventsTab'`

- [ ] **Step 3: Implement the component**

Create `admin-web/src/activity/GuestEventsTab.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { listGuestActivityLog, GuestEventEntry } from '../api/guest-events';
import { Alert, EmptyState, LoadingState, Table, tableThClass as thClass, tableTdClass as tdClass } from '../ui';
import { formatDateTime } from '../lib/date';
import { guestEventTypeLabel } from '../lib/labels';

export function GuestEventsTab() {
  const [entries, setEntries] = useState<GuestEventEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listGuestActivityLog()
      .then(setEntries)
      .catch(() => setError('No se pudieron cargar los cambios de huéspedes. Por favor, recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <>
      {error && <Alert>{error}</Alert>}
      {!error && entries.length === 0 ? (
        <EmptyState message="Todavía no hay cambios de huéspedes registrados." />
      ) : (
        !error && (
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Cuándo</th>
                <th className={thClass}>Huésped</th>
                <th className={thClass}>Cambio</th>
                <th className={thClass}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={tdClass}>{formatDateTime(entry.createdAt)}</td>
                  <td className={tdClass}>{entry.guest.name}</td>
                  <td className={tdClass}>{guestEventTypeLabel(entry.type)}</td>
                  <td className={tdClass}>{entry.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec admin-web npx vitest run src/activity/GuestEventsTab.test.tsx`
Expected: PASS, 3 tests

- [ ] **Step 5: Typecheck**

Run: `docker compose exec admin-web npx tsc -b`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/activity/GuestEventsTab.tsx admin-web/src/activity/GuestEventsTab.test.tsx
git commit -m "Add GuestEventsTab component"
```

---

### Task 10: admin-web — wire the new tab into `ActivityLogPage`

**Files:**
- Modify: `admin-web/src/activity/ActivityLogPage.tsx`
- Modify: `admin-web/src/activity/ActivityLogPage.test.tsx`

**Interfaces:**
- Consumes: `GuestEventsTab` from Task 9.

- [ ] **Step 1: Write the failing test**

In `admin-web/src/activity/ActivityLogPage.test.tsx`, add the import and a new test mirroring the existing `'switches to the extension errors tab and loads it lazily'` test:

```typescript
import * as guestEventsApi from '../api/guest-events';
```

```typescript
  it('switches to the guest changes tab and loads it lazily', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([]);
    const listGuestActivityLog = vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        guestId: 'guest-1',
        type: 'NAME_CHANGED',
        detail: 'Nombre: "Jane" → "Jane Doe"',
        createdAt: '2026-09-20T12:00:00.000Z',
        guest: { name: 'Jane Doe', email: 'jane@example.com' },
      },
    ]);

    renderPage();
    await screen.findByText('Todavía no hay eventos registrados.');
    expect(listGuestActivityLog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Cambios de huéspedes' }));

    expect(await screen.findByText('Nombre modificado')).toBeInTheDocument();
    expect(listGuestActivityLog).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec admin-web npx vitest run src/activity/ActivityLogPage.test.tsx`
Expected: FAIL — no tab named "Cambios de huéspedes" found

- [ ] **Step 3: Wire in the tab**

In `admin-web/src/activity/ActivityLogPage.tsx`:

Add the import:

```typescript
import { GuestEventsTab } from './GuestEventsTab';
```

Add to the `TABS` array:

```typescript
const TABS = [
  { id: 'events', label: 'Eventos de reservas' },
  { id: 'guest-events', label: 'Cambios de huéspedes' },
  { id: 'extension-errors', label: 'Errores del plugin' },
];
```

Update the render branch:

```typescript
      {activeTab === 'extension-errors' ? (
        <Card>
          <ExtensionErrorsTab />
        </Card>
      ) : activeTab === 'guest-events' ? (
        <Card>
          <GuestEventsTab />
        </Card>
      ) : (
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec admin-web npx vitest run src/activity/ActivityLogPage.test.tsx`
Expected: PASS, all 7 tests (6 existing + 1 new)

- [ ] **Step 5: Run the full admin-web suite, typecheck, and lint**

Run: `docker compose exec admin-web npx vitest run`
Expected: PASS, every test file

Run: `docker compose exec admin-web npx tsc -b`
Expected: no output

Run: `docker compose exec admin-web npx oxlint`
Expected: 0 errors (pre-existing warnings unrelated to this change are fine)

- [ ] **Step 6: Run the full backend suite one more time**

Run: `docker compose exec api npx jest`
Expected: PASS, every test file

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json`
Expected: PASS except the pre-existing, unrelated `app.e2e-spec.ts` `version`-field failures

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/activity/ActivityLogPage.tsx admin-web/src/activity/ActivityLogPage.test.tsx
git commit -m "Add guest changes tab to ActivityLogPage"
```
