# Marketing / CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the business a deduplicated guest history (one `Guest` record per person, linked to every one of their reservations via a real foreign key) and the ability to send templated marketing emails to filtered segments of past guests, with a one-click unsubscribe and a per-send history.

**Architecture:** Extends the existing `api`/`admin-web` stack from sub-projects 1-4. `api` gains four new modules: `guests` (sync-from-reservation + admin list + public unsubscribe), `campaign-templates` (CRUD), and `campaigns` (recipient-filter resolution, preview, send, history). `ReservationsService` and `PublicReservationsService` each gain one non-blocking call into `GuestsService.syncFromReservation`. `admin-web` gains three new pages: Guests (read-only list), Templates (CRUD), and Campaigns (compose/preview/send + history).

**Tech Stack:** Same as prior sub-projects (NestJS, Prisma, PostgreSQL, React+Vite, Jest/Supertest, Vitest/RTL). No new external dependencies — campaign emails reuse the existing `resend` client via a new `EmailService` method.

**Spec:** `docs/superpowers/specs/2026-09-13-marketing-crm-design.md`

## Global Constraints

- `Reservation.guestId` is the durable link for guest identity — every later "this guest's history" or "who's in this campaign" query walks that relation, never an ad-hoc email-string match.
- Guest sync (`GuestsService.syncFromReservation`) must never throw and must never block or fail the reservation-save / contract-acceptance request that triggered it — same non-blocking-side-effect contract as `GoogleCalendarPushService.pushReservation` from sub-project 4.
- Unsubscribed guests (`unsubscribedAt` not null) are excluded from every campaign's recipient query, unconditionally, regardless of the chosen filter.
- The public unsubscribe endpoint is idempotent and never errors on an unknown or already-used token — it must not leak which tokens are valid.
- A single recipient's send failure never aborts a campaign's send loop; the `Campaign`/`CampaignRecipient` records always reflect exactly what was attempted, whether it succeeded or failed.
- A `CampaignTemplate` referenced by any `Campaign` cannot be deleted — attempting to do so returns a clear error, not a raw database constraint failure.

---

### Task 1: Prisma schema — Guest, CampaignTemplate, Campaign, CampaignRecipient, Reservation.guestId

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/...` (via `prisma migrate dev`)
- Create: `api/test/marketing-crm-schema.e2e-spec.ts`

**Interfaces:**
- Produces: `Guest`, `CampaignTemplate`, `Campaign`, `CampaignRecipient` models, `Reservation.guestId` — consumed by every later task in this plan.

- [ ] **Step 1: Add the new models and enums to `api/prisma/schema.prisma`**

Add these two new enums (anywhere alongside the existing enums):
```prisma
enum CampaignFilterType {
  ALL
  STAYED_WITHIN_MONTHS
  NOT_STAYED_WITHIN_MONTHS
}

enum CampaignRecipientStatus {
  SENT
  FAILED
}
```

Add these four new models:
```prisma
model Guest {
  id                 String              @id @default(uuid())
  email              String              @unique
  name               String
  phone              String?
  totalStays         Int                 @default(0)
  lastStayAt         DateTime?
  unsubscribedAt     DateTime?
  unsubscribeToken   String              @unique @default(uuid())
  reservations       Reservation[]
  campaignRecipients CampaignRecipient[]
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
}

model CampaignTemplate {
  id        String     @id @default(uuid())
  name      String
  subject   String
  bodyHtml  String
  campaigns Campaign[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
}

model Campaign {
  id             String                 @id @default(uuid())
  templateId     String
  template       CampaignTemplate       @relation(fields: [templateId], references: [id], onDelete: Restrict)
  filterType     CampaignFilterType
  filterMonths   Int?
  recipientCount Int
  recipients     CampaignRecipient[]
  sentAt         DateTime               @default(now())
}

model CampaignRecipient {
  id         String                  @id @default(uuid())
  campaignId String
  campaign   Campaign                @relation(fields: [campaignId], references: [id])
  guestId    String
  guest      Guest                   @relation(fields: [guestId], references: [id])
  status     CampaignRecipientStatus
  error      String?
  createdAt  DateTime                @default(now())
}
```

Modify the existing `Reservation` model — add this one field and its relation (keep every existing field from sub-projects 1-4 unchanged, including the `@@unique([source, externalReference])` constraint):
```prisma
model Reservation {
  // ...all existing fields stay exactly as they are...

  guestId String?
  guest   Guest?  @relation(fields: [guestId], references: [id])
}
```

- [ ] **Step 2: Generate and run the migration**

Run:
```bash
docker compose exec api npx prisma migrate dev --name marketing_crm
```
Expected: a new folder under `api/prisma/migrations/`, migration applied successfully.

- [ ] **Step 3: Write a schema smoke test**

`api/test/marketing-crm-schema.e2e-spec.ts`:
```typescript
import { PrismaClient } from '@prisma/client';

describe('Marketing/CRM schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a Guest, links a Reservation to it, and reads the link back', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'schema-test-guest@example.com', name: 'Schema Test Guest' },
    });

    expect(guest.unsubscribeToken).toBeTruthy();
    expect(guest.totalStays).toBe(0);

    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        guestId: guest.id,
      },
    });

    const found = await prisma.guest.findUnique({
      where: { id: guest.id },
      include: { reservations: true },
    });

    expect(found?.reservations.map((r) => r.id)).toEqual([reservation.id]);

    await prisma.reservation.delete({ where: { id: reservation.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });

  it('creates a CampaignTemplate, a Campaign, and a CampaignRecipient, and links them', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'schema-test-recipient@example.com', name: 'Schema Test Recipient' },
    });
    const template = await prisma.campaignTemplate.create({
      data: { name: 'Schema Test Template', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' },
    });

    const campaign = await prisma.campaign.create({
      data: {
        templateId: template.id,
        filterType: 'ALL',
        recipientCount: 1,
        recipients: {
          create: [{ guestId: guest.id, status: 'SENT' }],
        },
      },
      include: { recipients: true },
    });

    expect(campaign.recipients).toHaveLength(1);
    expect(campaign.recipients[0].status).toBe('SENT');

    // A template referenced by a campaign must not be deletable at the database level either
    // (defense-in-depth alongside the service-layer check added in a later task).
    await expect(prisma.campaignTemplate.delete({ where: { id: template.id } })).rejects.toThrow();

    await prisma.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.campaignTemplate.delete({ where: { id: template.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });
});
```

- [ ] **Step 4: Run it**

Run:
```bash
docker compose exec api npm run test:e2e
```
Expected: all suites PASS, including the new one, with no regressions.

- [ ] **Step 5: Add the API's own public origin env var**

Add to `.env.example`, in the `# API` section alongside `ADMIN_WEB_ORIGIN`/`GUEST_WEB_ORIGIN`:
```
API_ORIGIN=http://localhost:3001
```
This is the API's own externally-reachable base URL, needed later in this plan to build the unsubscribe link embedded in marketing emails (the API serves that link directly — no guest-web page is involved). Add the same line to the repo-root `.env` if it exists in this environment (check with `test -f .env` first; `.env` is git-ignored so this only matters for local runtime).

- [ ] **Step 6: Commit**

```bash
git add api/prisma api/test/marketing-crm-schema.e2e-spec.ts .env.example
git commit -m "Add Guest, CampaignTemplate, Campaign, CampaignRecipient models and Reservation.guestId"
```

---

### Task 2: GuestsService — sync-from-reservation, list, unsubscribe

**Files:**
- Create: `api/src/guests/guests.service.ts`, `guests.service.spec.ts`, `guests.module.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `GuestsService.syncFromReservation(reservationId: string, input: {email: string; name: string; phone?: string | null}): Promise<void>`, `findAll(): Promise<Guest[]>`, `findEligibleForCampaign(filterType: CampaignFilterType, filterMonths?: number): Promise<Guest[]>`, `unsubscribeByToken(token: string): Promise<void>` — consumed by Task 3 (reservation hooks), Task 4 (admin controller), Task 5 (public controller), Task 7 (campaigns service).

- [ ] **Step 1: Write the failing tests**

`api/src/guests/guests.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { GuestsService } from './guests.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GuestsService', () => {
  let service: GuestsService;
  let prisma: {
    guest: { upsert: jest.Mock; update: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
    reservation: { update: jest.Mock; aggregate: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      guest: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      reservation: { update: jest.fn(), aggregate: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [GuestsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(GuestsService);
  });

  describe('syncFromReservation', () => {
    it('upserts a Guest by lowercased email, links the reservation, and recomputes stats', async () => {
      prisma.guest.upsert.mockResolvedValue({ id: 'guest-1', email: 'jane@example.com' });
      prisma.reservation.aggregate.mockResolvedValue({ _count: { _all: 3 }, _max: { checkOut: new Date('2026-05-01') } });

      await service.syncFromReservation('res-1', { email: 'Jane@Example.com', name: 'Jane Doe', phone: '+54911' });

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
    });

    it('does nothing when the email is empty', async () => {
      await service.syncFromReservation('res-1', { email: '', name: 'Jane Doe' });

      expect(prisma.guest.upsert).not.toHaveBeenCalled();
    });

    it('does nothing when the email is whitespace only', async () => {
      await service.syncFromReservation('res-1', { email: '   ', name: 'Jane Doe' });

      expect(prisma.guest.upsert).not.toHaveBeenCalled();
    });

    it('never throws when a database call fails', async () => {
      prisma.guest.upsert.mockRejectedValue(new Error('db down'));

      await expect(
        service.syncFromReservation('res-1', { email: 'jane@example.com', name: 'Jane Doe' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findEligibleForCampaign', () => {
    it('excludes unsubscribed guests for the ALL filter', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('ALL');

      expect(prisma.guest.findMany).toHaveBeenCalledWith({ where: { unsubscribedAt: null } });
    });

    it('filters to guests who stayed within N months', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: { unsubscribedAt: null, lastStayAt: { gte: expect.any(Date) } },
      });
    });

    it('filters to guests who have not stayed within N months', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.findEligibleForCampaign('NOT_STAYED_WITHIN_MONTHS', 6);

      expect(prisma.guest.findMany).toHaveBeenCalledWith({
        where: {
          unsubscribedAt: null,
          OR: [{ lastStayAt: { lt: expect.any(Date) } }, { lastStayAt: null }],
        },
      });
    });
  });

  describe('unsubscribeByToken', () => {
    it('sets unsubscribedAt for the matching token', async () => {
      await service.unsubscribeByToken('tok-1');

      expect(prisma.guest.updateMany).toHaveBeenCalledWith({
        where: { unsubscribeToken: 'tok-1' },
        data: { unsubscribedAt: expect.any(Date) },
      });
    });

    it('does not throw for an unknown token', async () => {
      prisma.guest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unsubscribeByToken('unknown')).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- guests.service.spec.ts`
Expected: FAIL (`Cannot find module './guests.service'`)

- [ ] **Step 3: Implement `GuestsService` and its module**

`api/src/guests/guests.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { CampaignFilterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface SyncInput {
  email: string;
  name: string;
  phone?: string | null;
}

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncFromReservation(reservationId: string, input: SyncInput): Promise<void> {
    try {
      const email = input.email.trim().toLowerCase();
      if (!email) {
        return;
      }

      const guest = await this.prisma.guest.upsert({
        where: { email },
        create: { email, name: input.name, phone: input.phone ?? undefined },
        update: { name: input.name, phone: input.phone ?? undefined },
      });

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

  findAll() {
    return this.prisma.guest.findMany({ orderBy: { lastStayAt: 'desc' } });
  }

  findEligibleForCampaign(filterType: CampaignFilterType, filterMonths?: number) {
    const where: Prisma.GuestWhereInput = { unsubscribedAt: null };

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
    // updateMany silently matches zero rows for an unknown token — intentional: the public
    // endpoint must never leak whether a given token is valid.
    await this.prisma.guest.updateMany({
      where: { unsubscribeToken: token },
      data: { unsubscribedAt: new Date() },
    });
  }
}
```

`api/src/guests/guests.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { GuestsService } from './guests.service';

@Module({
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- guests.service.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/guests
git commit -m "Add GuestsService for guest sync, campaign filtering, and unsubscribe"
```

---

### Task 3: Hook guest sync into ReservationsService and PublicReservationsService

**Files:**
- Modify: `api/src/reservations/reservations.service.ts`, `reservations.service.spec.ts`, `reservations.module.ts`
- Modify: `api/src/public-reservations/public-reservations.service.ts`, `public-reservations.service.spec.ts`, `public-reservations.module.ts`

**Interfaces:**
- Consumes: `GuestsService.syncFromReservation()` (Task 2).
- Produces: nothing new consumed by later tasks — `create`/`update`/`acceptContract` now sync guests automatically.

- [ ] **Step 1: Update `reservations.service.spec.ts`'s provider wiring**

`ReservationsService`'s constructor gains a new dependency. In `api/src/reservations/reservations.service.spec.ts`, add the import:
```typescript
import { GuestsService } from '../guests/guests.service';
```
Add to the `let` declarations block:
```typescript
let guestsService: { syncFromReservation: jest.Mock };
```
In `beforeEach`, alongside the other mock objects:
```typescript
guestsService = { syncFromReservation: jest.fn() };
```
Add to the `providers` array passed to `Test.createTestingModule`:
```typescript
{ provide: GuestsService, useValue: guestsService },
```

- [ ] **Step 2: Write the failing tests for the new hook**

Add to `api/src/reservations/reservations.service.spec.ts` (alongside the existing `create`/`update` tests):
```typescript
it('syncs the guest after creating a reservation with a guestEmail', async () => {
  const created = { id: '1', ...validDto, guestEmail: 'jane@example.com', guestPhone: '+54911' };
  prisma.reservation.create.mockResolvedValue(created);

  await service.create({ ...validDto, guestEmail: 'jane@example.com', guestPhone: '+54911' });

  expect(guestsService.syncFromReservation).toHaveBeenCalledWith('1', {
    email: 'jane@example.com',
    name: created.guestName,
    phone: '+54911',
  });
});

it('does not sync a guest when guestEmail is absent on create', async () => {
  prisma.reservation.create.mockResolvedValue({ id: '1', ...validDto, guestEmail: null });

  await service.create(validDto);

  expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
});

it('syncs the guest after updating a reservation with a guestEmail', async () => {
  prisma.reservation.findUnique.mockResolvedValue({ id: '1', ...validDto });
  const updated = { id: '1', ...validDto, guestEmail: 'jane@example.com', guestName: 'Updated Name', guestPhone: null };
  prisma.reservation.update.mockResolvedValue(updated);

  await service.update('1', { guestName: 'Updated Name' });

  expect(guestsService.syncFromReservation).toHaveBeenCalledWith('1', {
    email: 'jane@example.com',
    name: 'Updated Name',
    phone: null,
  });
});
```

- [ ] **Step 3: Run the tests and confirm the three new ones fail**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: the three new tests FAIL; all pre-existing tests in the file still PASS since Step 1 kept the module compiling.

- [ ] **Step 4: Wire the hook into `ReservationsService`**

Modify `api/src/reservations/reservations.service.ts` — add the import:
```typescript
import { GuestsService } from '../guests/guests.service';
```
Add to the constructor:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly eventsService: ReservationEventsService,
  private readonly emailService: EmailService,
  private readonly confirmationService: ReservationConfirmationService,
  private readonly googleCalendarPushService: GoogleCalendarPushService,
  private readonly guestsService: GuestsService,
) {}
```
In `create()`, after the fire-and-forget Google Calendar push and before `return reservation;`:
```typescript
if (reservation.guestEmail) {
  void this.guestsService.syncFromReservation(reservation.id, {
    email: reservation.guestEmail,
    name: reservation.guestName,
    phone: reservation.guestPhone,
  });
}

return reservation;
```
In `update()`, after the fire-and-forget Google Calendar push and before `return updated;`:
```typescript
if (updated.guestEmail) {
  void this.guestsService.syncFromReservation(updated.id, {
    email: updated.guestEmail,
    name: updated.guestName,
    phone: updated.guestPhone,
  });
}

return updated;
```
`syncFromReservation` never throws (verified in Task 2's tests), so — same as the Google Calendar push — this is a plain fire-and-forget call, no `await`, no try/catch needed at the call site.

Modify `api/src/reservations/reservations.module.ts` to import `GuestsModule` (from `../guests/guests.module`) alongside its existing imports.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- reservations.service.spec.ts`
Expected: PASS (all original tests + the 3 new ones)

- [ ] **Step 6: Update `public-reservations.service.spec.ts`'s provider wiring**

`PublicReservationsService`'s constructor gains a new dependency. In `api/src/public-reservations/public-reservations.service.spec.ts`, add the import:
```typescript
import { GuestsService } from '../guests/guests.service';
```
Add to the `let` declarations block:
```typescript
let guestsService: { syncFromReservation: jest.Mock };
```
In `beforeEach`:
```typescript
guestsService = { syncFromReservation: jest.fn() };
```
Add to the `providers` array:
```typescript
{ provide: GuestsService, useValue: guestsService },
```

- [ ] **Step 7: Write the failing test for the contract-acceptance hook**

Add to `api/src/public-reservations/public-reservations.service.spec.ts` (alongside the existing `acceptContract` tests):
```typescript
it('syncs the guest with the self-provided name when the contract is accepted', async () => {
  prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation, guestEmail: 'jane@example.com', guestPhone: '+54911' });
  prisma.reservation.update.mockResolvedValue({
    ...baseReservation,
    contractAcceptedAt: new Date(),
    guestEmail: 'jane@example.com',
    guestPhone: '+54911',
  });

  await service.acceptContract('tok-1', 'Jane Q. Doe');

  expect(guestsService.syncFromReservation).toHaveBeenCalledWith('res-1', {
    email: 'jane@example.com',
    name: 'Jane Q. Doe',
    phone: '+54911',
  });
});

it('does not sync a guest on contract acceptance when there is no guestEmail', async () => {
  prisma.reservation.findUnique.mockResolvedValue({ ...baseReservation, guestEmail: null });
  prisma.reservation.update.mockResolvedValue({ ...baseReservation, contractAcceptedAt: new Date(), guestEmail: null });

  await service.acceptContract('tok-1', 'Jane Q. Doe');

  expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
});

it('does not sync a guest when the contract was already accepted', async () => {
  prisma.reservation.findUnique.mockResolvedValue({
    ...baseReservation,
    contractAcceptedAt: new Date('2026-01-01'),
    guestEmail: 'jane@example.com',
  });

  await service.acceptContract('tok-1', 'A Different Name');

  expect(guestsService.syncFromReservation).not.toHaveBeenCalled();
});
```

Note: `baseReservation` in this file doesn't currently include `guestEmail`/`guestPhone` fields — that's fine, the first two new tests above override them via spread, and the third test's early-return path never reads them.

- [ ] **Step 8: Run the tests and confirm the three new ones fail**

Run: `docker compose exec api npm test -- public-reservations.service.spec.ts`
Expected: the three new tests FAIL; all pre-existing tests still PASS.

- [ ] **Step 9: Wire the hook into `PublicReservationsService`**

Modify `api/src/public-reservations/public-reservations.service.ts` — add the import:
```typescript
import { GuestsService } from '../guests/guests.service';
```
Add to the constructor:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly settingsService: SettingsService,
  private readonly eventsService: ReservationEventsService,
  private readonly confirmationService: ReservationConfirmationService,
  private readonly guestsService: GuestsService,
) {}
```
In `acceptContract()`, after `await this.confirmationService.maybeAutoConfirm(reservation.id);` and before `return { contractAcceptedAt: updated.contractAcceptedAt };`:
```typescript
if (updated.guestEmail) {
  void this.guestsService.syncFromReservation(updated.id, {
    email: updated.guestEmail,
    name: fullName,
    phone: updated.guestPhone,
  });
}

return { contractAcceptedAt: updated.contractAcceptedAt };
```
Use `fullName` (the guest's just-submitted name, the method's own parameter) rather than `updated.guestName` — the guest's self-provided name at contract-acceptance time is exactly what should sync to their `Guest.name`, per the spec.

Modify `api/src/public-reservations/public-reservations.module.ts` to import `GuestsModule` (from `../guests/guests.module`) alongside its existing imports.

- [ ] **Step 10: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- public-reservations.service.spec.ts`
Expected: PASS (all original tests + the 3 new ones)

- [ ] **Step 11: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS — `reservations.e2e-spec.ts`/`guest-onboarding-flow.e2e-spec.ts` exercise the real, un-mocked `GuestsService` via the real `AppModule`; since it never throws, this is safe.

- [ ] **Step 12: Commit**

```bash
git add api/src/reservations api/src/public-reservations
git commit -m "Sync guests from reservation create/update and contract acceptance"
```

---

### Task 4: GuestsController (admin list) + admin-web Guests page

**Files:**
- Create: `api/src/guests/guests.controller.ts`
- Modify: `api/src/guests/guests.module.ts`, `api/src/app.module.ts`
- Create: `api/test/guests.e2e-spec.ts`
- Create: `admin-web/src/api/guests.ts`, `admin-web/src/guests/GuestListPage.tsx`, `admin-web/src/guests/GuestListPage.test.tsx`
- Modify: `admin-web/src/App.tsx`, `admin-web/src/reservations/ReservationListPage.tsx`

**Interfaces:**
- Consumes: `GuestsService.findAll()` (Task 2).
- Produces: `GET /guests` (JWT-guarded) — consumed by Task 8's Campaigns page indirectly only through the same list styling; no other later-task dependency.

- [ ] **Step 1: Implement the controller**

`api/src/guests/guests.controller.ts`:
```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuestsService } from './guests.service';

@UseGuards(JwtAuthGuard)
@Controller('guests')
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  findAll() {
    return this.guestsService.findAll();
  }
}
```

Modify `api/src/guests/guests.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

@Module({
  controllers: [GuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
```

Modify `api/src/app.module.ts`: add `GuestsModule` (imported from `./guests/guests.module`) to the `imports` array, alongside `GoogleCalendarModule`.

- [ ] **Step 2: Write the e2e test**

`api/test/guests.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('GuestsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-guests@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    await prisma.guest.create({ data: { email: 'e2e-guest-1@example.com', name: 'E2E Guest One' } });
  });

  afterAll(async () => {
    await prisma.guest.deleteMany({ where: { email: 'e2e-guest-1@example.com' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-guests@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/guests').expect(401);
  });

  it('lists guests', async () => {
    const response = await request(app.getHttpServer())
      .get('/guests')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.some((g: { email: string }) => g.email === 'e2e-guest-1@example.com')).toBe(true);
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

- [ ] **Step 4: Add the admin-web API client**

`admin-web/src/api/guests.ts`:
```typescript
import { apiClient } from './client';

export interface Guest {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  totalStays: number;
  lastStayAt: string | null;
  unsubscribedAt: string | null;
}

export function listGuests(): Promise<Guest[]> {
  return apiClient.request('/guests');
}
```

- [ ] **Step 5: Write the failing test**

`admin-web/src/guests/GuestListPage.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuestListPage } from './GuestListPage';
import * as guestsApi from '../api/guests';

describe('GuestListPage', () => {
  it('loads and displays guests', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockResolvedValue([
      {
        id: '1',
        email: 'jane@example.com',
        name: 'Jane Doe',
        phone: '+54911',
        totalStays: 3,
        lastStayAt: '2026-05-01T00:00:00.000Z',
        unsubscribedAt: null,
      },
      {
        id: '2',
        email: 'john@example.com',
        name: 'John Smith',
        phone: null,
        totalStays: 1,
        lastStayAt: '2026-01-01T00:00:00.000Z',
        unsubscribedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    render(<GuestListPage />);

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText(/unsubscribed/i)).toBeInTheDocument();
  });

  it('shows an alert when guests cannot be loaded', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockRejectedValue(new Error('network error'));

    render(<GuestListPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the guests/i);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/guests/GuestListPage.test.tsx`
Expected: FAIL (`Cannot find module './GuestListPage'`)

- [ ] **Step 7: Implement `GuestListPage`**

`admin-web/src/guests/GuestListPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listGuests, Guest } from '../api/guests';

export function GuestListPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch(() => setError('Could not load the guests. Please reload the page.'));
  }, []);

  return (
    <div>
      <h1>Guests</h1>
      <Link to="/">Reservations</Link>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Total stays</th>
            <th>Last stay</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td>{g.email}</td>
              <td>{g.phone ?? '—'}</td>
              <td>{g.totalStays}</td>
              <td>{g.lastStayAt ? new Date(g.lastStayAt).toLocaleDateString() : '—'}</td>
              <td>{g.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/guests/GuestListPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 9: Wire up routing and navigation**

Modify `admin-web/src/App.tsx` — add the import `import { GuestListPage } from './guests/GuestListPage';` and a new route inside the `<Route element={<ProtectedRoute />}>` block, alongside the existing routes:
```tsx
<Route path="/guests" element={<GuestListPage />} />
```

Modify `admin-web/src/reservations/ReservationListPage.tsx` — add a nav link alongside the existing `<Link to="/settings">Settings</Link>`:
```tsx
<Link to="/guests">Guests</Link>
```

- [ ] **Step 10: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 11: Commit**

```bash
git add api/src/guests api/src/app.module.ts api/test/guests.e2e-spec.ts admin-web/src/api/guests.ts admin-web/src/guests admin-web/src/App.tsx admin-web/src/reservations/ReservationListPage.tsx
git commit -m "Add admin Guests list page"
```

---

### Task 5: Public unsubscribe endpoint

**Files:**
- Create: `api/src/guests/public-guests.controller.ts`
- Modify: `api/src/guests/guests.module.ts`
- Create: `api/test/public-guests.e2e-spec.ts`

**Interfaces:**
- Consumes: `GuestsService.unsubscribeByToken()` (Task 2).
- Produces: `GET /public/guests/:token/unsubscribe` (public, unauthenticated) — consumed by Task 7 (the unsubscribe link embedded in campaign emails).

- [ ] **Step 1: Implement the controller**

`api/src/guests/public-guests.controller.ts`:
```typescript
import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GuestsService } from './guests.service';

@Controller('public/guests')
export class PublicGuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get(':token/unsubscribe')
  async unsubscribe(@Param('token') token: string, @Res() res: Response) {
    await this.guestsService.unsubscribeByToken(token);
    res.send(
      '<html><body><h1>You have been unsubscribed</h1><p>You will no longer receive marketing emails from La Brisa de Mar del Plata.</p></body></html>',
    );
  }
}
```
Express's `res.send()` sets `Content-Type: text/html` automatically for a string body starting with `<` — no explicit header needed.

Modify `api/src/guests/guests.module.ts` — add the new controller:
```typescript
import { Module } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { PublicGuestsController } from './public-guests.controller';
import { GuestsService } from './guests.service';

@Module({
  controllers: [GuestsController, PublicGuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
```

- [ ] **Step 2: Write the e2e test**

`api/test/public-guests.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PublicGuestsController (e2e)', () => {
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
    await prisma.guest.deleteMany({ where: { email: 'e2e-unsubscribe@example.com' } });
    await app.close();
  });

  it('unsubscribes a guest by their token, with no authentication required', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'e2e-unsubscribe@example.com', name: 'E2E Unsubscribe Guest' },
    });
    expect(guest.unsubscribedAt).toBeNull();

    const response = await request(app.getHttpServer())
      .get(`/public/guests/${guest.unsubscribeToken}/unsubscribe`)
      .expect(200);

    expect(response.text).toContain('unsubscribed');

    const updated = await prisma.guest.findUnique({ where: { id: guest.id } });
    expect(updated?.unsubscribedAt).not.toBeNull();
  });

  it('does not error for an unknown token', async () => {
    await request(app.getHttpServer()).get('/public/guests/unknown-token/unsubscribe').expect(200);
  });

  it('is idempotent for an already-unsubscribed guest', async () => {
    const guest = await prisma.guest.create({
      data: {
        email: 'e2e-unsubscribe-2@example.com',
        name: 'E2E Unsubscribe Guest 2',
        unsubscribedAt: new Date('2026-01-01'),
      },
    });

    await request(app.getHttpServer()).get(`/public/guests/${guest.unsubscribeToken}/unsubscribe`).expect(200);

    await prisma.guest.delete({ where: { id: guest.id } });
  });
});
```
Add cleanup for `e2e-unsubscribe-2@example.com` to the file's `afterAll` too (it's already deleted inline in the idempotency test above, but add it to `afterAll` as well in case that test fails before reaching its own cleanup — use `deleteMany` with an `in` filter for both emails to keep it simple):
```typescript
afterAll(async () => {
  await prisma.guest.deleteMany({ where: { email: { in: ['e2e-unsubscribe@example.com', 'e2e-unsubscribe-2@example.com'] } } });
  await app.close();
});
```
(Replace the single-email `afterAll` from the code block above with this version.)

- [ ] **Step 3: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 4: Commit**

```bash
git add api/src/guests api/test/public-guests.e2e-spec.ts
git commit -m "Add public unsubscribe endpoint for guests"
```

---

### Task 6: CampaignTemplates CRUD (backend + admin-web)

**Files:**
- Create: `api/src/campaign-templates/campaign-templates.service.ts`, `campaign-templates.service.spec.ts`, `campaign-templates.controller.ts`, `campaign-templates.module.ts`
- Create: `api/src/campaign-templates/dto/create-campaign-template.dto.ts`, `dto/update-campaign-template.dto.ts`
- Modify: `api/src/app.module.ts`
- Create: `api/test/campaign-templates.e2e-spec.ts`
- Create: `admin-web/src/api/campaign-templates.ts`, `admin-web/src/templates/TemplatesPage.tsx`, `admin-web/src/templates/TemplatesPage.test.tsx`
- Modify: `admin-web/src/App.tsx`, `admin-web/src/reservations/ReservationListPage.tsx`

**Interfaces:**
- Produces: `CampaignTemplatesService.{create,findAll,findOne,update,remove}` and `POST/GET/PATCH/DELETE /campaign-templates` (JWT-guarded) — consumed by Task 7 (campaign send needs `findOne`) and Task 8 (admin-web campaign compose form needs `findAll`).

- [ ] **Step 1: Write the failing service tests**

`api/src/campaign-templates/campaign-templates.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignTemplatesService } from './campaign-templates.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignTemplatesService', () => {
  let service: CampaignTemplatesService;
  let prisma: {
    campaignTemplate: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    campaign: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      campaignTemplate: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      campaign: { count: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [CampaignTemplatesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CampaignTemplatesService);
  });

  it('creates a template', async () => {
    prisma.campaignTemplate.create.mockResolvedValue({ id: '1', name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' });

    const result = await service.create({ name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' });

    expect(result.id).toBe('1');
    expect(prisma.campaignTemplate.create).toHaveBeenCalledWith({
      data: { name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
    });
  });

  it('lists all templates', async () => {
    prisma.campaignTemplate.findMany.mockResolvedValue([{ id: '1' }]);

    const result = await service.findAll();

    expect(result).toEqual([{ id: '1' }]);
  });

  it('throws NotFoundException when finding a missing template', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('updates a template', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue({ id: '1' });
    prisma.campaignTemplate.update.mockResolvedValue({ id: '1', name: 'Updated name' });

    const result = await service.update('1', { name: 'Updated name' });

    expect(result.name).toBe('Updated name');
  });

  it('deletes a template that is not referenced by any campaign', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue({ id: '1' });
    prisma.campaign.count.mockResolvedValue(0);

    await service.remove('1');

    expect(prisma.campaignTemplate.delete).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('refuses to delete a template referenced by a campaign', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue({ id: '1' });
    prisma.campaign.count.mockResolvedValue(2);

    await expect(service.remove('1')).rejects.toThrow(BadRequestException);
    expect(prisma.campaignTemplate.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `docker compose exec api npm test -- campaign-templates.service.spec.ts`
Expected: FAIL (`Cannot find module './campaign-templates.service'`)

- [ ] **Step 3: Implement the DTOs, service, controller, and module**

`api/src/campaign-templates/dto/create-campaign-template.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class CreateCampaignTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  bodyHtml: string;
}
```

`api/src/campaign-templates/dto/update-campaign-template.dto.ts`:
```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateCampaignTemplateDto } from './create-campaign-template.dto';

export class UpdateCampaignTemplateDto extends PartialType(CreateCampaignTemplateDto) {}
```

`api/src/campaign-templates/campaign-templates.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignTemplateDto } from './dto/create-campaign-template.dto';
import { UpdateCampaignTemplateDto } from './dto/update-campaign-template.dto';

@Injectable()
export class CampaignTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCampaignTemplateDto) {
    return this.prisma.campaignTemplate.create({ data: dto });
  }

  findAll() {
    return this.prisma.campaignTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const template = await this.prisma.campaignTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return template;
  }

  async update(id: string, dto: UpdateCampaignTemplateDto) {
    await this.findOne(id);
    return this.prisma.campaignTemplate.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const usageCount = await this.prisma.campaign.count({ where: { templateId: id } });
    if (usageCount > 0) {
      throw new BadRequestException(
        `This template has been used in ${usageCount} campaign(s) and cannot be deleted.`,
      );
    }
    await this.prisma.campaignTemplate.delete({ where: { id } });
  }
}
```

`api/src/campaign-templates/campaign-templates.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignTemplatesService } from './campaign-templates.service';
import { CreateCampaignTemplateDto } from './dto/create-campaign-template.dto';
import { UpdateCampaignTemplateDto } from './dto/update-campaign-template.dto';

@UseGuards(JwtAuthGuard)
@Controller('campaign-templates')
export class CampaignTemplatesController {
  constructor(private readonly service: CampaignTemplatesService) {}

  @Post()
  create(@Body() dto: CreateCampaignTemplateDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

`api/src/campaign-templates/campaign-templates.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { CampaignTemplatesController } from './campaign-templates.controller';
import { CampaignTemplatesService } from './campaign-templates.service';

@Module({
  controllers: [CampaignTemplatesController],
  providers: [CampaignTemplatesService],
  exports: [CampaignTemplatesService],
})
export class CampaignTemplatesModule {}
```

Modify `api/src/app.module.ts`: add `CampaignTemplatesModule` (imported from `./campaign-templates/campaign-templates.module`) to the `imports` array.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- campaign-templates.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the e2e test**

`api/test/campaign-templates.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('CampaignTemplatesController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let templateId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-campaign-templates@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    if (templateId) {
      await prisma.campaignTemplate.deleteMany({ where: { id: templateId } });
    }
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-campaign-templates@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/campaign-templates').expect(401);
  });

  it('creates, lists, updates, and deletes a template', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/campaign-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Template', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' })
      .expect(201);

    templateId = createResponse.body.id;

    const listResponse = await request(app.getHttpServer())
      .get('/campaign-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listResponse.body.some((t: { id: string }) => t.id === templateId)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/campaign-templates/${templateId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Template Updated' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/campaign-templates/${templateId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    templateId = '';
  });
});
```

- [ ] **Step 6: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 7: Add the admin-web API client**

`admin-web/src/api/campaign-templates.ts`:
```typescript
import { apiClient } from './client';

export interface CampaignTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
}

export type CampaignTemplateInput = Omit<CampaignTemplate, 'id'>;

export function listCampaignTemplates(): Promise<CampaignTemplate[]> {
  return apiClient.request('/campaign-templates');
}

export function createCampaignTemplate(input: CampaignTemplateInput): Promise<CampaignTemplate> {
  return apiClient.request('/campaign-templates', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCampaignTemplate(id: string, input: Partial<CampaignTemplateInput>): Promise<CampaignTemplate> {
  return apiClient.request(`/campaign-templates/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteCampaignTemplate(id: string): Promise<void> {
  return apiClient.request(`/campaign-templates/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 8: Write the failing test**

`admin-web/src/templates/TemplatesPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplatesPage } from './TemplatesPage';
import * as templatesApi from '../api/campaign-templates';

describe('TemplatesPage', () => {
  it('loads and displays templates, and creates a new one', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: '1', name: 'Welcome back', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' },
    ]);
    const createSpy = vi.spyOn(templatesApi, 'createCampaignTemplate').mockResolvedValue({
      id: '2',
      name: 'New template',
      subject: 'Subject',
      bodyHtml: '<p>Body</p>',
    });

    render(<TemplatesPage />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'New template' } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Subject' } });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: '<p>Body</p>' } });
    fireEvent.click(screen.getByRole('button', { name: /create template/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({ name: 'New template', subject: 'Subject', bodyHtml: '<p>Body</p>' }),
    );
  });

  it('deletes a template', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: '1', name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
    ]);
    const deleteSpy = vi.spyOn(templatesApi, 'deleteCampaignTemplate').mockResolvedValue(undefined);

    render(<TemplatesPage />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('1'));
  });

  it('shows an alert when a delete is refused because the template is in use', async () => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: '1', name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
    ]);
    vi.spyOn(templatesApi, 'deleteCampaignTemplate').mockRejectedValue(new Error('in use'));

    render(<TemplatesPage />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete/i);
  });
});
```

- [ ] **Step 9: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/templates/TemplatesPage.test.tsx`
Expected: FAIL

- [ ] **Step 10: Implement `TemplatesPage`**

`admin-web/src/templates/TemplatesPage.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listCampaignTemplates,
  createCampaignTemplate,
  deleteCampaignTemplate,
  CampaignTemplate,
} from '../api/campaign-templates';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setLoadError('Could not load the templates. Please reload the page.'));
  }

  useEffect(reload, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      await createCampaignTemplate({ name, subject, bodyHtml });
      setName('');
      setSubject('');
      setBodyHtml('');
      reload();
    } catch {
      setActionError('Could not create the template. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await deleteCampaignTemplate(id);
      reload();
    } catch {
      setActionError('Could not delete the template — it may already be used in a campaign.');
    }
  }

  return (
    <div>
      <h1>Templates</h1>
      <Link to="/">Reservations</Link>
      {loadError && <p role="alert">{loadError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      <form onSubmit={handleCreate}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          Body
          <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={6} />
        </label>
        <p>Use <code>{'{{guestName}}'}</code> in the subject or body to insert the guest's name.</p>
        <button type="submit">Create template</button>
      </form>
      <ul>
        {templates.map((t) => (
          <li key={t.id}>
            {t.name} — {t.subject}
            <button type="button" onClick={() => handleDelete(t.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 11: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/templates/TemplatesPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 12: Wire up routing and navigation**

Modify `admin-web/src/App.tsx` — add the import and route:
```tsx
import { TemplatesPage } from './templates/TemplatesPage';
```
```tsx
<Route path="/templates" element={<TemplatesPage />} />
```

Modify `admin-web/src/reservations/ReservationListPage.tsx` — add a nav link alongside the `/guests` link added in Task 4:
```tsx
<Link to="/templates">Templates</Link>
```

- [ ] **Step 13: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 14: Commit**

```bash
git add api/src/campaign-templates api/src/app.module.ts api/test/campaign-templates.e2e-spec.ts admin-web/src/api/campaign-templates.ts admin-web/src/templates admin-web/src/App.tsx admin-web/src/reservations/ReservationListPage.tsx
git commit -m "Add campaign templates CRUD (backend + admin UI)"
```

---

### Task 7: Campaigns backend — preview, send, history

**Files:**
- Modify: `api/src/email/email.service.ts`, `email.service.spec.ts`
- Create: `api/src/campaigns/campaigns.service.ts`, `campaigns.service.spec.ts`, `campaigns.controller.ts`, `campaigns.module.ts`
- Create: `api/src/campaigns/dto/campaign-query.dto.ts`
- Modify: `api/src/app.module.ts`
- Create: `api/test/campaigns.e2e-spec.ts`

**Interfaces:**
- Consumes: `GuestsService.findEligibleForCampaign()` (Task 2), `CampaignTemplatesService.findOne()`-equivalent lookup (this task queries `CampaignTemplate` directly via Prisma rather than through `CampaignTemplatesService`, to keep the 404 behavior scoped to this module — see Step 3), `EmailService.sendMarketingEmail()` (new in this task).
- Produces: `GET /campaigns/preview` and `POST /campaigns` (JWT-guarded), `GET /campaigns` (JWT-guarded, history) — consumed by Task 8 (admin-web Campaigns page).

- [ ] **Step 1: Write the failing test for the new `EmailService` method**

Add to `api/src/email/email.service.spec.ts` (alongside the existing tests):
```typescript
it('sends a marketing email with the given subject and html', async () => {
  sendMock.mockResolvedValue({ error: null });

  await expect(
    service.sendMarketingEmail('guest@example.com', 'Come back!', '<p>We miss you</p>'),
  ).resolves.toBeUndefined();

  expect(sendMock).toHaveBeenCalledWith({
    from: 'reservas@labrisa.com.ar',
    to: 'guest@example.com',
    subject: 'Come back!',
    html: '<p>We miss you</p>',
  });
});

it('throws when Resend returns an error for a marketing email', async () => {
  sendMock.mockResolvedValue({ error: { message: 'bounced' } });

  await expect(service.sendMarketingEmail('bad@example.com', 'Subject', '<p>Body</p>')).rejects.toThrow('bounced');
});
```

- [ ] **Step 2: Run it and confirm it fails, then implement**

Run: `docker compose exec api npm test -- email.service.spec.ts`
Expected: the 2 new tests FAIL

Add to `api/src/email/email.service.ts` (inside the existing `EmailService` class, alongside `sendAlert`):
```typescript
async sendMarketingEmail(to: string, subject: string, html: string): Promise<void> {
  const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });

  if (error) {
    throw new Error(error.message);
  }
}
```

Run: `docker compose exec api npm test -- email.service.spec.ts`
Expected: PASS (all original tests + the 2 new ones)

- [ ] **Step 3: Write the failing `CampaignsService` tests**

`api/src/campaigns/campaigns.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { GuestsService } from '../guests/guests.service';
import { EmailService } from '../email/email.service';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: {
    campaignTemplate: { findUnique: jest.Mock };
    campaign: { create: jest.Mock; findMany: jest.Mock };
  };
  let guestsService: { findEligibleForCampaign: jest.Mock };
  let emailService: { sendMarketingEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      campaignTemplate: { findUnique: jest.fn() },
      campaign: { create: jest.fn(), findMany: jest.fn() },
    };
    guestsService = { findEligibleForCampaign: jest.fn() };
    emailService = { sendMarketingEmail: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GuestsService, useValue: guestsService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(CampaignsService);
    process.env.API_ORIGIN = 'http://localhost:3001';
  });

  describe('preview', () => {
    it('returns the count of eligible guests without sending anything', async () => {
      guestsService.findEligibleForCampaign.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);

      const result = await service.preview('tpl-1', 'ALL');

      expect(result).toEqual({ recipientCount: 2 });
      expect(emailService.sendMarketingEmail).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('throws NotFoundException for a missing template', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue(null);

      await expect(service.send('missing', 'ALL')).rejects.toThrow(NotFoundException);
    });

    it('sends to every eligible guest, records SENT/FAILED per recipient, and creates the Campaign row', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        subject: 'Hi {{guestName}}',
        bodyHtml: '<p>Hi {{guestName}}</p>',
      });
      guestsService.findEligibleForCampaign.mockResolvedValue([
        { id: 'g1', name: 'Jane Doe', email: 'jane@example.com', unsubscribeToken: 'tok-1' },
        { id: 'g2', name: 'John Smith', email: 'john@example.com', unsubscribeToken: 'tok-2' },
      ]);
      emailService.sendMarketingEmail
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('bounced'));
      prisma.campaign.create.mockResolvedValue({ id: 'camp-1', recipientCount: 2 });

      const result = await service.send('tpl-1', 'ALL');

      expect(emailService.sendMarketingEmail).toHaveBeenNthCalledWith(
        1,
        'jane@example.com',
        'Hi {{guestName}}',
        expect.stringContaining('Hi Jane Doe'),
      );
      expect(emailService.sendMarketingEmail.mock.calls[0][2]).toContain('http://localhost:3001/public/guests/tok-1/unsubscribe');
      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: {
          templateId: 'tpl-1',
          filterType: 'ALL',
          filterMonths: null,
          recipientCount: 2,
          recipients: {
            create: [
              { guestId: 'g1', status: 'SENT', error: null },
              { guestId: 'g2', status: 'FAILED', error: 'bounced' },
            ],
          },
        },
        include: { recipients: true },
      });
      expect(result).toEqual({ id: 'camp-1', recipientCount: 2 });
    });

    it('creates a Campaign row with zero SENT even when there are no eligible guests', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', subject: 'Hi', bodyHtml: '<p>Hi</p>' });
      guestsService.findEligibleForCampaign.mockResolvedValue([]);
      prisma.campaign.create.mockResolvedValue({ id: 'camp-1', recipientCount: 0 });

      await service.send('tpl-1', 'ALL');

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ recipientCount: 0, recipients: { create: [] } }),
        include: { recipients: true },
      });
    });
  });

  describe('listHistory', () => {
    it('returns campaigns ordered most-recent-first with template and recipients included', async () => {
      prisma.campaign.findMany.mockResolvedValue([{ id: 'camp-1' }]);

      const result = await service.listHistory();

      expect(prisma.campaign.findMany).toHaveBeenCalledWith({
        orderBy: { sentAt: 'desc' },
        include: { template: true, recipients: true },
      });
      expect(result).toEqual([{ id: 'camp-1' }]);
    });
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `docker compose exec api npm test -- campaigns.service.spec.ts`
Expected: FAIL (`Cannot find module './campaigns.service'`)

- [ ] **Step 5: Implement the DTO, service, controller, and module**

`api/src/campaigns/dto/campaign-query.dto.ts`:
```typescript
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Min, ValidateIf } from 'class-validator';
import { CampaignFilterType } from '@prisma/client';

export class CampaignQueryDto {
  @IsUUID()
  templateId: string;

  @IsEnum(CampaignFilterType)
  filterType: CampaignFilterType;

  @ValidateIf((o) => o.filterType !== 'ALL')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  filterMonths?: number;
}
```

`api/src/campaigns/campaigns.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignFilterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuestsService } from '../guests/guests.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guestsService: GuestsService,
    private readonly emailService: EmailService,
  ) {}

  async preview(templateId: string, filterType: CampaignFilterType, filterMonths?: number) {
    const guests = await this.guestsService.findEligibleForCampaign(filterType, filterMonths);
    return { recipientCount: guests.length };
  }

  async send(templateId: string, filterType: CampaignFilterType, filterMonths?: number) {
    const template = await this.prisma.campaignTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    const guests = await this.guestsService.findEligibleForCampaign(filterType, filterMonths);

    const results: { guestId: string; status: 'SENT' | 'FAILED'; error: string | null }[] = [];

    for (const guest of guests) {
      const unsubscribeUrl = `${process.env.API_ORIGIN}/public/guests/${guest.unsubscribeToken}/unsubscribe`;
      const subject = template.subject.replaceAll('{{guestName}}', guest.name);
      const html = `${template.bodyHtml.replaceAll('{{guestName}}', guest.name)}<p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;

      try {
        await this.emailService.sendMarketingEmail(guest.email, subject, html);
        results.push({ guestId: guest.id, status: 'SENT', error: null });
      } catch (error) {
        results.push({ guestId: guest.id, status: 'FAILED', error: (error as Error).message });
      }
    }

    return this.prisma.campaign.create({
      data: {
        templateId,
        filterType,
        filterMonths: filterMonths ?? null,
        recipientCount: guests.length,
        recipients: { create: results },
      },
      include: { recipients: true },
    });
  }

  listHistory() {
    return this.prisma.campaign.findMany({
      orderBy: { sentAt: 'desc' },
      include: { template: true, recipients: true },
    });
  }
}
```

`api/src/campaigns/campaigns.controller.ts`:
```typescript
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignQueryDto } from './dto/campaign-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Get('preview')
  preview(@Query() query: CampaignQueryDto) {
    return this.service.preview(query.templateId, query.filterType, query.filterMonths);
  }

  @Post()
  send(@Body() dto: CampaignQueryDto) {
    return this.service.send(dto.templateId, dto.filterType, dto.filterMonths);
  }

  @Get()
  listHistory() {
    return this.service.listHistory();
  }
}
```

**Route ordering note**: `GET /campaigns/preview` has no conflict with `GET /campaigns` here since neither is a `:param` route — no ordering constraint like sub-project 3's `check-overlap` case applies.

`api/src/campaigns/campaigns.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { GuestsModule } from '../guests/guests.module';

@Module({
  imports: [GuestsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
```
`EmailModule` is `@Global()` (declared in sub-project 2), so `EmailService` is already available for injection here without an explicit import.

Modify `api/src/app.module.ts`: add `CampaignsModule` (imported from `./campaigns/campaigns.module`) to the `imports` array.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `docker compose exec api npm test -- campaigns.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Write the e2e test**

`api/test/campaigns.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('CampaignsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let templateId: string;
  let guestId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-campaigns@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    const template = await prisma.campaignTemplate.create({
      data: { name: 'E2E Campaign Template', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' },
    });
    templateId = template.id;

    const guest = await prisma.guest.create({
      data: { email: 'e2e-campaign-guest@example.com', name: 'E2E Campaign Guest' },
    });
    guestId = guest.id;
  });

  afterAll(async () => {
    await prisma.campaignRecipient.deleteMany({ where: { guestId } });
    await prisma.campaign.deleteMany({ where: { templateId } });
    await prisma.campaignTemplate.deleteMany({ where: { id: templateId } });
    await prisma.guest.deleteMany({ where: { id: guestId } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-campaigns@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication for preview', async () => {
    await request(app.getHttpServer()).get(`/campaigns/preview?templateId=${templateId}&filterType=ALL`).expect(401);
  });

  it('previews the recipient count without sending anything', async () => {
    const response = await request(app.getHttpServer())
      .get(`/campaigns/preview?templateId=${templateId}&filterType=ALL`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.recipientCount).toBeGreaterThanOrEqual(1);
  });

  it('requires filterMonths for a month-based filter', async () => {
    await request(app.getHttpServer())
      .get(`/campaigns/preview?templateId=${templateId}&filterType=STAYED_WITHIN_MONTHS`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('sends a campaign and records it in history', async () => {
    const sendResponse = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ templateId, filterType: 'ALL' })
      .expect(201);

    expect(sendResponse.body.recipientCount).toBeGreaterThanOrEqual(1);

    const historyResponse = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(historyResponse.body.some((c: { id: string }) => c.id === sendResponse.body.id)).toBe(true);
  });
});
```
The e2e test environment has no real `RESEND_API_KEY` configured for actual delivery in most dev setups — that's fine, the `send` call still creates the `Campaign`/`CampaignRecipient` rows either way (recording `FAILED` if the real Resend call errors), satisfying this test's assertions regardless of whether the underlying email actually goes out.

- [ ] **Step 8: Run all API tests**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS

- [ ] **Step 9: Commit**

```bash
git add api/src/email api/src/campaigns api/src/app.module.ts api/test/campaigns.e2e-spec.ts
git commit -m "Add campaign preview/send/history backend"
```

---

### Task 8: admin-web Campaigns page — compose, preview, send, history

**Files:**
- Create: `admin-web/src/api/campaigns.ts`, `admin-web/src/campaigns/CampaignsPage.tsx`, `admin-web/src/campaigns/CampaignsPage.test.tsx`
- Modify: `admin-web/src/App.tsx`, `admin-web/src/reservations/ReservationListPage.tsx`

**Interfaces:**
- Consumes: `GET /campaigns/preview`, `POST /campaigns`, `GET /campaigns` (Task 7), `GET /campaign-templates` (Task 6).
- Produces: nothing consumed by later tasks — leaf feature, final task of this plan.

- [ ] **Step 1: Add the admin-web API client**

`admin-web/src/api/campaigns.ts`:
```typescript
import { apiClient } from './client';

export type CampaignFilterType = 'ALL' | 'STAYED_WITHIN_MONTHS' | 'NOT_STAYED_WITHIN_MONTHS';

export interface CampaignRecipient {
  id: string;
  guestId: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
}

export interface Campaign {
  id: string;
  templateId: string;
  template: { name: string };
  filterType: CampaignFilterType;
  filterMonths: number | null;
  recipientCount: number;
  sentAt: string;
  recipients: CampaignRecipient[];
}

export interface CampaignQuery {
  templateId: string;
  filterType: CampaignFilterType;
  filterMonths?: number;
}

export function previewCampaign(query: CampaignQuery): Promise<{ recipientCount: number }> {
  const params = new URLSearchParams({ templateId: query.templateId, filterType: query.filterType });
  if (query.filterMonths !== undefined) {
    params.set('filterMonths', String(query.filterMonths));
  }
  return apiClient.request(`/campaigns/preview?${params.toString()}`);
}

export function sendCampaign(query: CampaignQuery): Promise<Campaign> {
  return apiClient.request('/campaigns', { method: 'POST', body: JSON.stringify(query) });
}

export function listCampaignHistory(): Promise<Campaign[]> {
  return apiClient.request('/campaigns');
}
```

- [ ] **Step 2: Write the failing test**

`admin-web/src/campaigns/CampaignsPage.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignsPage } from './CampaignsPage';
import * as campaignsApi from '../api/campaigns';
import * as templatesApi from '../api/campaign-templates';

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.spyOn(templatesApi, 'listCampaignTemplates').mockResolvedValue([
      { id: 'tpl-1', name: 'Welcome back', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi</p>' },
    ]);
    vi.spyOn(campaignsApi, 'listCampaignHistory').mockResolvedValue([]);
  });

  it('previews the recipient count when a template and filter are chosen', async () => {
    const previewSpy = vi.spyOn(campaignsApi, 'previewCampaign').mockResolvedValue({ recipientCount: 5 });

    render(<CampaignsPage />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/template/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: 'ALL' } });

    await waitFor(() => expect(previewSpy).toHaveBeenCalledWith({ templateId: 'tpl-1', filterType: 'ALL' }));
    expect(await screen.findByText(/5 recipient/i)).toBeInTheDocument();
  });

  it('requires confirmation before sending, then sends', async () => {
    vi.spyOn(campaignsApi, 'previewCampaign').mockResolvedValue({ recipientCount: 5 });
    const sendSpy = vi.spyOn(campaignsApi, 'sendCampaign').mockResolvedValue({
      id: 'camp-1',
      templateId: 'tpl-1',
      template: { name: 'Welcome back' },
      filterType: 'ALL',
      filterMonths: null,
      recipientCount: 5,
      sentAt: '2026-09-13T12:00:00.000Z',
      recipients: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CampaignsPage />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/template/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: 'ALL' } });
    await waitFor(() => expect(screen.getByText(/5 recipient/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /send campaign/i }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith({ templateId: 'tpl-1', filterType: 'ALL' }));
  });

  it('does not send when the confirmation is declined', async () => {
    vi.spyOn(campaignsApi, 'previewCampaign').mockResolvedValue({ recipientCount: 5 });
    const sendSpy = vi.spyOn(campaignsApi, 'sendCampaign');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<CampaignsPage />);

    await waitFor(() => expect(screen.getByText('Welcome back')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/template/i), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: 'ALL' } });
    await waitFor(() => expect(screen.getByText(/5 recipient/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /send campaign/i }));

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('loads and displays campaign history', async () => {
    vi.spyOn(campaignsApi, 'listCampaignHistory').mockResolvedValue([
      {
        id: 'camp-1',
        templateId: 'tpl-1',
        template: { name: 'Welcome back' },
        filterType: 'ALL',
        filterMonths: null,
        recipientCount: 5,
        sentAt: '2026-09-13T12:00:00.000Z',
        recipients: [
          { id: 'r1', guestId: 'g1', status: 'SENT', error: null },
          { id: 'r2', guestId: 'g2', status: 'FAILED', error: 'bounced' },
        ],
      },
    ]);

    render(<CampaignsPage />);

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText(/5 recipient/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `docker compose exec admin-web npx vitest run src/campaigns/CampaignsPage.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implement `CampaignsPage`**

`admin-web/src/campaigns/CampaignsPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCampaignTemplates, CampaignTemplate } from '../api/campaign-templates';
import {
  previewCampaign,
  sendCampaign,
  listCampaignHistory,
  Campaign,
  CampaignFilterType,
} from '../api/campaigns';

export function CampaignsPage() {
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [filterType, setFilterType] = useState<CampaignFilterType | ''>('');
  const [filterMonths, setFilterMonths] = useState('6');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [history, setHistory] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    listCampaignTemplates()
      .then(setTemplates)
      .catch(() => setError('Could not load templates.'));
    reloadHistory();
  }, []);

  function reloadHistory() {
    listCampaignHistory()
      .then(setHistory)
      .catch(() => setError('Could not load campaign history.'));
  }

  useEffect(() => {
    if (!templateId || !filterType) {
      setRecipientCount(null);
      return;
    }
    if (filterType !== 'ALL' && !filterMonths) {
      setRecipientCount(null);
      return;
    }
    const query = {
      templateId,
      filterType,
      filterMonths: filterType === 'ALL' ? undefined : Number(filterMonths),
    };
    previewCampaign(query)
      .then((result) => setRecipientCount(result.recipientCount))
      .catch(() => setRecipientCount(null));
  }, [templateId, filterType, filterMonths]);

  async function handleSend() {
    if (!templateId || !filterType) return;
    if (!window.confirm(`Send this campaign to ${recipientCount ?? 0} guest(s)? This cannot be undone.`)) {
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendCampaign({
        templateId,
        filterType,
        filterMonths: filterType === 'ALL' ? undefined : Number(filterMonths),
      });
      reloadHistory();
    } catch {
      setError('Could not send the campaign. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h1>Campaigns</h1>
      <Link to="/">Reservations</Link>
      {error && <p role="alert">{error}</p>}
      <section>
        <h2>Compose</h2>
        <label>
          Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Select a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as CampaignFilterType | '')}>
            <option value="">Select a filter</option>
            <option value="ALL">All guests</option>
            <option value="STAYED_WITHIN_MONTHS">Stayed within the last N months</option>
            <option value="NOT_STAYED_WITHIN_MONTHS">Not stayed within the last N months</option>
          </select>
        </label>
        {filterType !== 'ALL' && filterType !== '' && (
          <label>
            N months
            <input type="number" min={1} value={filterMonths} onChange={(e) => setFilterMonths(e.target.value)} />
          </label>
        )}
        {recipientCount !== null && <p>{recipientCount} recipient(s) match this filter.</p>}
        <button type="button" onClick={handleSend} disabled={sending || recipientCount === null}>
          Send campaign
        </button>
      </section>
      <section>
        <h2>History</h2>
        <ul>
          {history.map((c) => (
            <li key={c.id}>
              {c.template.name} — {c.recipientCount} recipient(s) — {new Date(c.sentAt).toLocaleString()}
              <ul>
                {c.recipients.map((r) => (
                  <li key={r.id}>
                    {r.status}
                    {r.error ? `: ${r.error}` : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `docker compose exec admin-web npx vitest run src/campaigns/CampaignsPage.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 6: Wire up routing and navigation**

Modify `admin-web/src/App.tsx` — add the import and route:
```tsx
import { CampaignsPage } from './campaigns/CampaignsPage';
```
```tsx
<Route path="/campaigns" element={<CampaignsPage />} />
```

Modify `admin-web/src/reservations/ReservationListPage.tsx` — add a nav link:
```tsx
<Link to="/campaigns">Campaigns</Link>
```

- [ ] **Step 7: Run the full admin-web suite**

Run: `docker compose exec admin-web npm test`
Expected: all suites PASS, no regressions

- [ ] **Step 8: Run the full API suite one more time**

Run:
```bash
docker compose exec api npm test
docker compose exec api npm run test:e2e
```
Expected: all suites PASS — this is the last task, a final full-suite check catches any cross-task drift before the whole-branch review.

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/api/campaigns.ts admin-web/src/campaigns admin-web/src/App.tsx admin-web/src/reservations/ReservationListPage.tsx
git commit -m "Add admin Campaigns page: compose, preview, send, history"
```
