# Design: Channel Integrations (Sub-project 3)

Status: Approved
Date: 2026-09-13

## Purpose

Third sub-project for the La Brisa de Mar del Plata reservation manager (see `TODO.md`), building on sub-projects 1 (core reservation management) and 2 (guest onboarding workflow). Delivers automatic syncing of bookings from Booking.com and Airbnb into the app via their public iCal calendar feeds, so all reservations across every channel are visible in one place and double-booking risk is reduced.

## Key constraint driving this design

Booking.com's and Airbnb's full reservation APIs are restricted to approved software partners — a formal partnership process not available to a regular host account. What every host account *does* have is a per-listing iCal export URL. This design uses that: it syncs **blocked date ranges only**. iCal feeds from both platforms do not include guest name, contact info, pax count, or price — only that a date range is booked. Guest onboarding (deposit, digital contract from sub-project 2) still applies to Booking.com/Airbnb-sourced reservations, per an explicit decision below; staff manually add the real guest contact info before the onboarding link is useful.

## Data model additions

**Settings** (existing singleton, extended):

| Field | Type | Notes |
|---|---|---|
| `bookingIcalUrl` | string, nullable | Booking.com's exported iCal URL for this listing |
| `airbnbIcalUrl` | string, nullable | Airbnb's exported iCal URL for this listing |
| `lastChannelSyncAt` | datetime, nullable | Set on every sync attempt (success or failure) |
| `lastChannelSyncError` | text, nullable | Set on failure, cleared on the next successful sync |

**Reservation** (existing, extended):

| Field | Type | Notes |
|---|---|---|
| `missingFromChannelAt` | datetime, nullable | Set when a previously-synced booking's UID disappears from its feed; cleared automatically if it reappears in a later sync |

`externalReference` (already existing from sub-project 1) is reused to store the iCal event's UID for BOOKING/AIRBNB-sourced reservations — this is what lets repeated syncs recognize "this is the same booking" rather than creating duplicates.

## Sync logic

Runs independently per platform (Booking.com and Airbnb), so a broken feed on one never blocks the other:

1. Skip that platform entirely if its iCal URL isn't set in `Settings`.
2. Fetch and parse the `.ics` feed (`node-ical` npm package).
3. For each calendar event (keyed by UID):
   - If a `Reservation` already exists with that `source` (`BOOKING`/`AIRBNB`) and `externalReference` = UID: clear `missingFromChannelAt` if it was set (the booking reappeared). Never touch guest details, dates, or status on an existing record — a sync only creates or un-flags, it never overwrites what staff have already entered.
   - If no match exists: create a new `Reservation` with `status: PENDING`, `source` set to the platform, `externalReference` = UID, `checkIn`/`checkOut` from the event, a placeholder `guestName` ("Booking.com Guest" / "Airbnb Guest"), `paxCount: 1` (unknown, staff corrects it), `totalAmount: 0`, `currency: "ARS"`, and a `notes` value explaining it was auto-created and needs guest contact info filled in. **This write goes directly through Prisma, not through `ReservationsService.create()`/`CreateReservationDto`** — the DTO's `@IsPositive()` on `totalAmount` would reject the placeholder `0` value, and routing an internal sync through an HTTP-facing validated DTO layer is the wrong boundary anyway. The sync service owns its own Prisma writes.
4. After processing all current-feed UIDs: any existing `Reservation` for that platform (has a non-null `externalReference`, correct `source`) whose UID is NOT in the current feed gets `missingFromChannelAt` set to now, *only if the fetch succeeded* — a failed fetch must never flag anything as missing (a network hiccup returning an empty/error response must not look identical to "guest cancelled").
5. On any fetch or parse failure for a platform: record the error message in `Settings.lastChannelSyncError`, set `lastChannelSyncAt` to now, send a best-effort alert email (reusing `EmailService.sendAlert` from sub-project 2), log server-side. No `Reservation` rows are touched.
6. On success: set `lastChannelSyncAt` to now, clear `lastChannelSyncError`.

This same logic is invoked from two triggers sharing one code path: a scheduled job (`@nestjs/schedule`, `@Cron`, every 30 minutes) and a manual `POST /channel-sync/run` admin endpoint (for a "Sync now" button).

## Overlap detection

A `GET /reservations/check-overlap?checkIn=&checkOut=&excludeId=` endpoint (JWT-guarded) returns any non-`CANCELLED` reservations whose date range overlaps the given range (excluding the reservation being edited, via `excludeId`). The admin reservation form calls this whenever dates change and shows a non-blocking warning listing the conflicting reservation(s) — guest name, dates, source — without preventing save (staff may be intentionally correcting a sync artifact).

## Admin UI

- **Settings page**: two new URL fields (Booking.com / Airbnb iCal URL), a read-only status line ("Last synced: `<timestamp>`" or "Last sync failed: `<error>`"), and a "Sync now" button calling the manual sync endpoint.
- **Reservation list/detail**: a visible warning wherever `missingFromChannelAt` is set ("No longer found in the channel's calendar — confirm with the guest or cancel").
- **Reservation form**: a non-blocking overlap warning box, populated from the check-overlap endpoint whenever check-in/check-out change.

## Error handling

- A sync failure for one platform never affects the other platform's sync or any existing reservation data.
- The overlap check never blocks saving — it's advisory only.
- All sync-created reservations start as `PENDING` and flow through the existing sub-project 2 onboarding workflow exactly like a manually-created direct reservation, once staff add real guest contact info.

## Testing

- **Backend**: unit tests for the sync service — new booking created from a feed event; an already-synced booking is left untouched on a later sync; a booking missing from a later feed gets flagged; a previously-flagged booking un-flags itself if it reappears; a fetch failure touches no reservation data and records the error — all with a mocked `node-ical`. Unit tests for the overlap-check logic: true overlap, adjacent-non-overlapping ranges, the `excludeId` exclusion, cancelled reservations ignored. An e2e test for the manual sync endpoint and the check-overlap endpoint.
- **Frontend**: tests for the new Settings fields/button, and for the overlap-warning rendering in the reservation form.
