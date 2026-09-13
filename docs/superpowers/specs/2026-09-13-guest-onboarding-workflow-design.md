# Design: Guest Onboarding Workflow (Sub-project 2)

Status: Approved
Date: 2026-09-13

## Purpose

Second sub-project for the La Brisa de Mar del Plata reservation manager (see `TODO.md`), building on top of sub-project 1's core reservation management. Delivers the automated guest onboarding flow: confirming dates/pax, accepting a digital contract (house rules), and tracking the 30% confirmation payment and refundable security deposit — culminating in an automatic reservation confirmation and email once everything is done.

Out of scope for this sub-project (deferred per `TODO.md` / explicit decisions below):
- Real WhatsApp Business API integration — messaging stays link-based; staff can copy the guest confirmation link and send it however they like (WhatsApp, SMS, etc.)
- A payment gateway (e.g. Mercado Pago checkout) — payments are manual bank transfers, confirmed by staff in the admin app
- Booking.com / Airbnb API integrations, Google Calendar sync, marketing/CRM — later sub-projects
- Broader post-stay/checkout workflow — only a simple "deposit returned" toggle is included now; a full checkout flow is future work

## Architecture

Extends the existing three-service architecture (`api`, `admin-web`, `guest-web`) from sub-project 1:

- **`api`** — gains: a `Settings` singleton (house rules + payment instructions, admin-editable), new onboarding-tracking fields on `Reservation`, a `ReservationEvent` audit log, a set of **public** (unauthenticated, token-scoped) endpoints for the guest confirmation flow, and integration with **Resend** for transactional email.
- **`guest-web`** — replaces the placeholder page with a real confirmation flow at `/r/:token`, restyled to match `labrisa.com.ar`'s actual design system (see Design System below).
- **`admin-web`** — gains a Settings page (edit house rules + payment instructions) and additions to the reservation detail view: onboarding progress, buttons to mark payment/deposit received and deposit returned, a "copy guest link" action, and an event/audit timeline.

No new services. No payment gateway, no WhatsApp API — email is the only new external integration (Resend).

## Data model

### Reservation (new fields, additive to sub-project 1's model)

| Field | Type | Notes |
|---|---|---|
| `confirmationToken` | string, unique | Random token identifying the guest's confirmation page; generated on reservation creation. Not guessable — acts as the "auth" for the public flow (no guest login). |
| `datesConfirmedAt` | datetime, nullable | Set when the guest confirms their dates/pax are correct |
| `contractAcceptedAt` | datetime, nullable | Set when the guest accepts the house rules |
| `contractAcceptedName` | string, nullable | Typed full name the guest entered as an e-signature |
| `contractSnapshot` | text, nullable | The house-rules text exactly as it read at acceptance time (audit trail — survives later edits to `Settings.houseRulesText`) |
| `confirmationPaymentReceivedAt` | datetime, nullable | Set by staff once the 30% transfer is confirmed |
| `depositReceivedAt` | datetime, nullable | Set by staff once the security deposit transfer is confirmed |
| `depositReturnedAt` | datetime, nullable | Set by staff once the deposit has been returned to the guest post-stay |
| `confirmationEmailSentAt` | datetime, nullable | Idempotency guard — the initial "confirm your reservation" email fires at most once |
| `finalConfirmationEmailSentAt` | datetime, nullable | Idempotency guard — the final "you're confirmed" email fires at most once |

**Auto-confirmation rule:** the moment `datesConfirmedAt`, `contractAcceptedAt`, `confirmationPaymentReceivedAt`, and `depositReceivedAt` are all non-null, the reservation's `status` (from sub-project 1) automatically flips to `CONFIRMED`, and the final confirmation email fires (guarded by `finalConfirmationEmailSentAt`). This rule only fires when the current `status` is `PENDING` — it never overrides a status staff has manually set to `CANCELLED` or `COMPLETED` via the admin edit form.

### Settings (new, singleton — a single row, created on first use)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Fixed singleton id |
| `houseRulesText` | text | The digital contract's house-rules content, editable by staff |
| `paymentInstructions` | text | Bank transfer details shown to guests for the 30% and deposit, editable by staff |
| `updatedAt` | datetime | |

### ReservationEvent (new — audit log)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `reservationId` | string | FK to `Reservation` |
| `type` | enum | `DATES_CONFIRMED`, `CONTRACT_ACCEPTED`, `PAYMENT_RECEIVED`, `DEPOSIT_RECEIVED`, `DEPOSIT_RETURNED`, `RESERVATION_CONFIRMED`, `INITIAL_EMAIL_SENT`, `INITIAL_EMAIL_FAILED`, `FINAL_EMAIL_SENT`, `FINAL_EMAIL_FAILED` |
| `detail` | text, nullable | Free-form context (e.g. an error message for a `*_FAILED` event) |
| `createdAt` | datetime | |

Every workflow action (guest-driven or staff-driven) writes one event. Shown as a timeline on the reservation's admin detail page.

**Failure alerting:** whenever a `*_FAILED` event is recorded, the system also sends an alert email to a fixed `ALERT_EMAIL` address (env var, defaults to the admin's own address) — so failures surface proactively, not just via the audit log.

## Guest-facing flow & public API

Public (no authentication) endpoints, scoped by `confirmationToken`:

- `GET /public/reservations/:token` — returns a safe subset of reservation data (dates, pax, total amount, 30%/deposit amounts, current progress, house rules text, payment instructions). 404 on an unknown token, with no distinction between "malformed" and "not found" (avoids leaking whether a token is close to valid).
- `POST /public/reservations/:token/confirm-dates` — sets `datesConfirmedAt`, writes a `DATES_CONFIRMED` event, checks the auto-confirmation rule.
- `POST /public/reservations/:token/accept-contract` — body `{ fullName }` (required, non-empty) — sets `contractAcceptedAt`, `contractAcceptedName`, snapshots the current `Settings.houseRulesText` into `contractSnapshot`, writes a `CONTRACT_ACCEPTED` event, checks the auto-confirmation rule.

`guest-web`'s `/r/:token` page walks the guest through: view reservation details → confirm dates/pax → read and accept house rules (typed name) → view payment instructions for the 30% and deposit. Once both guest-driven steps are done, the page shows a "waiting for payment confirmation" state — the rest (marking payments received) happens in the admin app.

If a guest disagrees with the listed dates/pax, there's no in-app dispute mechanism — they contact staff through whatever channel they already have (WhatsApp, phone), consistent with the manual-first approach of this sub-project.

## Admin-web additions

- **Settings page**: a form to edit `houseRulesText` and `paymentInstructions`.
- **Reservation detail view**: onboarding progress (which of the 4 steps are done), buttons to mark the 30% payment received, deposit received, and deposit returned, a "copy guest confirmation link" action, and the `ReservationEvent` timeline.
- Automated emails fire server-side from the API (not triggered from admin-web): the initial link email sends automatically on reservation creation when `guestEmail` is set; the final confirmation email sends automatically once the auto-confirmation rule is met.

## Email (Resend integration)

- New env vars: `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `reservas@labrisa.com.ar` — requires domain verification in Resend), `ALERT_EMAIL` (defaults to `ADMIN_SEED_EMAIL` if unset).
- Two transactional emails: (1) initial — sent on reservation creation if `guestEmail` present, contains the `/r/:token` link; (2) final — sent once the reservation auto-confirms.
- A send failure writes a `*_FAILED` `ReservationEvent` and triggers the `ALERT_EMAIL` notification, but never blocks or rolls back the underlying state change (e.g. `datesConfirmedAt` still gets set even if the resulting notification email fails).

## Design system (guest-web restyle)

Extracted directly from `labrisa.com.ar`'s live stylesheet (`assets/css/style.css`) so `guest-web` reads as part of the same site:

**Colors:**
```
--color-dark:       #101010   (primary buttons, dark text/backgrounds)
--color-teal:       #0bb4aa   (accent — links, CTAs, highlights)
--color-teal-dark:  #089990   (hover state for teal elements)
--color-bg:         #f9fafd   (page background)
--color-white:      #ffffff
--color-grey:       #6c6c77   (secondary/body text)
--color-light-grey: #d9d9d9   (borders, dividers)
```

**Typography:** `Montserrat` (sans-serif) for headings — often uppercase with letter-spacing; `Inter` (sans-serif) for body text, buttons, and form inputs.

**Layout:** `max-width: 1140px` content container; buttons are bold, uppercase, letter-spaced (~0.08em), subtle `2px` border-radius (near-sharp, not pill-shaped), generous padding (`0.85rem 2.5rem`); form inputs use `1px solid var(--color-light-grey)` borders with the same `2px` radius; generous section whitespace; minimal shadows.

`guest-web` adopts these as CSS custom properties and matches the button/form/heading styles, without needing to copy the marketing site's specific sections (hero, testimonials) — just the shared design language for a clean, on-brand confirmation flow.

## Error handling

- Invalid/unknown `confirmationToken` → 404 on all public endpoints
- Contract acceptance without a `fullName` → 400
- Email send failures are caught, logged as `ReservationEvent`s, trigger the alert email, and do not throw past the triggering state-change endpoint
- Admin "mark received"/"mark returned" actions are idempotent (setting an already-set field is a no-op, not an error)

## Testing

- **Backend:** unit tests for the auto-confirmation rule (all 4 conditions → status flips to `CONFIRMED`, final email fires exactly once even if called multiple times); unit tests for the public endpoints (valid token, invalid token, contract acceptance validation); a unit test for the failure-alert path (simulated email failure → `ReservationEvent` written + alert email attempted); e2e test covering the full guest flow (confirm dates → accept contract → staff marks payments → auto-confirms).
- **Frontend (guest-web):** smoke tests for the confirmation page's steps (renders reservation info, submits date confirmation, submits contract acceptance with name validation).
- **Frontend (admin-web):** smoke tests for the Settings form and the new reservation-detail controls (mark received/returned buttons, event timeline rendering).
