# Guest-Facing Ambient Sensor Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show guests the property's live ambient sensor readings (sound, CO, smoke, temperature, humidity) on guest-web's check-in page, but only once they're fully confirmed and during their actual stay — or always, in a debug environment.

**Architecture:** A new public, token-scoped `GET /public/reservations/:token/ambient` route reuses the existing `AmbientService.listDevices()` (the same data admin-web's Sensores page already shows), gated server-side by a fully-confirmed + in-date-range check (or a debug override). This requires generalizing the existing `EMAIL_DEBUG_MODE` flag into a single `DEBUG_MODE` flag reused for both its original email-redirect behavior and this new visibility override. guest-web gets a new self-contained `AmbientStatus` component and computes the same eligibility client-side (from data it already has) purely as a UX nicety — the real gate is server-side.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, Jest (backend), React 19, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-27-ambient-guest-visibility-design.md`

## Global Constraints

- The debug flag is renamed `EMAIL_DEBUG_MODE` → `DEBUG_MODE` everywhere (env, backend, both frontends' `/config` consumers) — one flag, reused for email redirection and ambient-data visibility. It is deliberately NOT renamed to a bare `DEBUG` — several transitive dependencies (Express included) treat a bare `DEBUG` env var as their own logging namespace switch, which would enable unrelated verbose logging as a side effect.
- The footer's existing debug banner text and behavior are otherwise unchanged — only the underlying variable/field name changes, not its copy or condition.
- Eligibility (identical formula, enforced both places): `DEBUG_MODE === 'true'` OR (`confirmationPaymentReceivedAt != null AND depositReceivedAt != null` AND `now` is between `checkIn` and `checkOut` inclusive). The backend enforcement (403 when ineligible) is the real security boundary; the frontend computing the same condition to decide whether to render the section is a UX nicety only.
- No Prisma schema or migration changes. The new route returns exactly what `AmbientService.listDevices()` already returns.
- Guests see all five sensor types with their raw values, unfiltered — no calibration, no "normal/elevated" interpretation.
- guest-web's sensor-label map is its own small local constant, not imported from admin-web — this codebase's established convention is per-app duplication of small UI bits, not a shared package.

---

### Task 1: Backend — rename `EMAIL_DEBUG_MODE` to `DEBUG_MODE` in the email service

**Files:**
- Modify: `api/src/email/email.service.ts`
- Modify: `api/src/email/email.service.spec.ts`
- Modify: `.env`

**Interfaces:**
- Produces: `process.env.DEBUG_MODE` as the flag every later task reads (Task 2's `/config` endpoint, Task 5's `PublicReservationsService.getAmbientReadings`).

- [ ] **Step 1: Update the test file's env var references**

In `api/src/email/email.service.spec.ts`, make these exact replacements (5 occurrences of the env var name, all renamed from `EMAIL_DEBUG_MODE` to `DEBUG_MODE`; `EMAIL_DEBUG_RECIPIENT` is unchanged, still email-specific):

Line 14: `const originalDebugMode = process.env.EMAIL_DEBUG_MODE;` → `const originalDebugMode = process.env.DEBUG_MODE;`

Line 28: `process.env.EMAIL_DEBUG_MODE = originalDebugMode;` → `process.env.DEBUG_MODE = originalDebugMode;`

Line 36 (comment): `// container loads (which has EMAIL_DEBUG_MODE=true for local guest-safe testing) —` → `// container loads (which has DEBUG_MODE=true for local guest-safe testing) —`

Line 39: `process.env.EMAIL_DEBUG_MODE = 'false';` → `process.env.DEBUG_MODE = 'false';`

Line 142 (comment): `// EMAIL_DEBUG_MODE/EMAIL_DEBUG_RECIPIENT to a known-off state before this runs.` → `// DEBUG_MODE/EMAIL_DEBUG_RECIPIENT to a known-off state before this runs.`

Line 144: `process.env.EMAIL_DEBUG_MODE = 'true';` → `process.env.DEBUG_MODE = 'true';`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec api npx jest email.service`
Expected: FAIL — the "debug mode" describe block's tests fail because `EmailService` still reads `process.env.EMAIL_DEBUG_MODE`, which the test file no longer sets.

- [ ] **Step 3: Update `email.service.ts`**

Replace lines 17-21 (the comment and the two debug fields):

```typescript
  // Named DEBUG_MODE rather than a bare DEBUG env var deliberately: several transitive
  // dependencies (Express included) treat a bare DEBUG env var as their own logging
  // namespace switch, which would enable unrelated verbose logging as a side effect.
  private readonly debugMode = process.env.DEBUG_MODE === 'true';
  private readonly debugRecipient = process.env.EMAIL_DEBUG_RECIPIENT;
```

Replace line 35's warning message:

```typescript
      this.logger.warn('DEBUG_MODE is enabled but EMAIL_DEBUG_RECIPIENT is not set — sending to the real recipient.');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec api npx jest email.service`
Expected: PASS, all tests

- [ ] **Step 5: Update `.env`**

Change line 36 from `EMAIL_DEBUG_MODE=true` to `DEBUG_MODE=true`.

Change the commented-out production-reference line 74 from `# EMAIL_DEBUG_MODE=true / EMAIL_DEBUG_RECIPIENT=damian.mantuano@gmail.com` to `# DEBUG_MODE=true / EMAIL_DEBUG_RECIPIENT=damian.mantuano@gmail.com`.

- [ ] **Step 6: Commit**

```bash
git add api/src/email/email.service.ts api/src/email/email.service.spec.ts .env
git commit -m "Rename EMAIL_DEBUG_MODE to DEBUG_MODE"
```

---

### Task 2: Backend — rename `/config`'s `emailDebugMode` to `debugMode`

**Files:**
- Modify: `api/src/app.controller.ts`
- Modify: `api/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `process.env.DEBUG_MODE` (Task 1).
- Produces: `GET /config` returns `{ debugMode: boolean, version: string }` — Tasks 3 and 4's frontend `/config` consumers depend on this exact field name.

- [ ] **Step 1: Update `app.controller.ts`**

Replace line 26:

```typescript
    return { debugMode: process.env.DEBUG_MODE === 'true', version };
```

- [ ] **Step 2: Update `app.e2e-spec.ts`**

Replace the `/config` test (lines 23-28):

```typescript
  it('/config (GET) reports debug mode', () => {
    return request(app.getHttpServer())
      .get('/config')
      .expect(200)
      .expect({ debugMode: process.env.DEBUG_MODE === 'true' });
  });
```

Note: this test already fails today for an unrelated, pre-existing reason — the actual response also includes a `version` field this assertion doesn't expect (confirmed pre-existing and out of scope in prior work on this codebase). Do not attempt to fix that; only make the rename shown above, preserving the exact same pre-existing failure mode.

- [ ] **Step 3: Run the e2e test**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json app.e2e-spec`
Expected: the `/health` test passes; the `/config` test fails only on the pre-existing `version` field mismatch (e.g. `expected { debugMode: true } response body, got { debugMode: true, version: '...' }`) — if it fails for any other reason (wrong field name, wrong value), that's a real regression, stop and investigate.

- [ ] **Step 4: Commit**

```bash
git add api/src/app.controller.ts api/test/app.e2e-spec.ts
git commit -m "Rename /config's emailDebugMode field to debugMode"
```

---

### Task 3: admin-web — rename `emailDebugMode` to `debugMode`

**Files:**
- Modify: `admin-web/src/api/config.ts`
- Modify: `admin-web/src/layout/AppFooter.tsx`
- Modify: `admin-web/src/layout/AppFooter.test.tsx`

**Interfaces:**
- Consumes: `GET /config` returning `{ debugMode, version }` (Task 2).

- [ ] **Step 1: Update the test file's mocked field name**

In `admin-web/src/layout/AppFooter.test.tsx`, replace every occurrence of `emailDebugMode` with `debugMode` in the mocked `getConfig` return values (4 occurrences, at lines 8, 18, 35, 43):

```typescript
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false, version: '9.9.9' });
```
(lines 8 and 18 and 43 use `debugMode: false`; line 35 uses `debugMode: true`)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec admin-web npx vitest run src/layout/AppFooter.test.tsx`
Expected: FAIL — the debug-warning tests fail because `AppConfig` still has `emailDebugMode`, not `debugMode`, so `config.emailDebugMode` reads `undefined`.

- [ ] **Step 3: Update `admin-web/src/api/config.ts`**

```typescript
import { apiClient } from './client';

export interface AppConfig {
  debugMode: boolean;
  version: string;
}

export function getConfig(): Promise<AppConfig> {
  return apiClient.request('/config');
}
```

- [ ] **Step 4: Update `admin-web/src/layout/AppFooter.tsx`**

Replace the full file:

```typescript
import { useEffect, useState } from 'react';
import { getConfig } from '../api/config';

// Fixed to the bottom of the viewport (not just appended after page content) so the debug
// warning stays visible even while scrolling, instead of being easy to scroll past — see
// PageContainer's bottom padding, which reserves space so this never covers page content.
export function AppFooter() {
  const [debugMode, setDebugMode] = useState(false);
  // null until /config responds — the API version isn't known at build time like the
  // client's own, so it's just left out of the label rather than shown as a placeholder.
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then((config) => {
        setDebugMode(config.debugMode);
        setApiVersion(config.version);
      })
      .catch(() => setDebugMode(false));
  }, []);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-3 py-1.5 text-xs text-text-muted">
      <span>
        v{__APP_VERSION__}
        {apiVersion && ` · API v${apiVersion}`}
      </span>
      {debugMode && (
        <span className="rounded bg-warning-bg px-2 py-0.5 font-semibold text-warning">
          Modo debug activo: los emails no se envían a los huéspedes reales.
        </span>
      )}
    </footer>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose exec admin-web npx vitest run src/layout/AppFooter.test.tsx`
Expected: PASS, all tests

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/api/config.ts admin-web/src/layout/AppFooter.tsx admin-web/src/layout/AppFooter.test.tsx
git commit -m "Rename admin-web's emailDebugMode to debugMode"
```

---

### Task 4: guest-web — rename `emailDebugMode` to `debugMode`

**Files:**
- Modify: `guest-web/src/api/config.ts`
- Modify: `guest-web/src/AppFooter.tsx`
- Modify: `guest-web/src/AppFooter.test.tsx`

**Interfaces:**
- Consumes: `GET /config` returning `{ debugMode }` (Task 2).
- Produces: `AppConfig.debugMode` — Task 12's `ConfirmationPage` will fetch this same config for the ambient-visibility eligibility check.

- [ ] **Step 1: Update the test file's mocked field name**

In `guest-web/src/AppFooter.test.tsx`, replace every occurrence of `emailDebugMode` with `debugMode` (3 occurrences, at lines 8, 17, 25):

```typescript
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
```
(lines 8 and 25 use `debugMode: false`; line 17 uses `debugMode: true`)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec guest-web npx vitest run src/AppFooter.test.tsx`
Expected: FAIL — same reason as Task 3.

- [ ] **Step 3: Update `guest-web/src/api/config.ts`**

```typescript
import { request } from './client';

export interface AppConfig {
  debugMode: boolean;
}

export function getConfig(): Promise<AppConfig> {
  return request('/config');
}
```

- [ ] **Step 4: Update `guest-web/src/AppFooter.tsx`**

Replace the full file:

```typescript
import { useEffect, useState } from 'react';
import { getConfig } from './api/config';

// VITE_COMMIT_HASH is passed as a Docker build arg from the server's own git checkout at
// deploy time (the guest-web Docker build context is scoped to ./guest-web, so .git isn't
// available inside the build to compute it directly — see guest-web/Dockerfile and
// .github/workflows/deploy.yml). Falls back to 'dev' for local development, where it's unset.
const COMMIT_HASH = (import.meta.env.VITE_COMMIT_HASH as string) || 'dev';

// Fixed to the bottom of the viewport, always visible, so staff can ask a guest what it says
// (or check a screenshot) to identify exactly which deployed build they're looking at —
// unlike admin-web's semver, this is a commit hash since guest-web isn't otherwise versioned.
export function AppFooter() {
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    getConfig()
      .then((config) => setDebugMode(config.debugMode))
      .catch(() => setDebugMode(false));
  }, []);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-3 py-1.5 text-xs text-text-muted">
      <span>{COMMIT_HASH}</span>
      {debugMode && (
        <span className="rounded bg-warning-bg px-2 py-0.5 font-semibold text-warning">
          Modo debug activo: los emails no se envían a los huéspedes reales.
        </span>
      )}
    </footer>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose exec guest-web npx vitest run src/AppFooter.test.tsx`
Expected: PASS, all tests

- [ ] **Step 6: Commit**

```bash
git add guest-web/src/api/config.ts guest-web/src/AppFooter.tsx guest-web/src/AppFooter.test.tsx
git commit -m "Rename guest-web's emailDebugMode to debugMode"
```

---

### Task 5: Backend — `PublicReservationsService.getAmbientReadings()` and its route

**Files:**
- Modify: `api/src/ambient/ambient.module.ts`
- Modify: `api/src/public-reservations/public-reservations.module.ts`
- Modify: `api/src/public-reservations/public-reservations.service.ts`
- Modify: `api/src/public-reservations/public-reservations.service.spec.ts`
- Modify: `api/src/public-reservations/public-reservations.controller.ts`

**Interfaces:**
- Consumes: `AmbientService.listDevices(): Promise<{ id, name, lastSeenAt, online, readings: { id, sensor, level, updatedAt }[] }[]>` (existing method, unchanged).
- Produces: `PublicReservationsService.getAmbientReadings(token: string)` and `GET /public/reservations/:token/ambient` — Task 6's e2e tests and Task 10's guest-web API client depend on this exact route path and response shape (identical to `AmbientService.listDevices()`'s return type).

- [ ] **Step 1: Export `AmbientService` from `AmbientModule`**

In `api/src/ambient/ambient.module.ts`, add an `exports` array to the `@Module({...})` decorator (it currently has none):

```typescript
@Module({
  imports: [NotificationsModule, ThrottlerModule.forRoot([{ name: 'ambient-alerts', ttl: 60_000, limit: 20 }])],
  controllers: [
    AmbientAlertReportController,
    AmbientAlertsController,
    AmbientHeartbeatReportController,
    AmbientDevicesController,
  ],
  providers: [AmbientService, AmbientOfflineSchedulerService],
  exports: [AmbientService],
})
export class AmbientModule {}
```

- [ ] **Step 2: Import `AmbientModule` into `PublicReservationsModule`**

Replace `api/src/public-reservations/public-reservations.module.ts` in full:

```typescript
import { Module } from '@nestjs/common';
import { PublicReservationsController } from './public-reservations.controller';
import { PublicReservationsService } from './public-reservations.service';
import { SettingsModule } from '../settings/settings.module';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';
import { GuestsModule } from '../guests/guests.module';
import { ReservationImagesModule } from '../reservation-images/reservation-images.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AmbientModule } from '../ambient/ambient.module';

@Module({
  imports: [
    SettingsModule,
    ReservationConfirmationModule,
    GuestsModule,
    ReservationImagesModule,
    NotificationsModule,
    AmbientModule,
  ],
  controllers: [PublicReservationsController],
  providers: [PublicReservationsService],
})
export class PublicReservationsModule {}
```

- [ ] **Step 3: Write the failing unit tests**

In `api/src/public-reservations/public-reservations.service.spec.ts`, add the import:

```typescript
import { AmbientService } from '../ambient/ambient.service';
```

And add `ForbiddenException` to the existing `@nestjs/common` import line, so it reads:

```typescript
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
```

Add `ambientService` to the `let` declarations, after `notificationsService`:

```typescript
  let ambientService: { listDevices: jest.Mock };
```

In the `beforeEach`, add after `notificationsService = { create: jest.fn() };`:

```typescript
    ambientService = { listDevices: jest.fn() };
```

And add its provider to the `Test.createTestingModule` call's `providers` array, after the `NotificationsService` entry:

```typescript
        { provide: AmbientService, useValue: ambientService },
```

Add this new `describe` block at the end of the file, just before the final closing `});` of the outer `describe('PublicReservationsService', ...)`:

```typescript
  describe('getAmbientReadings', () => {
    const originalDebugMode = process.env.DEBUG_MODE;

    afterEach(() => {
      process.env.DEBUG_MODE = originalDebugMode;
    });

    it('throws NotFoundException for an unknown token', async () => {
      process.env.DEBUG_MODE = 'false';
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(service.getAmbientReadings('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns device readings when fully confirmed and currently within the stay dates', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: yesterday,
        checkOut: tomorrow,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });
      ambientService.listDevices.mockResolvedValue([{ id: 'dev-1', name: 'Living room', readings: [] }]);

      const result = await service.getAmbientReadings('tok-1');

      expect(result).toEqual([{ id: 'dev-1', name: 'Living room', readings: [] }]);
    });

    it('throws ForbiddenException when fully confirmed but before check-in', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const farFuture = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: future,
        checkOut: farFuture,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });

      await expect(service.getAmbientReadings('tok-1')).rejects.toThrow(ForbiddenException);
      expect(ambientService.listDevices).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when fully confirmed but after check-out', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const past1 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const past2 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: past1,
        checkOut: past2,
        confirmationPaymentReceivedAt: new Date('2026-01-01'),
        depositReceivedAt: new Date('2026-01-01'),
      });

      await expect(service.getAmbientReadings('tok-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when currently within stay dates but not fully confirmed', async () => {
      process.env.DEBUG_MODE = 'false';
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: yesterday,
        checkOut: tomorrow,
        confirmationPaymentReceivedAt: null,
        depositReceivedAt: null,
      });

      await expect(service.getAmbientReadings('tok-1')).rejects.toThrow(ForbiddenException);
    });

    it('returns device readings regardless of confirmation/dates when DEBUG_MODE is on', async () => {
      process.env.DEBUG_MODE = 'true';
      prisma.reservation.findUnique.mockResolvedValue({
        ...baseReservation,
        checkIn: new Date('2020-01-01'),
        checkOut: new Date('2020-01-05'),
        confirmationPaymentReceivedAt: null,
        depositReceivedAt: null,
      });
      ambientService.listDevices.mockResolvedValue([{ id: 'dev-1', name: 'Living room', readings: [] }]);

      const result = await service.getAmbientReadings('tok-1');

      expect(result).toEqual([{ id: 'dev-1', name: 'Living room', readings: [] }]);
    });
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `docker compose exec api npx jest public-reservations.service`
Expected: FAIL — `service.getAmbientReadings is not a function`

- [ ] **Step 5: Implement `getAmbientReadings` in the service**

In `api/src/public-reservations/public-reservations.service.ts`, update the `@nestjs/common` import at the top to include `ForbiddenException`:

```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

Add the `AmbientService` import, after the `NotificationsService` import:

```typescript
import { AmbientService } from '../ambient/ambient.service';
```

Add `ambientService` to the constructor, after `notificationsService`:

```typescript
    private readonly notificationsService: NotificationsService,
    private readonly ambientService: AmbientService,
  ) {}
```

Add this new method at the end of the class, after `getImageFile`:

```typescript
  // A guest sees the property's current ambient sensor readings only once they're fully
  // confirmed (both the reservation payment and the security deposit received) and only while
  // their stay is actually happening (now falls within checkIn..checkOut) — or, in a debug
  // environment, always, so this is easy to test without waiting for a real reservation
  // window. This is a real, server-side gate: whether a client renders the section is a UX
  // nicety, not the security boundary.
  async getAmbientReadings(token: string) {
    const reservation = await this.findByToken(token);

    const isDebugMode = process.env.DEBUG_MODE === 'true';
    const isFullyConfirmed = reservation.confirmationPaymentReceivedAt != null && reservation.depositReceivedAt != null;
    const now = new Date();
    const isDuringStay = now >= reservation.checkIn && now <= reservation.checkOut;

    if (!isDebugMode && !(isFullyConfirmed && isDuringStay)) {
      throw new ForbiddenException('Ambient sensor data is not available for this reservation right now');
    }

    return this.ambientService.listDevices();
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose exec api npx jest public-reservations.service`
Expected: PASS, all tests

- [ ] **Step 7: Add the route**

In `api/src/public-reservations/public-reservations.controller.ts`, add this method to the `PublicReservationsController` class, right after `getByToken`:

```typescript
  @Get(':token/ambient')
  getAmbientReadings(@Param('token') token: string) {
    return this.service.getAmbientReadings(token);
  }
```

- [ ] **Step 8: Verify the app compiles**

Run: `docker compose exec api npx tsc --noEmit`
Expected: no output

- [ ] **Step 9: Commit**

```bash
git add api/src/ambient/ambient.module.ts api/src/public-reservations/public-reservations.module.ts api/src/public-reservations/public-reservations.service.ts api/src/public-reservations/public-reservations.service.spec.ts api/src/public-reservations/public-reservations.controller.ts
git commit -m "Add GET /public/reservations/:token/ambient with confirmation/date gating"
```

---

### Task 6: Backend e2e tests

**Files:**
- Modify: `api/test/public-reservations.e2e-spec.ts`

**Interfaces:**
- Consumes: `GET /public/reservations/:token/ambient` (Task 5).

- [ ] **Step 1: Add the new describe block**

In `api/test/public-reservations.e2e-spec.ts`, add this block as a new sibling to the existing `describe('receipt images', ...)` block, just before the outer `describe`'s closing `});`:

```typescript
  describe('GET /public/reservations/:token/ambient', () => {
    const originalDebugMode = process.env.DEBUG_MODE;
    const AMBIENT_DEVICE_ID = 'e2e-public-ambient-device';

    beforeEach(() => {
      process.env.DEBUG_MODE = 'false';
    });

    afterEach(async () => {
      process.env.DEBUG_MODE = originalDebugMode;
      await prisma.ambientDeviceReading.deleteMany({ where: { deviceId: AMBIENT_DEVICE_ID } });
      await prisma.ambientDevice.deleteMany({ where: { id: AMBIENT_DEVICE_ID } });
    });

    it('returns 404 for an unknown token', async () => {
      await request(app.getHttpServer())
        .get('/public/reservations/does-not-exist/ambient')
        .expect(404);
    });

    it('returns 403 for a reservation that is not fully confirmed, even during its stay dates', async () => {
      const now = new Date();
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        },
      });

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(403);
    });

    it('returns 403 for a fully-confirmed reservation outside its stay dates', async () => {
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date('2020-01-01'),
          checkOut: new Date('2020-01-05'),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
          confirmationPaymentReceivedAt: new Date(),
          depositReceivedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(403);
    });

    it('returns current device readings for a fully-confirmed reservation during its stay', async () => {
      const now = new Date();
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
          confirmationPaymentReceivedAt: now,
          depositReceivedAt: now,
        },
      });
      await prisma.ambientDevice.create({
        data: { id: AMBIENT_DEVICE_ID, name: 'E2E Living Room', lastSeenAt: now },
      });
      await prisma.ambientDeviceReading.create({
        data: { deviceId: AMBIENT_DEVICE_ID, sensor: 'temperature', level: 23 },
      });

      const response = await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(200);

      const device = response.body.find((d: { id: string }) => d.id === AMBIENT_DEVICE_ID);
      expect(device).toBeTruthy();
      expect(device.readings).toEqual(
        expect.arrayContaining([expect.objectContaining({ sensor: 'temperature', level: 23 })]),
      );
    });

    it('returns current device readings regardless of confirmation/dates when DEBUG_MODE is on', async () => {
      process.env.DEBUG_MODE = 'true';
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date('2020-01-01'),
          checkOut: new Date('2020-01-05'),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        },
      });

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(200);
    });
  });
```

Note: the reservations created above are cleaned up by this file's existing top-level `afterAll`, which already deletes every reservation named `'Public E2E Guest'` — no additional reservation cleanup is needed here, only the `AmbientDevice`/`AmbientDeviceReading` fixture rows, handled by this block's own `afterEach`.

- [ ] **Step 2: Run the e2e tests**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json public-reservations.e2e-spec`
Expected: PASS, all tests

- [ ] **Step 3: Run the full e2e suite**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json`
Expected: PASS except the pre-existing, unrelated `app.e2e-spec.ts` `version`-field failures (see Task 2's note) — do not attempt to fix those here.

- [ ] **Step 4: Commit**

```bash
git add api/test/public-reservations.e2e-spec.ts
git commit -m "Add e2e coverage for GET /public/reservations/:token/ambient"
```

---

### Task 7: admin-web — add `co` and `humidity` sensor labels

**Files:**
- Modify: `admin-web/src/lib/labels.ts`
- Modify: `admin-web/src/lib/labels.test.ts`

**Interfaces:**
- Produces: `ambientSensorLabel('co')` and `ambientSensorLabel('humidity')` now return real Spanish labels instead of falling back to the raw string.

- [ ] **Step 1: Write the failing test**

In `admin-web/src/lib/labels.test.ts`, update the import line at the top (currently `import { sourceLabel, statusLabel, statusBadgeTone, eventTypeLabel, recipientStatusLabel } from './labels';`) to add `ambientSensorLabel`:

```typescript
import { sourceLabel, statusLabel, statusBadgeTone, eventTypeLabel, recipientStatusLabel, ambientSensorLabel } from './labels';
```

Add this new `describe` block anywhere in the file (e.g. at the end):

```typescript
describe('ambientSensorLabel', () => {
  it('translates each known ambient sensor type to Spanish', () => {
    expect(ambientSensorLabel('sound')).toBe('Sonido');
    expect(ambientSensorLabel('smoke')).toBe('Humo');
    expect(ambientSensorLabel('temperature')).toBe('Temperatura');
    expect(ambientSensorLabel('co')).toBe('Monóxido de carbono');
    expect(ambientSensorLabel('humidity')).toBe('Humedad');
  });

  it('falls back to the raw sensor string for an unknown type', () => {
    expect(ambientSensorLabel('vibration')).toBe('vibration');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec admin-web npx vitest run src/lib/labels.test.ts`
Expected: FAIL — `ambientSensorLabel('co')` returns `'co'`, not `'Monóxido de carbono'` (and `humidity` similarly)

- [ ] **Step 3: Update `admin-web/src/lib/labels.ts`**

Find the existing `AMBIENT_SENSOR_LABELS` map and replace it:

```typescript
const AMBIENT_SENSOR_LABELS: Record<string, string> = {
  sound: 'Sonido',
  smoke: 'Humo',
  temperature: 'Temperatura',
  co: 'Monóxido de carbono',
  humidity: 'Humedad',
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose exec admin-web npx vitest run src/lib/labels.test.ts`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/lib/labels.ts admin-web/src/lib/labels.test.ts
git commit -m "Add co and humidity labels to ambientSensorLabel"
```

---

### Task 8: guest-web — new `getAmbientReadings` API client

**Files:**
- Create: `guest-web/src/api/ambient.ts`

**Interfaces:**
- Consumes: `GET /public/reservations/:token/ambient` (Task 5).
- Produces: `getAmbientReadings(token: string): Promise<AmbientDeviceEntry[]>`, `AmbientDeviceEntry`, `AmbientDeviceReadingEntry` — Tasks 9 and 12 import these exact names.

- [ ] **Step 1: Create the file**

```typescript
import { request } from './client';

export interface AmbientDeviceReadingEntry {
  id: string;
  sensor: string;
  level: number;
  updatedAt: string;
}

export interface AmbientDeviceEntry {
  id: string;
  name: string;
  lastSeenAt: string | null;
  online: boolean;
  readings: AmbientDeviceReadingEntry[];
}

export function getAmbientReadings(token: string): Promise<AmbientDeviceEntry[]> {
  return request(`/public/reservations/${token}/ambient`);
}
```

- [ ] **Step 2: Typecheck**

Run: `docker compose exec guest-web npx tsc -b`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add guest-web/src/api/ambient.ts
git commit -m "Add getAmbientReadings API client"
```

---

### Task 9: guest-web — new `AmbientStatus` component

**Files:**
- Create: `guest-web/src/confirmation/AmbientStatus.tsx`
- Create: `guest-web/src/confirmation/AmbientStatus.test.tsx`

**Interfaces:**
- Consumes: `getAmbientReadings(token)`, `AmbientDeviceEntry` (Task 8).
- Produces: `AmbientStatus` component, prop `{ token: string }` — Task 12 imports and renders it.

- [ ] **Step 1: Write the failing tests**

Create `guest-web/src/confirmation/AmbientStatus.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmbientStatus } from './AmbientStatus';
import * as ambientApi from '../api/ambient';

describe('AmbientStatus', () => {
  it('renders each device with its readings, labeled in Spanish', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [
          { id: 'r-1', sensor: 'temperature', level: 23, updatedAt: '2026-09-27T12:00:00.000Z' },
          { id: 'r-2', sensor: 'humidity', level: 45, updatedAt: '2026-09-27T12:00:00.000Z' },
        ],
      },
    ]);

    render(<AmbientStatus token="tok-1" />);

    expect(await screen.findByText('Living room')).toBeInTheDocument();
    expect(screen.getByText(/Temperatura: 23/)).toBeInTheDocument();
    expect(screen.getByText(/Humedad: 45/)).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
  });

  it('renders nothing on a fetch failure', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockRejectedValue(new Error('forbidden'));

    const { container } = render(<AmbientStatus token="tok-1" />);

    await waitFor(() => expect(ambientApi.getAmbientReadings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no devices', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([]);

    const { container } = render(<AmbientStatus token="tok-1" />);

    await waitFor(() => expect(ambientApi.getAmbientReadings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec guest-web npx vitest run src/confirmation/AmbientStatus.test.tsx`
Expected: FAIL — `Cannot find module './AmbientStatus'`

- [ ] **Step 3: Create the component**

```typescript
import { useEffect, useState } from 'react';
import { getAmbientReadings, AmbientDeviceEntry } from '../api/ambient';
import { Badge } from '../ui';
import { formatDateTime } from '../lib/date';

// guest-web-local, deliberately not imported from admin-web's lib/labels.ts —
// this codebase's convention is per-app duplication of small UI bits, not a shared package.
const AMBIENT_SENSOR_LABELS: Record<string, string> = {
  sound: 'Sonido',
  co: 'Monóxido de carbono',
  smoke: 'Humo',
  temperature: 'Temperatura',
  humidity: 'Humedad',
};

function ambientSensorLabel(sensor: string): string {
  return AMBIENT_SENSOR_LABELS[sensor] ?? sensor;
}

// Supplementary information on a page whose primary job is the check-in wizard — a failed
// fetch (e.g. the eligibility gate rejecting a request the caller thought was eligible) hides
// this section entirely rather than showing an alert that would compete with the wizard's own.
export function AmbientStatus({ token }: { token: string }) {
  const [devices, setDevices] = useState<AmbientDeviceEntry[] | null>(null);

  useEffect(() => {
    getAmbientReadings(token)
      .then(setDevices)
      .catch(() => setDevices(null));
  }, [token]);

  if (!devices || devices.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mt-4 max-w-md rounded-xl bg-surface p-4 shadow-sm">
      <h3 className="font-heading text-sm font-semibold text-heading">Estado del alojamiento</h3>
      <div className="mt-3 flex flex-col gap-3">
        {devices.map((device) => (
          <div key={device.id}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-heading">{device.name || device.id}</p>
              <Badge tone={device.online ? 'success' : 'danger'}>{device.online ? 'En línea' : 'Sin conexión'}</Badge>
            </div>
            {device.lastSeenAt && (
              <p className="text-xs text-text-muted">Última conexión: {formatDateTime(device.lastSeenAt)}</p>
            )}
            {device.readings.length > 0 && (
              <p className="mt-1 text-sm text-text">
                {device.readings.map((reading) => `${ambientSensorLabel(reading.sensor)}: ${reading.level}`).join(' · ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec guest-web npx vitest run src/confirmation/AmbientStatus.test.tsx`
Expected: PASS, 3 tests

- [ ] **Step 5: Typecheck**

Run: `docker compose exec guest-web npx tsc -b`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add guest-web/src/confirmation/AmbientStatus.tsx guest-web/src/confirmation/AmbientStatus.test.tsx
git commit -m "Add AmbientStatus component"
```

---

### Task 10: guest-web — wire `AmbientStatus` into `ConfirmationPage`

**Files:**
- Modify: `guest-web/src/confirmation/ConfirmationPage.tsx`
- Modify: `guest-web/src/confirmation/ConfirmationPage.test.tsx`

**Interfaces:**
- Consumes: `getConfig()` (Task 4), `AmbientStatus` (Task 9).

- [ ] **Step 1: Write the failing tests**

In `guest-web/src/confirmation/ConfirmationPage.test.tsx`, add these imports alongside the existing ones at the top of the file:

```typescript
import * as configApi from '../api/config';
import * as ambientApi from '../api/ambient';
```

Add these three tests at the end of the `describe('ConfirmationPage', ...)` block, just before its closing `});`:

```typescript
  it('shows ambient sensor status once fully confirmed and during the stay dates', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      checkIn: yesterday,
      checkOut: tomorrow,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      { id: 'dev-1', name: 'Living room', online: true, lastSeenAt: now.toISOString(), readings: [] },
    ]);

    renderAt('tok-1');

    expect(await screen.findByText('Living room')).toBeInTheDocument();
  });

  it('does not show ambient sensor status outside the stay dates, even when fully confirmed', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: '2026-01-02T00:00:00.000Z',
      depositReceivedAt: '2026-01-02T00:00:00.000Z',
    });
    const getAmbientReadings = vi.spyOn(ambientApi, 'getAmbientReadings');

    renderAt('tok-1');

    await screen.findByText(/pago confirmado/i);
    expect(getAmbientReadings).not.toHaveBeenCalled();
  });

  it('shows ambient sensor status regardless of confirmation or dates when debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({ ...baseReservation });
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      { id: 'dev-1', name: 'Living room', online: true, lastSeenAt: null, readings: [] },
    ]);

    renderAt('tok-1');

    expect(await screen.findByText('Living room')).toBeInTheDocument();
  });

  it('does not show ambient sensor status during the stay dates when not yet fully confirmed', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false });
    vi.spyOn(publicApi, 'getReservationByToken').mockResolvedValue({
      ...baseReservation,
      checkIn: yesterday,
      checkOut: tomorrow,
      // Dates confirmed and contract accepted, but payment/deposit still pending — this
      // reservation is "in range" but not "fully confirmed", the other half of the AND from
      // the previous test (which was fully confirmed but out of range).
      datesConfirmedAt: '2026-01-01T00:00:00.000Z',
      contractAcceptedAt: '2026-01-01T00:00:00.000Z',
      confirmationPaymentReceivedAt: null,
      depositReceivedAt: null,
    });
    const getAmbientReadings = vi.spyOn(ambientApi, 'getAmbientReadings');

    renderAt('tok-1');

    await screen.findByText(/pago y garantía/i);
    expect(getAmbientReadings).not.toHaveBeenCalled();
  });
```

The "outside the stay dates" test above relies on `baseReservation`'s fixed `checkIn: '2026-03-01'` / `checkOut: '2026-03-05'` already being in the past relative to any real test run from this point forward — no change to `baseReservation` itself is needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx`
Expected: the 4 new tests FAIL — `ConfirmationPage` doesn't call `getConfig`/`getAmbientReadings` or render `AmbientStatus` yet, so `getAmbientReadings` is never called (the "not called" assertions in tests 2 and 4 would actually pass vacuously, but tests 1 and 3 fail on "Living room" never appearing).

- [ ] **Step 3: Wire it into `ConfirmationPage.tsx`**

Add these two imports alongside the existing ones at the top of the file:

```typescript
import { getConfig } from '../api/config';
import { AmbientStatus } from './AmbientStatus';
```

Add a `debugMode` state and its fetch effect, alongside the existing state declarations and `useEffect` calls (after the `viewerImageId` state declaration and before the `stepHeadingRef` ref):

```typescript
  const [debugMode, setDebugMode] = useState(false);
```

Add this new `useEffect`, alongside the existing `useEffect(() => { load(); loadImages(); }, [token]);`:

```typescript
  useEffect(() => {
    getConfig()
      .then((config) => setDebugMode(config.debugMode))
      .catch(() => setDebugMode(false));
  }, []);
```

Find this line (after the `if (!reservation) return ...` guard):

```typescript
  const step = currentStep(reservation);
```

Add these three lines right after it:

```typescript
  const isFullyConfirmed = Boolean(reservation.confirmationPaymentReceivedAt) && Boolean(reservation.depositReceivedAt);
  const now = new Date();
  const isDuringStay = now >= new Date(reservation.checkIn) && now <= new Date(reservation.checkOut);
  const showAmbient = debugMode || (isFullyConfirmed && isDuringStay);
```

Find the closing of the wizard card and the `PageShell`'s closing tag:

```typescript
      </div>
    </PageShell>
  );
}
```

Replace it with:

```typescript
      </div>
      {showAmbient && <AmbientStatus token={token!} />}
    </PageShell>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec guest-web npx vitest run src/confirmation/ConfirmationPage.test.tsx`
Expected: PASS, all tests (existing + 4 new)

- [ ] **Step 5: Run the full guest-web suite and typecheck**

Run: `docker compose exec guest-web npx vitest run`
Expected: PASS, every test file — in particular, confirm no existing test in the suite broke from the new unmocked `getConfig()` call (it should fail silently via the `.catch()`, leaving `debugMode` false, since `baseReservation`'s fixed past dates keep `showAmbient` false regardless)

Run: `docker compose exec guest-web npx tsc -b`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add guest-web/src/confirmation/ConfirmationPage.tsx guest-web/src/confirmation/ConfirmationPage.test.tsx
git commit -m "Show ambient sensor status on the check-in page once eligible"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `docker compose exec api npx jest`
Expected: PASS, every test file

- [ ] **Step 2: Run the full backend e2e suite**

Run: `docker compose exec api npx jest --config ./test/jest-e2e.json`
Expected: PASS except the pre-existing, unrelated `app.e2e-spec.ts` `version`-field failures (Task 2)

- [ ] **Step 3: Run the full admin-web suite, typecheck, and lint**

Run: `docker compose exec admin-web npx vitest run`
Expected: PASS, every test file

Run: `docker compose exec admin-web npx tsc -b`
Expected: no output

Run: `docker compose exec admin-web npx oxlint`
Expected: 0 errors

- [ ] **Step 4: Run the full guest-web suite and typecheck**

Run: `docker compose exec guest-web npx vitest run`
Expected: PASS, every test file

Run: `docker compose exec guest-web npx tsc -b`
Expected: no output

- [ ] **Step 5: Grep for any remaining old names**

Run: `grep -rn "EMAIL_DEBUG_MODE\|emailDebugMode" api/src api/test admin-web/src guest-web/src`
Expected: no output (every occurrence renamed across Tasks 1-4) — `EMAIL_DEBUG_RECIPIENT` is expected to still appear (it's unchanged, still email-specific) and is not a failure here.
