# Design: Guest Change History / Audit Log

Status: Approved
Date: 2026-09-24

## Purpose

A `Guest`'s name, phone, and email are re-synced from whatever a reservation carries every time one is confirmed, imported via the Chrome extension, or entered manually — see TODO.md section 5's own framing: "keep a trail of what changed, from what value to what value, and when... useful for debugging a 'wait, why did this change' question." Today nothing records that: `ReservationEvent` covers reservation-level history, but a `Guest` row can silently change under staff with no trace of the previous value.

This adds a `GuestEvent` log, structurally identical to the existing `ReservationEvent` pattern, recording every actual change to a guest's name, phone, email, or unsubscribe status.

## Scope

- **Tracked fields:** `name`, `phone`, `email` changes, plus unsubscribing from marketing emails. Not in scope: `totalStays`/`lastStayAt` (derived, recomputed on every sync, not meaningful to log as "changes"), and no way to *re*-subscribe exists today so there's nothing to log there either.
- **One write path per field, already found by reading the code:** `GuestsService.syncFromReservation()` is the only place `name`/`phone`/`email` are ever written, and `GuestsService.unsubscribeByToken()` is the only place `unsubscribedAt` is set. No other call site touches these fields — confirmed by grepping every `prisma.guest.update`/`upsert` call in the codebase.
- **New guests produce no events.** A `GuestEvent` only makes sense as a *change* — the first time a guest is created, there is no "before" value to diff against.
- **Known pre-existing gap, explicitly not fixed here:** `syncFromReservation()` upserts on `email` when present, or on `phone` when it isn't — it never looks up an existing phone-only guest by phone when an email is *also* now available, so a guest who first appeared without an email (Airbnb) and later provides one gets a **second, separate** `Guest` row rather than an update to the first. Because of this, `EMAIL_CHANGED` cannot actually fire under today's logic — but the event type is included anyway so the log is already correct if that merge gap is fixed later, rather than needing a second pass through this same code.
- **Normalization before comparing:** `email` is already lowercased/trimmed before it reaches the diff (existing behavior in `syncFromReservation`); `phone` is already trimmed. `name` is not currently normalized at all — trimmed input is stored today only for email/phone, so `name` can be written to the DB with stray leading/trailing whitespace. This design trims `name` in the update payload itself (not just for the diff), matching the other two fields — otherwise an untrimmed value already sitting in the DB could cause a false-positive "changed" event on a later sync purely from whitespace, comparing a freshly-trimmed new value against a stale untrimmed old one. No case-folding — `"jane doe"` → `"Jane Doe"` is treated as a real, loggable correction.

## Data model

New model, deliberately mirroring `ReservationEvent` field-for-field rather than inventing a new shape:

```prisma
model GuestEvent {
  id        String         @id @default(uuid())
  guestId   String
  guest     Guest          @relation(fields: [guestId], references: [id])
  type      GuestEventType
  detail    String?
  createdAt DateTime       @default(now())
}

enum GuestEventType {
  NAME_CHANGED
  PHONE_CHANGED
  EMAIL_CHANGED
  UNSUBSCRIBED
}
```

`detail` holds a human-readable before/after string in the form `<Campo>: "<antes>" → "<después>"`, with the Spanish field label matching how each field is already labeled elsewhere in admin-web (`Nombre`, `Teléfono`, `Email`) — e.g. `Teléfono: "+5491122334455" → "+5492235550000"`. A previously-empty field reads `(vacío)` on the "before" side, e.g. `Email: (vacío) → "jane@example.com"`. For `UNSUBSCRIBED`, `detail` is left `null` — the event type alone says everything there is to say.

`Guest` gains the inverse relation (`guestEvents GuestEvent[]`), matching how `Reservation` already relates to `ReservationEvent`.

## Backend

New module `api/src/guest-events/`, mirroring `api/src/reservation-events/` exactly:

- `GuestEventsService`:
  - `record(guestId: string, type: GuestEventType, detail?: string)` — creates one row.
  - `listForGuest(guestId: string)` — for the guest detail page, newest first.
  - `listAll()` — for the activity log tab, newest first, `include`-ing `guest: { select: { name: true, email: true } }` so the table can show who each entry belongs to without a second lookup (matching how `ReservationEventsService.listAll()` includes `reservation: { guestName, source }`).
- `GuestEventsController` — `GET /guest-events` (flat, JWT-guarded), mirroring `ReservationEventsController`'s `GET /reservation-events`.
- `GuestsController` gains `GET /guests/:id/events`, calling `guestEventsService.listForGuest(id)` — mirroring `ReservationsController`'s existing `GET /reservations/:id/events`.
- `GuestsModule` imports `GuestEventsModule` (needs `GuestEventsService` injected into `GuestsService`).

**`GuestsService.syncFromReservation()` changes:** `input.name` is trimmed alongside the existing `email`/`phone` trimming, and that trimmed value is what's used both in the upsert payload and the diff (see Scope above on why). Before the existing upsert call, look up the existing guest first (`findUnique` on the same `where` clause the upsert is about to use — `{ email }` or `{ phone }`) to capture pre-change `name`/`phone` values. After the upsert resolves, compare the (now trimmed) `name` and `phone` against the pre-change values; for each field that differs, call `guestEventsService.record()` with the matching `GuestEventType` and a `field: "old" → "new"` detail string. `email` is compared too (for forward-compatibility, per Scope above) even though it cannot differ under the current upsert-key logic — the comparison is harmless dead code today, not a footgun, and removing it later if the merge gap changes would be trivial.

**`GuestsService.unsubscribeByToken()` changes:** currently an anonymous `updateMany` chosen specifically so an invalid token can't be distinguished from a valid one by response shape. Restructured to first `findFirst({ where: { unsubscribeToken: token } })`; if no match, return (same silent no-op as today — an unknown token still can't be distinguished externally, since the HTTP response doesn't change). If found, `update` that guest by id (setting `unsubscribedAt`) and call `guestEventsService.record(guest.id, 'UNSUBSCRIBED')`. Net behavior at the API boundary is unchanged; this only changes what happens internally so there's a guest id to attach the event to.

## Frontend (admin-web)

- **`GuestDetailPage.tsx`**: new "Historial de cambios" section below the existing reservation history, listing each `GuestEvent` (type label + detail + relative/formatted date) — same visual pattern already used for a reservation's event list on `ReservationFormPage.tsx`. Empty state ("Sin cambios registrados") when the list is empty, matching this session's established `EmptyState` convention.
- **`ActivityLogPage.tsx`**: add a third tab, "Cambios de huéspedes," alongside the existing "Eventos de reservas" / "Errores del plugin" tabs (the page already uses the shared `Tabs` component). New tab fetches `GET /guest-events` and renders a table (guest name/email, change type, detail, date) — not merged into the existing reservation-events table, since the two event types don't share enough columns to make one combined table readable.
- New API client functions, named to match the existing reservation-events pair exactly (flat vs. per-entity): `admin-web/src/api/guest-events.ts` exports `listGuestActivityLog(): Promise<GuestEventEntry[]>` (mirrors `reservation-events.ts`'s `listActivityLog()`) for the activity tab; `admin-web/src/api/guests.ts` gains `listGuestEvents(id: string): Promise<GuestEvent[]>` (mirrors `reservations.ts`'s `listReservationEvents(id)`) for the per-guest list.

## Error handling

- `syncFromReservation()` already wraps its whole body in a try/catch that only logs on failure (guest sync is best-effort, never blocks the reservation flow it's called from) — the new lookup-and-diff logic sits inside that same try block, so a failure to record an event degrades the same way a failure to sync the guest already does today: logged, not surfaced to the guest or staff.
- `unsubscribeByToken()`'s restructure preserves its current contract exactly: unknown token → silent no-op, no error, no information leak.

## Testing

- **Backend unit tests** (`guests.service.spec.ts`): `syncFromReservation()` — records `NAME_CHANGED`/`PHONE_CHANGED` when an existing guest's values differ from the new sync; records nothing when they match (including the trim-normalization case: `"Jane "` syncing over `"Jane"` should not log a change); records nothing at all for a brand-new guest. `unsubscribeByToken()` — records `UNSUBSCRIBED` for a valid token; records nothing and updates nothing for an unknown token.
- **Backend unit tests** (`guest-events.service.spec.ts`): mirrors `reservation-events.service.spec.ts` — `record()` creates a row, `listForGuest()`/`listAll()` query and shape the result correctly.
- **Backend e2e**: a guest-facing confirm-dates call that changes an existing guest's phone results in a fetchable `GuestEvent` via `GET /guests/:id/events`; an unsubscribe-by-token call results in one via the same endpoint.
- **Frontend**: `GuestDetailPage.test.tsx` — renders the change-history list from a mocked response, shows the empty state when there are none. `ActivityLogPage.test.tsx` — the new tab fetches and renders `GuestEvent` entries; switching to it doesn't affect the reservation-events tab's already-loaded data.
