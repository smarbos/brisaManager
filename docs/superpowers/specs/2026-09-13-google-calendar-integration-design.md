# Design: Google Calendar Integration (Sub-project 4)

Status: Approved
Date: 2026-09-13

## Purpose

Fourth sub-project for the La Brisa de Mar del Plata reservation manager (see `TODO.md`), building on sub-projects 1-3. Gives staff visibility into all reservations via a shared Google Calendar, and lets staff also create/edit/delete bookings directly on that calendar as an alternative input path to the admin app.

## Authentication

OAuth2, not a service account: the business's own Google account signs in once via a "Connect Google Calendar" button on the admin Settings page, which redirects to Google's consent screen and back. On callback, the API exchanges the auth code for a refresh token and persists it. All subsequent Calendar API calls use that refresh token to mint access tokens as needed. If Google ever reports the token revoked/invalid, the app clears the stored credentials and Settings shows "Reconnect Google Calendar" — no manual token handling required from staff after the initial connect.

On first connect, the app creates one dedicated Google Calendar (not the user's primary calendar) via the Calendar API and stores its id. Staff share that calendar with themselves/other staff using Google's native calendar sharing (view or edit access, managed entirely in Google Calendar's own UI — out of scope for this app).

## Sync direction: two-way, with one exception

- **App → Calendar (push):** every reservation create/update/cancel/checkout pushes a corresponding create/update/delete of a Google Calendar event. Applies to reservations of every source (`DIRECT`, `BOOKING`, `AIRBNB`).
- **Calendar → App (pull):** a scheduled job periodically detects new/edited/deleted events on the calendar and creates/updates/cancels matching reservations — but **only for `DIRECT`-source reservations** (including new events, which always become `DIRECT`).
- **Exception — channel-sourced reservations are pull-immune:** `BOOKING`/`AIRBNB` reservations already have iCal feeds (sub-project 3) as their source of truth. Their calendar events are pushed for visibility, but if staff edit or delete one of those specific events directly on the calendar, the pull job ignores the change entirely — the next push (triggered by any app-side update, or a periodic reconciliation) resets the event back to match the app's record. This avoids two systems fighting over the same reservation's dates.

## Data model additions

**Settings** (existing singleton, extended):

| Field | Type | Notes |
|---|---|---|
| `googleRefreshToken` | string, nullable | OAuth refresh token; null means not connected |
| `googleCalendarId` | string, nullable | The dedicated calendar's id, created on first connect |
| `googleSyncToken` | string, nullable | Google Calendar API incremental-sync cursor; null forces a full resync |
| `lastCalendarSyncAt` | datetime, nullable | Set on every pull attempt (success or failure) |
| `lastCalendarSyncError` | text, nullable | Set on pull or push failure; cleared on the next success |

**Reservation** (existing, extended):

| Field | Type | Notes |
|---|---|---|
| `googleEventId` | string, nullable | Links a reservation to its calendar event. Null means "not yet pushed" (e.g. Calendar not connected yet) or "event removed" (cancelled and cleaned up) |

## Push logic (app → calendar)

Triggered from `ReservationsService.create`/`update` and wherever cancellation or checkout status transitions happen, as a non-blocking best-effort call (same fire-and-forget-with-logging pattern as the sub-project 2 confirmation email) — it never blocks or fails the HTTP response to the admin UI.

1. Skip entirely if `Settings.googleRefreshToken` is null (not connected).
2. Build the event:
   - Title: `"{guestName} ({source})"`, e.g. `"Jane Doe (Airbnb)"`.
   - Start/end: `checkIn`/`checkOut`, as an all-day event.
   - Description: pax count, total amount + currency, current status.
3. If the reservation is `CANCELLED` or past checkout (`COMPLETED`): delete the Google Calendar event (if `googleEventId` is set) and clear `googleEventId`.
4. Otherwise: if `googleEventId` is null, create the event and store the returned id; if set, update the existing event in place.
5. On any Calendar API failure: log via `Logger.error`, set `Settings.lastCalendarSyncError`, leave `googleEventId` as it was so the next triggered push retries. Never throws back to the caller.

## Pull logic (calendar → app)

A scheduled job (`@nestjs/schedule`, `@Cron`, every 5 minutes — tighter than the 30-minute iCal cron since calendar edits are meant to feel closer to real-time for staff) mirrors the channel-sync scheduler's try/catch-wrapped structure from sub-project 3 so one failed run never kills the cron.

1. Skip entirely if `Settings.googleRefreshToken` is null.
2. Call the Calendar API's `events.list` with `syncToken` if one is stored, else a full listing (bounded to events from today onward). Store the new `nextSyncToken` when the page is exhausted.
3. If Google rejects the sync token (`410 Gone`, e.g. after being disconnected a long time): clear `googleSyncToken` and fall back to a full resync this run.
4. For each changed event:
   - **Event's `googleEventId` matches an existing `BOOKING`/`AIRBNB` reservation:** ignore — channel-sourced reservations are pull-immune (see above).
   - **Event's `googleEventId` matches an existing `DIRECT` reservation:**
     - Event marked `status: cancelled` by the Calendar API (deleted) → set the reservation to `CANCELLED`, clear `googleEventId`.
     - Event still present with changed title/start/end → update the reservation's `guestName` (parsed from the title, stripping any trailing `" (SOURCE)"` suffix) and `checkIn`/`checkOut`.
   - **Event has no matching reservation (new event, or one the app never pushed):** create a new `Reservation`: `guestName` = event title, `source = DIRECT`, `status = PENDING`, `paxCount = 1`, `totalAmount = 0`, `currency = "ARS"`, `checkIn`/`checkOut` from the event, `googleEventId` = the event's id. Like sub-project 3's channel-created reservations, this write goes directly through Prisma (not `CreateReservationDto`, whose validation would reject the placeholder `0` amount) — staff fill in real pax/price/contact details afterward, and the reservation then flows through the normal onboarding workflow.
5. On any fetch failure: record the error in `Settings.lastCalendarSyncError`, set `lastCalendarSyncAt`, log server-side. No reservation data is touched.
6. On success: set `lastCalendarSyncAt` to now, clear `lastCalendarSyncError`.

This pull job is also exposed as a manual `POST /google-calendar/sync-now` admin endpoint, matching the "Sync now" pattern from channel integrations.

## Admin UI

- **Settings page**: a "Connect Google Calendar" button (or "Connected — Disconnect" / "Reconnect Google Calendar" depending on state), a read-only status line ("Last synced: `<timestamp>`" or "Last sync failed: `<error>`"), and a "Sync now" button.
- **OAuth callback route**: a backend endpoint (e.g. `GET /google-calendar/oauth/callback`) that exchanges the auth code, persists the refresh token, creates the dedicated calendar if one doesn't exist yet, and redirects back to the Settings page with a success/failure query param the frontend reads to show a toast.
- No changes to the reservation list/form beyond what sub-project 3 already added — Google Calendar is a visibility/alternate-input layer, not a new field staff fill in directly.

## Error handling

- Not connected: both push and pull are silent no-ops — the feature is fully optional.
- A push failure never blocks the reservation create/update request that triggered it.
- A pull failure never touches reservation data and never affects the iCal channel sync (independent schedulers, independent error fields).
- Channel-sourced (`BOOKING`/`AIRBNB`) reservations can never be mutated by the pull job under any circumstance — this is the one hard invariant protecting sub-project 3's sync logic from this sub-project.

## Testing

- **Backend**: unit tests for push (create/update/delete event calls made with correct payloads; skipped when not connected; failure sets error field without throwing) and pull (new event → new `DIRECT` reservation; edited event → updated `DIRECT` reservation; deleted event → cancelled `DIRECT` reservation; event tied to a `BOOKING`/`AIRBNB` reservation is never mutated regardless of its calendar-side state; `410 Gone` triggers a full resync; fetch failure touches no data) — all against a mocked `googleapis` calendar client, no real network calls. An e2e test for the Settings connect-status fields and the manual sync endpoint.
- **Frontend**: tests for the Settings page's connect/disconnect/sync-now UI states.
- **Manual verification** (not automatable in CI): after implementation, connect a real Google account, confirm a reservation's event appears on the calendar, edit and delete an event directly on the calendar and confirm the pull job reflects it correctly, and confirm a `BOOKING`/`AIRBNB` event is unaffected by a direct calendar edit.
