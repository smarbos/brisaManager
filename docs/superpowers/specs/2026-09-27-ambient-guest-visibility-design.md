# Design: Guest-Facing Ambient Sensor Visibility

Status: Approved
Date: 2026-09-27

## Purpose

The ambient-control system (ESP32 devices reading sound, CO, smoke, temperature, and humidity) currently only surfaces its data to staff, via the admin-web "Sensores" page (`GET /ambient-devices`, JWT-guarded). This adds a guest-facing view of the same current readings on guest-web's check-in page, so a guest staying at the property can see live conditions (e.g. current temperature) during their actual stay — without exposing that data to anyone holding a confirmation token before their stay begins, after it ends, or before they've actually completed check-in.

## Scope

- **Single property, no per-reservation device mapping.** `ambient-control` devices aren't tied to a specific reservation or unit anywhere in the current data model — they're just named devices ("Living room") belonging to the one property this system runs for. A guest who is eligible to see sensor data sees *all* devices' current readings, the same set staff already sees on Sensores. This design does not add per-unit scoping; if this property ever becomes multi-unit with guest-specific sensors, that's a separate, later design.
- **Read-only, current-state only.** This exposes the same live snapshot `AmbientService.listDevices()` already computes for staff (each device's last-seen time, online status, and latest reading per sensor). It does not expose the historical event log (`AmbientEvent`/`GET /ambient-events`) — that stays staff-only.
- **All five sensor types, raw values, no interpretation.** Sound/CO/smoke are uncalibrated ADC readings with no real-world unit, and the backend has no concept of what threshold makes any of them "elevated" (those thresholds live only in each device's firmware/flash, never synced to the server). This design does not add threshold syncing or a "normal/elevated" classification — it shows every sensor's raw current value, the same numbers staff already see, labeled with the same Spanish names already used on Sensores (`ambientSensorLabel` in admin-web, mirrored as a small guest-web-local map per this codebase's established per-app label-duplication convention — no shared package).
- **Debug mode is a visibility override, not a new authorization mechanism.** It's the existing environment-level "this is a dev/test environment" flag (see below), not a per-guest or per-token setting.

## Debug mode generalization

`EMAIL_DEBUG_MODE` currently means one specific thing (redirect all outbound email to a debug recipient instead of sending it for real). This design generalizes it into a single `DEBUG_MODE` flag meaning "this is a dev/test environment," reused for both its existing email-redirect behavior and the new "always show ambient sensor data regardless of confirmation/date gating" behavior — one flag for one underlying concept, rather than two flags that would always be set identically in practice (local dev: on; production: off).

**Renamed, not duplicated:**
- `.env`: `EMAIL_DEBUG_MODE` → `DEBUG_MODE` (both the active local-dev line and the commented-out production-reference line at the bottom of the file).
- `api/src/email/email.service.ts`: reads `process.env.DEBUG_MODE` instead of `process.env.EMAIL_DEBUG_MODE`. `EMAIL_DEBUG_RECIPIENT` is unchanged — still email-specific, still required alongside `DEBUG_MODE` for the redirect to actually happen (a debug environment might one day want ambient-debug behavior without also wanting to intercept email, but that's not a case this design needs to support now — if it comes up, DEBUG_MODE can be split again later; YAGNI for today).
- `api/src/app.controller.ts`'s `GET /config`: response field renamed `emailDebugMode` → `debugMode`.
- `admin-web`/`guest-web` `AppFooter.tsx` and their `api/config.ts` types: consume `debugMode` instead of `emailDebugMode`. The footer's existing debug banner text and behavior are otherwise unchanged.
- Any test asserting on `EMAIL_DEBUG_MODE`/`emailDebugMode` (at minimum `app.e2e-spec.ts`'s `/config` test) updates to the new name.

**Operational note, not code:** this is a production environment variable rename. Production's `.env` (outside this repo, on the deploy droplet) needs `EMAIL_DEBUG_MODE` renamed to `DEBUG_MODE` at or before deploy time — until that's done, `DEBUG_MODE` reads as unset (`false`) in production, which is the same *effective* behavior production has today (the flag is off there either way), so there's no behavior change risk from deploying before the rename, only a reminder needed so the rename actually happens.

## Backend: new public endpoint

`GET /public/reservations/:token/ambient` on the existing `PublicReservationsController`, unauthenticated and token-scoped — same shape as the controller's existing `GET :token`.

**Service method** (`PublicReservationsService`, new method `getAmbientReadings(token)`):
1. Look up the reservation by `confirmationToken` (same lookup `getByToken` already does). Not found → 404, consistent with every other token-scoped route on this controller.
2. Compute eligibility:
   ```
   eligible = DEBUG_MODE
     || (reservation.confirmationPaymentReceivedAt != null
         && reservation.depositReceivedAt != null
         && now >= reservation.checkIn
         && now <= reservation.checkOut)
   ```
   "Fully confirmed" is defined as both payment timestamps set (the same condition `ConfirmationPage`'s `currentStep()` already uses to reach step 4) — not merely `contractAcceptedAt` (step 2). "Between the dates" is inclusive of both the check-in and check-out day.
3. Not eligible → 403 (this is a deliberate, enforced-server-side gate; the frontend computing the same condition to decide whether to render the section is a UX nicety, not the actual security boundary — a guest who somehow requested this route directly outside their stay window, or before fully confirming, gets rejected here regardless of what the UI shows).
4. Eligible → delegate to the existing `AmbientService.listDevices()` and return its result unchanged. No new device/reading logic — this reuses exactly what staff already see.

**No DTO/schema changes.** This route takes no body and returns the same shape `GET /ambient-devices` already returns.

## Frontend: guest-web

**New API client function**, alongside the existing ones in `guest-web/src/api/publicReservations.ts`:
```typescript
export function getAmbientReadings(token: string): Promise<AmbientDeviceEntry[]> {
  return request(`/public/reservations/${token}/ambient`);
}
```
(`AmbientDeviceEntry` — a new local type in guest-web mirroring admin-web's shape: `{ id, name, online, lastSeenAt, readings: { sensor, level }[] }`.)

**New component**, `guest-web/src/confirmation/AmbientStatus.tsx` (or under a shared `guest-web/src/ambient/` directory if it grows a second file — single file is enough for this scope): self-contained, mirrors admin-web's `SensorsPage` reading-list rendering (device name, online/offline badge, last-seen time, each reading labeled via a small local `ambientSensorLabel`-equivalent map covering all five known sensor types). Fetches on mount via the new API client function; a fetch failure hides the section entirely (this is supplementary information on a page whose primary job is the check-in wizard — a failed fetch here shouldn't show an alert or otherwise compete with the wizard's own error handling).

**Wiring into `ConfirmationPage`:** the page already loads `reservation` (via `getReservationByToken`) and already needs `debugMode` (fetched the same way `AppFooter` already does, from `GET /config`). Eligibility is computed the same way as the backend:
```typescript
const isFullyConfirmed = reservation.confirmationPaymentReceivedAt != null && reservation.depositReceivedAt != null;
const now = new Date();
const isDuringStay = now >= new Date(reservation.checkIn) && now <= new Date(reservation.checkOut);
const showAmbient = debugMode || (isFullyConfirmed && isDuringStay);
```
`<AmbientStatus token={token} />` renders as an independent section (not nested inside `{step === 4 && (...)}`) whenever `showAmbient` is true — so with `DEBUG_MODE` on, it's visible from step 1 onward for easy local testing, exactly as requested. `GuestReservation` (guest-web's existing reservation type) needs no new fields — `confirmationPaymentReceivedAt`/`depositReceivedAt`/`checkIn`/`checkOut` are already present on it.

## Companion fix: admin-web sensor labels

`admin-web/src/lib/labels.ts`'s existing `AMBIENT_SENSOR_LABELS` map has `sound`, `smoke`, and `temperature` already, but is missing `co` (added by the MQ-7 firmware work) and `humidity` (added by the DHT22 firmware work, not yet implemented as of this spec). Both get added as part of this feature's implementation, since the guest-facing display's "all five sensors" requirement means every sensor type needs a real label everywhere it's shown, not just a fallback to its raw string.

## Testing

- **Backend unit** (`public-reservations.service.spec.ts`): eligibility computed correctly for each branch — debug-mode-on regardless of confirmation/dates; fully-confirmed-and-in-range; fully-confirmed-but-before-checkIn (ineligible); fully-confirmed-but-after-checkOut (ineligible); in-range-but-not-fully-confirmed (ineligible); unknown token (404).
- **Backend e2e**: a real reservation seeded fully-confirmed with dates spanning "now" gets a 200 from the new route with device data; the same reservation with dates outside "now" gets 403; an unconfirmed reservation gets 403 even with in-range dates; `DEBUG_MODE=true` overrides an otherwise-ineligible reservation to 200 (this last one needs the e2e test to read `process.env.DEBUG_MODE` the same way the service does, or the test suite's own env already has it set one way or the other — exact mechanics decided at plan time).
- **Frontend**: `AmbientStatus.test.tsx` — renders devices/readings from a mocked fetch, hides on fetch failure. `ConfirmationPage.test.tsx` — new tests for each eligibility branch (debug on, fully-confirmed-in-range, not-yet-confirmed, out-of-range), asserting the section is present/absent accordingly, without disturbing the page's existing step-based tests.
- **Rename verification**: existing `app.e2e-spec.ts` `/config` test updated to assert `debugMode` instead of `emailDebugMode`; existing `email.service.spec.ts` tests (if any reference the env var name directly) updated to set `DEBUG_MODE` instead of `EMAIL_DEBUG_MODE`.
