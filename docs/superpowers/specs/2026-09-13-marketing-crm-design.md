# Design: Marketing / CRM (Sub-project 5)

Status: Approved
Date: 2026-09-13

## Purpose

Fifth sub-project for the La Brisa de Mar del Plata reservation manager (see `TODO.md`), building on sub-projects 1-4. Gives the business a real guest history (deduplicated across repeat stays, regardless of source) and the ability to send templated marketing emails to filtered segments of past guests, with a one-click unsubscribe and a send history for accountability.

## Data model

**`Guest`** (new):

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | |
| `email` | string, unique | Normalized to lowercase for matching/dedup |
| `name` | string | Kept in sync from the most recent reservation/onboarding data (see Sync below) |
| `phone` | string, nullable | |
| `totalStays` | int | Recomputed on every sync trigger, from `Reservation`s linked via `guestId` |
| `lastStayAt` | datetime, nullable | Latest `checkOut` among linked reservations |
| `unsubscribedAt` | datetime, nullable | Set once, never cleared automatically — excludes the guest from all future campaigns unconditionally |
| `unsubscribeToken` | string (uuid), unique | Generated on creation; embedded in every marketing email's unsubscribe link |
| `createdAt` / `updatedAt` | datetime | |

**`Reservation`** (existing, extended):

| Field | Type | Notes |
|---|---|---|
| `guestId` | string, nullable, FK to `Guest` | Set/updated whenever the reservation has a `guestEmail` — this is the durable link a "show me this guest's history" or "who's in this campaign" query walks, not an ad-hoc email-string match |

**`CampaignTemplate`** (new): `id`, `name`, `subject`, `bodyHtml` (containing a `{{guestName}}` placeholder), `createdAt`/`updatedAt`. Plain CRUD, editable in the admin app — no versioning.

**`Campaign`** (new): one row per send attempt — `id`, `templateId` (FK), `filterType` (`ALL` | `STAYED_WITHIN_MONTHS` | `NOT_STAYED_WITHIN_MONTHS`), `filterMonths` (int, nullable — only set for the two month-based filters), `recipientCount` (int), `sentAt` (datetime).

**`CampaignRecipient`** (new): one row per guest per campaign — `id`, `campaignId` (FK), `guestId` (FK), `status` (`SENT` | `FAILED`), `error` (string, nullable — populated on `FAILED`).

## Guest sync

A `GuestsService.syncFromReservation(reservation)` method is the single place that creates/updates `Guest` rows and links `Reservation.guestId`, called as a non-blocking side effect (never throws, never blocks the caller — same pattern as the Google Calendar push service) from two triggers:

1. **`ReservationsService.create()`/`update()`** — whenever the reservation has a non-empty `guestEmail`.
2. **`PublicReservationsService.acceptContract()`** — the guest's self-provided `fullName` (captured when they accept the digital contract during the existing onboarding flow from sub-project 2) also updates `Guest.name`, since this is the guest's own confirmed identity, arguably more trustworthy than whatever staff typed in.

Sync logic: normalize the email to lowercase; `upsert` a `Guest` by that email (create with the given name/phone if new, otherwise update `name` — and `phone` if present — from the trigger's data); set `Reservation.guestId` to the resulting `Guest.id`; recompute `totalStays` (count of that guest's linked reservations) and `lastStayAt` (max `checkOut` among them) and persist them on the `Guest`.

A guest-sync failure must never block or fail the reservation save / contract acceptance that triggered it — logged and swallowed, matching the non-blocking-side-effect precedent set by the Google Calendar push in sub-project 4.

## Unsubscribe mechanism

Every marketing email's footer includes a plain link: `{API_URL}/public/guests/{unsubscribeToken}/unsubscribe`. This is a public, unauthenticated GET endpoint (no JWT, no guest-web involvement) that sets `Guest.unsubscribedAt` to now (idempotent — visiting it twice is harmless) and returns a small static HTML page directly from the API confirming the opt-out. No guest-web route is needed since this is a one-shot, non-interactive action, unlike the guest onboarding flow which needs a real form.

Unsubscribed guests (`unsubscribedAt` not null) are excluded from every campaign's recipient query, regardless of the filter chosen — this exclusion is unconditional and applied at the query level, not something a filter can override.

## Campaign send flow

1. Admin selects a `CampaignTemplate` and a filter (`All guests`, `Stayed within the last N months`, `Not stayed within the last N months` — `N` is a plain number input for the two month-based filters).
2. `GET /campaigns/preview?templateId=&filterType=&filterMonths=` (JWT-guarded) returns the resolved, non-unsubscribed recipient count without sending anything — lets staff sanity-check before committing.
3. Admin confirms → `POST /campaigns` (JWT-guarded) with the same parameters. The backend re-resolves the recipient list (never trusts a stale count from step 2), then for each guest: sends one Resend call with `{{guestName}}` interpolated into the template's subject/body plus the unsubscribe footer appended, and records one `CampaignRecipient` (`SENT` or `FAILED` with the error message). After the loop, writes one `Campaign` row with the final `recipientCount` (guests attempted, not just successes) and `sentAt`.
4. Runs synchronously within the request — this app's guest lists are apartment-scale (tens to low hundreds), consistent with how `channel-sync` and the Google Calendar pull already process their own bounded, small-scale loops synchronously.

A single recipient's send failure never stops the batch: the loop continues, that recipient is recorded `FAILED`, and the campaign still completes and is recorded. If sending fails before the loop can even start (e.g. an invalid Resend API key), the `Campaign` row is still created with `recipientCount` reflecting the attempted total and every recipient recorded `FAILED` — never a silently-missing campaign record.

## Admin UI

- **Guests list** (`/guests`): read-only table — name, email, phone, total stays, last stay, an "unsubscribed" badge when applicable. No manual guest creation/editing; guests are always derived from reservations and the onboarding flow.
- **Templates** (`/templates`): list + create/edit form (name, subject, body, with a `{{guestName}}` placeholder hint shown in the UI). Delete allowed only if no `Campaign` references the template (to keep campaign history's `templateId` link meaningful) — attempting to delete a referenced template shows an error explaining why.
- **Campaigns** (`/campaigns`): a compose panel (template dropdown, filter selector, live recipient-count preview via the preview endpoint, a "Send" button gated behind a confirmation since this is irreversible) above a history list (past campaigns: template name, filter description, recipient count, sent-at, and an expandable per-recipient breakdown of `SENT`/`FAILED`).

## Error handling

- Guest sync never blocks or fails the reservation-save/contract-acceptance request that triggered it.
- The unsubscribe endpoint is idempotent and never errors on an already-unsubscribed or unknown token — an unknown token just renders the same confirmation page (avoids leaking which tokens are valid, and there's no harm in it since the action is one-directional).
- A campaign's per-recipient failures don't abort the batch; the `Campaign`/`CampaignRecipient` records always end up an accurate reflection of what was attempted and what succeeded.
- The preview endpoint and the actual send both re-resolve the recipient list from current data — a guest who unsubscribes between preview and send is correctly excluded from the send.

## Testing

- **Backend**: unit tests for `GuestsService.syncFromReservation` — new guest created from a reservation with a guest email; existing guest updated (name/phone) and `totalStays`/`lastStayAt` recomputed on a second reservation; no sync attempted when `guestEmail` is absent; a sync failure doesn't propagate to the caller. Unit tests for the campaign recipient-resolution query — each filter type, the unconditional unsubscribed-guest exclusion regardless of filter, an empty result set. Unit tests for the campaign send loop — per-recipient `SENT`/`FAILED` recording, one recipient's failure doesn't stop the rest, the `Campaign` row's `recipientCount` matches the attempted total. e2e tests for the templates CRUD endpoints, the campaign preview/send endpoints (JWT-guarded), and the public unsubscribe endpoint (unauthenticated, idempotent, unknown-token-safe).
- **Frontend**: tests for the Guests list rendering, the Templates CRUD form, and the Campaigns compose-and-preview-and-send flow (including the confirmation gate before an actual send).
