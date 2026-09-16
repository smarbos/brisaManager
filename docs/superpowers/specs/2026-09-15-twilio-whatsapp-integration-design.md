# Design: Twilio WhatsApp Reminders

Status: Approved
Date: 2026-09-15

## Purpose

Add a second, guest-facing notification channel (WhatsApp, via Twilio) alongside the existing
Resend-based email flow. At launch, this sends two reminder types once a guest has provided a
phone number during the confirmation flow:

- **Reservation reminder** — sent N days before check-in.
- **Deposit reminder** — sent if the 30% deposit hasn't been marked received M days after the
  initial confirmation email went out.

WhatsApp is strictly additional: email keeps working exactly as it does today, unaffected. A
guest with no phone number, or whose number can't be normalized, or whose reminder send fails for
any reason, simply doesn't get the WhatsApp message — nothing else in the app is affected, and no
alert fires. A guest's phone number, already collected as a required field during contract
acceptance, is treated as sufficient consent to be contacted there (no separate opt-in step).

Out of scope for this design (deferred, noted where relevant):
- A real, Meta-approved WhatsApp Business Sender for messaging guests who haven't messaged first.
  This design targets **Twilio's WhatsApp Sandbox**, which only delivers to numbers that have
  texted the sandbox's join code. Moving to production-scale guest messaging requires a business
  verification + template approval process with Meta — an account-level, not a code-level, change.
  The code is structured so that transition later only touches configuration (from-number,
  possibly moving from freeform `body` to Twilio's Content API with approved template SIDs), not
  the scheduling or data-model logic below.
- Any inbound WhatsApp handling (guests replying). This is send-only.
- SMS fallback if WhatsApp delivery fails.

## Architecture

A new `api/src/whatsapp/` module, mirroring the shape of the existing `api/src/email/` module:

- **`WhatsappService`** wraps the Twilio SDK. `sendMessage(rawPhone, body): Promise<boolean>`
  normalizes the phone number, sends via `client.messages.create(...)`, and returns `false`
  (logging why) on any failure — normalization failure, Twilio API error, missing credentials.
  Never throws: callers always get a boolean.
- **`WhatsappReminderSchedulerService`** — a daily `@Cron` job (same pattern as
  `GoogleCalendarSchedulerService`) that queries for reservations due a reminder, renders the
  configured template, sends, and — only on success — stamps a `*SentAt` column so the same
  reminder never sends twice. A failed send leaves that column `null`, so the next day's run
  retries automatically; no separate retry/dead-letter mechanism is needed.
- A small phone-normalization utility, `api/src/whatsapp/phone-normalizer.ts`, isolated and
  independently tested (see below) — this is the trickiest, most error-prone part of the feature.

`WhatsappModule` exports `WhatsappService` (for potential reuse elsewhere later) and registers the
scheduler; it's added to `AppModule` alongside the existing modules.

## Argentina phone number normalization

Guests type their phone number free-text on the confirmation form (added this session, no format
enforcement). WhatsApp addressing for Argentine mobile numbers requires the form
`+549<area><number>` — a `9` inserted right after the `54` country code, which is *not* how anyone
writes or dials the number locally (e.g. a guest in Mar del Plata might type `223 455-6677`,
`0223 15 455-6677`, `+54 223 455-6677`, or `54 9 223 455-6677`). Getting this wrong is a silent,
common failure mode (message simply never arrives, no error visible to staff).

`normalizeArgentinePhoneForWhatsapp(raw: string): string | null`:
1. Strip everything but digits and a leading `+`.
2. Strip a leading `0` (trunk prefix) and an internal `15` (old mobile prefix), both common in
   locally-dialed numbers, once the country code is confirmed present or assumed.
3. If it doesn't start with `54`, assume it's a local Argentine number and prepend `54`.
4. If the digits right after `54` aren't already `9`, insert it.
5. Return `whatsapp:+<result>`, or `null` if what's left isn't a plausible length (a guard against
   garbage input — the caller treats `null` as "skip, log it," never throws).

This function is pure and independently unit-tested against real-world input shapes (with/without
`+`, with/without country code, with/without the old `15` prefix, with spaces/dashes/parens,
already-correct E.164, and obviously invalid input) — see Testing.

## Data model changes

### `Reservation` (new columns)
| Field | Type | Notes |
|---|---|---|
| `reservationReminderSentAt` | `DateTime?` | set only on successful send; gates re-sending |
| `depositReminderSentAt` | `DateTime?` | same |

### `Settings` (new columns, singleton row — same pattern as existing email template fields)
| Field | Type | Default |
|---|---|---|
| `reservationReminderDaysBefore` | `Int` | `3` |
| `depositReminderDaysAfter` | `Int` | `3` |
| `reservationReminderWhatsappTemplate` | `String` | see below |
| `depositReminderWhatsappTemplate` | `String` | see below |

Default templates (same `{{placeholder}}` substitution mechanism the email templates already use —
see below):

```
reservationReminderWhatsappTemplate:
"Hola {{guestName}}! Te recordamos tu reserva en La Brisa de Mar del Plata del {{checkIn}} al {{checkOut}}. ¡Te esperamos!"

depositReminderWhatsappTemplate:
"Hola {{guestName}}, todavía no registramos el depósito de tu reserva del {{checkIn}}. {{paymentInstructions}}"
```

Both are plain editable strings on the Settings page, in a new "WhatsApp" section alongside the
existing email-template textareas and two new number inputs for the day thresholds.

## Shared template rendering

`renderTemplate(template, vars)` currently lives as a private function inside
`email.service.ts`. It's generic (simple `{{key}}` string substitution) and WhatsApp needs the
identical behavior, so it moves to `api/src/common/render-template.ts` and both `EmailService` and
`WhatsappService` import it from there — a one-line extraction, not a redesign.

## Scheduler logic

Once daily (`@Cron(CronExpression.EVERY_DAY_AT_9AM)`):

**Reservation reminders** — for each `Reservation` where `status = CONFIRMED`, `guestPhone` is set,
`reservationReminderSentAt` is `null`, and `checkIn` is exactly `settings.reservationReminderDaysBefore`
days from today (date-only comparison, matching existing check-in/out date handling elsewhere in
the app): render the template with `{{guestName}}`, `{{checkIn}}`, `{{checkOut}}`; call
`whatsappService.sendMessage(guestPhone, body)`; on `true`, stamp
`reservationReminderSentAt = now()`.

**Deposit reminders** — for each `Reservation` where `status != CANCELLED`, `guestPhone` is set,
`confirmationPaymentReceivedAt` is `null`, `depositReminderSentAt` is `null`, and
`confirmationEmailSentAt` is set and more than `settings.depositReminderDaysAfter` days ago: render with
`{{guestName}}`, `{{checkIn}}`, `{{paymentInstructions}}` (reusing `settings.paymentInstructions`,
already used by the email flow); send; stamp on success.

Both queries and both sends are independent and wrapped in their own try/catch per reservation —
one bad row (e.g. an unnormalizable phone number) never blocks the rest of the batch, matching the
existing scheduler's top-level catch-and-log pattern.

## Configuration

New env vars (added to `.env.example` and the README's production deployment section):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` — the sandbox number in Sandbox mode (`whatsapp:+14155238886`), or the
  approved Business Sender number later.

No debug-mode toggle for WhatsApp at launch (unlike email's `EMAIL_DEBUG_MODE`/`_RECIPIENT`): the
Sandbox itself is the safety net right now, since only numbers that have texted the join code can
receive anything at all. The same debug-redirect pattern can be added cheaply later, following
`EmailService`'s exact precedent, once real guests start receiving these.

## Testing

- **Unit** — `phone-normalizer.spec.ts`: table-driven cases covering every input shape listed
  above. `whatsapp.service.spec.ts`: mocked Twilio client, success path, Twilio-error path,
  unnormalizable-phone path — all resolve `boolean`, never throw.
  `whatsapp-reminder.scheduler.spec.ts`: mocked Prisma + `WhatsappService` + `SettingsService`,
  verifying correct row selection for both reminder types, that a successful send stamps the
  `*SentAt` column, that a failed send leaves it `null` (so it retries next run), and that one
  failing reservation doesn't stop the rest of the batch.
- **E2e** — extend `settings.e2e-spec.ts` for the four new Settings fields (`GET`/`PUT` round-trip).
  No e2e test for the scheduler itself: it's not an HTTP endpoint, and `GoogleCalendarSchedulerService`
  (the closest existing precedent) is unit-tested only, not e2e-tested — following that.
- **Frontend** — extend `SettingsPage.test.tsx` for the new fields (load + save), same shape as the
  existing email-template field tests.

## Deployment note (not part of this implementation, but required before it's useful)

After this ships, the production `.env` on the droplet needs the three `TWILIO_*` values added,
and any real phone number you want to test with (starting with your own) needs to text the
Sandbox's join code to its number before it can receive anything.
