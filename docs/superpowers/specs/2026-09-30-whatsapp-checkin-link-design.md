# Design: WhatsApp Check-in Link and Template-Based Messages

## Context

The guest link (`GUEST_WEB_ORIGIN/r/<confirmationToken>`) — where a guest confirms dates,
accepts the contract, sees the bank details and gets arrival info — only reaches guests by
email today (`ReservationsService.sendInitialEmail`), plus a pre-composed Airbnb message the
Chrome extension pastes into the Airbnb thread. Guests read WhatsApp far more reliably than
email, and Booking.com/Airbnb relay emails often go unread.

WhatsApp sending already exists (`api/src/whatsapp/`, see
`2026-09-15-twilio-whatsapp-integration-design.md`), but it was built against Twilio's
Sandbox and sends freeform text. That spec explicitly deferred two things this design now
does, because a real Meta-approved sender number is about to be live:

- **Business-initiated messages must use Meta-approved templates.** WhatsApp only delivers
  freeform text within 24h of the guest's last message to us. Every message here is sent to a
  guest who hasn't written first, so freeform sends are accepted by Twilio and then dropped
  by WhatsApp (Twilio error 63016). That includes the two existing daily reminders.
- **Non-Argentine numbers.** `normalizeArgentinePhoneForWhatsapp` returns `null` for any
  explicit non-`+54` number, so foreign Booking.com/Airbnb guests can never be messaged.

## Goals

1. Send the guest link over WhatsApp automatically whenever a new reservation has a phone
   number, alongside (not instead of) the existing email.
2. Let staff send/resend it on demand from the reservation page.
3. Move the two existing reminders to approved templates so they keep delivering on the real
   sender number.
4. Message foreign guests, not just Argentine numbers.

Out of scope (possible follow-ups):
- Twilio delivery-status callbacks. "Sent" means Twilio accepted the message, not that it was
  delivered — e.g. a number not on WhatsApp (63003) won't surface anywhere.
- Inbound messages / guest replies.
- Staff notifications over WhatsApp (TODO §7).

## Templates (created in Twilio, submitted to Meta)

All three are Content Template Builder "Call to action" templates, language Spanish (ARG),
WhatsApp category **Utility**, each with one "Visit website" button whose URL ends in the
reservation's `confirmationToken`.

| Name | SID | Variables | Button |
|---|---|---|---|
| `checkin_link` | `HX75515c3d86147b823a36c766588c45da` | 1 guestName, 2 checkIn, 3 checkOut, 4 token | "Completar check-in" → `https://reservas.labrisa.com.ar/r/{{4}}` |
| `reservation_reminder` | `HX70607aae1fe5be825d36018e26ff9095` | 1 guestName, 2 checkIn, 3 checkOut, 4 token | "Ver mi reserva" → `https://reservas.labrisa.com.ar/r/{{4}}` |
| `deposit_reminder` | `HX1e26678753855e9df9cd58783b4ad771` | 1 guestName, 2 checkIn, 3 token | "Ver datos de pago" → `https://reservas.labrisa.com.ar/r/{{3}}` |

Bodies:
- `checkin_link`: "Hola {{1}}, ¡gracias por reservar en La Brisa de Mar del Plata! Tu estadía
  del {{2}} al {{3}} ya está registrada. Para completar el check-in, tocá el botón de abajo."
- `reservation_reminder`: "Hola {{1}}! Te recordamos tu reserva en La Brisa de Mar del Plata
  del {{2}} al {{3}}. En el link de tu reserva tenés la dirección y cómo llegar."
- `deposit_reminder`: "Hola {{1}}, todavía no registramos el pago de tu reserva del {{2}}.
  Encontrás los datos para transferir tocando el botón de abajo."

The deposit reminder links to the guest page's payment step instead of embedding
`Settings.paymentInstructions`: those instructions are multi-line bank details, and Meta
doesn't allow newlines inside template variables.

Dates use the existing `formatDateOnly` (`dd/mm/yyyy`, UTC). The button's domain is fixed
inside the approved template, so the code only supplies the token — `GUEST_WEB_ORIGIN` is not
involved in WhatsApp sends.

## Configuration

New env vars, in `.env.example` and the production `.env` (the API container loads `.env`
via `env_file`, so `docker-compose.prod.yml` needs no change):

```
TWILIO_TEMPLATE_CHECKIN_LINK=HX75515c3d86147b823a36c766588c45da
TWILIO_TEMPLATE_RESERVATION_REMINDER=HX70607aae1fe5be825d36018e26ff9095
TWILIO_TEMPLATE_DEPOSIT_REMINDER=HX1e26678753855e9df9cd58783b4ad771
```

`TWILIO_WHATSAPP_FROM` changes to `whatsapp:+54…` (the approved number) once it's live.

Template IDs live in env vars, not Settings: they change rarely, each change needs Meta
approval anyway, and a wrong ID pasted into Settings would silently stop all sending.

## Architecture

### `WhatsappService.sendTemplate`

```ts
sendTemplate(
  rawPhone: string,
  templateSid: string | undefined,
  variables: Record<string, string>,  // { '1': 'María', '2': '12/12/2026', ... }
  fallbackBody: string,
): Promise<boolean>
```

- With a `templateSid`: `client.messages.create({ from, to, contentSid, contentVariables:
  JSON.stringify(variables) })`.
- Without one (env var unset — local dev, Sandbox testing): sends `fallbackBody` as freeform
  text, today's behavior. The fallback text carries the same information as the template,
  with the full guest link written out (`GUEST_WEB_ORIGIN/r/<token>`).
- Same contract as `sendMessage`: phone normalization, lazy client construction, never
  throws, returns `false` (logged) on any failure. `sendMessage` stays as the freeform
  primitive `sendTemplate` falls back to.

### Phone normalization

`normalizeArgentinePhoneForWhatsapp` becomes `normalizePhoneForWhatsapp`:
- No explicit `+`, or `+54`: unchanged Argentine rules (strip trunk `0` and early `15`,
  insert the mobile `9`, require 13 digits). All existing tests keep passing.
- Explicit `+` with another country code: parsed with `libphonenumber-js` (already an API
  dependency, used by `channel-import`); if `isValid()`, returns `whatsapp:<E.164>`,
  otherwise `null`. Never re-guesses a country — the safety property from the original
  spec (a foreign number must never be rewritten into a plausible Argentine one) holds.

### Sending the check-in link

`ReservationsService.sendInitialWhatsapp(reservation): Promise<boolean>`, mirroring
`sendInitialEmail`:
- Sends `checkin_link` with `{1: guestName, 2: checkIn, 3: checkOut, 4: confirmationToken}`.
- On success: stamps a new `Reservation.confirmationWhatsappSentAt DateTime?` and records a
  new `INITIAL_WHATSAPP_SENT` reservation event.
- On failure: records `INITIAL_WHATSAPP_FAILED` (with a reason note). No staff alert email —
  same "log it, never block" handling as the reminders.

Automatic triggers — whenever the new reservation has a `guestPhone`, fire-and-forget like
the email (`void this.sendInitialWhatsapp(...)`), independent of whether there's an email:
- `ReservationsService.create` (manual creation by staff).
- `ChannelImportService.import`, on the create path only (not on updates of an existing
  imported reservation).

Not triggered when a guest enters/changes their phone inside the check-in flow
(`PublicReservationsService.confirmDates`) — they're already on the link — nor when staff
later edit a reservation to add a phone (they use the button).

Staff trigger: `POST /reservations/:id/send-initial-whatsapp` →
`{ sent: boolean, reservation }`, same shape as `resend-initial-email`. 400 if the
reservation has no `guestPhone`. Always attempts the send, even if one already succeeded.

### Reminders

`WhatsappReminderSchedulerService` switches both reminders to `sendTemplate`:
- Reservation reminder → `reservation_reminder` with `{1 guestName, 2 checkIn, 3 checkOut,
  4 confirmationToken}`.
- Deposit reminder → `deposit_reminder` with `{1 guestName, 2 checkIn, 3 confirmationToken}`.

Query, scheduling and `*SentAt` stamping are unchanged.

`Settings.reservationReminderWhatsappTemplate` and `Settings.depositReminderWhatsappTemplate`
are removed (Prisma migration drops both columns; DTO, service defaults and settings tests
updated). Their wording now lives in Twilio; the fallback texts are constants in the
scheduler.

## Admin web

- Reservation page (`ReservationFormPage`): an "Enviar link por WhatsApp" button next to the
  existing email resend, shown only when the reservation has a phone. Same loading/error
  pattern as `handleResendInitialEmail`; on `sent: false` shows "El WhatsApp no pudo
  enviarse. Revisá el historial de eventos para más detalles." If
  `confirmationWhatsappSentAt` is set, it shows when the link was last sent.
- The reservation event history gets Spanish labels for the two new event types.
- Settings > Recordatorios de WhatsApp: the two text boxes are removed; the day-offset
  settings stay, plus a note that the message wording is managed as approved templates in
  Twilio.

## Error handling

Unchanged philosophy: WhatsApp is strictly additional and never blocks anything. Every send
path returns a boolean; failures are logged and (for the check-in link) recorded as a
reservation event. A missing/invalid template SID behaves like any other Twilio API error.

## Testing

- `phone-normalizer.spec.ts`: existing Argentine cases unchanged, plus valid foreign numbers
  (`+1 …`, `+52 …`, `+34 …`) → E.164, invalid foreign → `null`, `+54` still Argentine rules.
- `whatsapp.service.spec.ts`: template path sends `contentSid` + stringified
  `contentVariables` and no `body`; no-SID path sends `fallbackBody`; failures → `false`.
- `reservations.service.spec.ts`: `sendInitialWhatsapp` stamps + records on success, records
  failure without stamping; `create` triggers it only when `guestPhone` is set.
- `channel-import.service.spec.ts`: create path with a phone triggers it; update path
  doesn't.
- `whatsapp-reminder.scheduler.spec.ts`: both reminders send their template SID and
  variables.
- Settings unit + e2e tests updated for the removed fields.
- e2e: `POST /reservations/:id/send-initial-whatsapp` — 200 with `sent`, 400 without phone,
  401 unauthenticated.
- admin-web: button shown only with a phone; calls the endpoint; shows the failure message.
- Manual: one real send of each template to the owner's phone once the sender number is live
  (or the Sandbox before that).
