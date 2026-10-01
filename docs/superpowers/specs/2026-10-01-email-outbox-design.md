# Design: Email Outbox (5-minute delay, abort/retry/resend) and Inbound Forwarding

## Context

Every email the API sends today goes straight to Resend at the moment it's triggered, from
`EmailService` (`api/src/email/email.service.ts`):

| Kind | Method | Triggered from |
|---|---|---|
| Initial confirmation (guest link) | `sendInitialConfirmationEmail` | `ReservationsService.sendInitialEmail` (manual create, channel import, staff resend) |
| Final confirmation | `sendFinalConfirmationEmail` | `ReservationConfirmationService.sendFinalEmail` (auto-confirm, staff resend) |
| Cancellation | `sendCancellationEmail` | `ReservationsService.sendCancellationEmail` (cancel, staff resend) |
| Marketing | `sendMarketingEmail` | `CampaignsService.send` (one per recipient, 600ms apart) |
| Staff alert | `sendAlert` | failure paths in reservations, reservation-confirmation, channel-sync |

Callers `await` the send and immediately record the outcome: `confirmationEmailSentAt` /
`finalConfirmationEmailSentAt` / `cancellationEmailSentAt`, reservation events
(`INITIAL_EMAIL_SENT`/`_FAILED`, `FINAL_EMAIL_*`, `CANCELLATION_EMAIL_*`), a staff alert on
failure, and `CampaignRecipient.status` (`SENT`/`FAILED`). There's no way to stop an email
once triggered, and nothing receives mail.

## Goals

1. Every outgoing email waits **5 minutes** between creation and sending — guest emails,
   campaigns and staff alerts alike.
2. The operator can **abort** a waiting email, **retry** a failed one, and **resend** an
   aborted, sent or failed one.
3. With debug mode on, every email goes to **damian.mantuano@gmail.com** instead of its real
   recipient.
4. **Receive** email with Resend and **forward** it immediately to a staff mailbox.

Out of scope: storing or showing inbound emails in La Brisa, replying from the admin,
delivery/bounce tracking via Resend webhooks (only `email.received` is handled).

## Outbox

### Data model

New Prisma model `OutboundEmail` and enums:

```prisma
enum OutboundEmailKind {
  INITIAL_CONFIRMATION
  FINAL_CONFIRMATION
  CANCELLATION
  MARKETING
  ALERT
  INBOUND_FORWARD
}

enum OutboundEmailStatus {
  SCHEDULED
  SENDING
  SENT
  FAILED
  ABORTED
}

model OutboundEmail {
  id                  String              @id @default(uuid())
  kind                OutboundEmailKind
  status              OutboundEmailStatus @default(SCHEDULED)
  to                  String              // the real recipient
  sentTo              String?             // where it actually went (differs in debug mode)
  subject             String
  html                String              @default("")
  replyTo             String?
  inboundEmailId      String?             // INBOUND_FORWARD: Resend's received-email id
  sendAt              DateTime
  sentAt              DateTime?
  abortedAt           DateTime?
  attempts            Int                 @default(0)
  lastError           String?
  resendId            String?             // Resend's id for the sent email
  reservationId       String?
  reservation         Reservation?        @relation(fields: [reservationId], references: [id])
  campaignRecipientId String?             @unique
  campaignRecipient   CampaignRecipient?  @relation(fields: [campaignRecipientId], references: [id])
  resentFromId        String?             // the entry this one is a re-send of
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  @@index([status, sendAt])
  @@index([reservationId])
}
```

`CampaignRecipientStatus` gains `SCHEDULED` and `ABORTED`.

Content (subject, HTML) is **rendered when the entry is created**, so what the operator can
abort is exactly what would go out; a later Settings template edit doesn't change a waiting
email. The real recipient is stored; debug redirection happens at send time (below).

### Lifecycle

```
SCHEDULED ──(sendAt reached, claimed)──▶ SENDING ──▶ SENT
    │                                        └──────▶ FAILED ──(retry)──▶ SENDING
    └──(abort)──▶ ABORTED
ABORTED / SENT / FAILED ──(resend)──▶ new SCHEDULED entry, sendAt = now + 5 min, resentFromId set
```

- **Queue** (`EmailOutboxService.enqueue(...)`): creates a `SCHEDULED` entry with
  `sendAt = now + EMAIL_SEND_DELAY_MS` (default 300 000 = 5 minutes; configurable so tests and
  local dev can shorten it). `INBOUND_FORWARD` entries use `sendAt = now` and are sent right
  away (see Inbound).
- **Dispatch** (`EmailDispatcherService`, `@Cron` every 30 seconds): loads due `SCHEDULED`
  entries (oldest first, up to 20 per tick) and, one at a time, **claims** each with a
  conditional update (`status: SCHEDULED → SENDING` where `id = … AND status = SCHEDULED`); only
  the caller whose update changed a row sends it, so an entry is never sent twice (concurrent
  ticks, an abort racing the send). Sends are 600ms apart to stay under Resend's ~2 req/s
  limit. A tick that's still running when the next one fires is skipped.
- **Abort**: `SCHEDULED → ABORTED` (conditional; 409 if it's no longer waiting).
- **Retry**: `FAILED → SENDING`, sent immediately by the same send routine (409 otherwise).
- **Resend**: `ABORTED | SENT | FAILED` → a new `SCHEDULED` entry copying kind, recipient,
  subject, HTML, Reply-To and links, `sendAt = now + 5 min`, `resentFromId` = original.

An entry stuck in `SENDING` (process crashed mid-send) is left as-is and shown in the admin;
it's not auto-retried, since the email may already have gone out.

### Sending

One routine for both dispatch and retry:

- **Recipient**: with `DEBUG_MODE=true`, `sentTo` = `EMAIL_DEBUG_RECIPIENT`, defaulting to
  `damian.mantuano@gmail.com`, and the subject is prefixed `[DEBUG → <real to>]`; otherwise
  `sentTo = to`.
- **Reply-To**: every outgoing email except `INBOUND_FORWARD` gets
  `replyTo = EMAIL_INBOUND_ADDRESS` (when set), so guest replies come back through Inbound.
- **Resend call**: `resend.emails.send({ from: EMAIL_FROM, to: sentTo, subject, html, replyTo })`;
  for `INBOUND_FORWARD`, `resend.emails.receiving.forward({ emailId: inboundEmailId,
  to: sentTo, from: EMAIL_FROM, passthrough: true })` (original content and attachments).
- **Result**: success → `SENT`, `sentAt`, `resendId`, `attempts + 1`; error → `FAILED`,
  `lastError`, `attempts + 1`. Then the **effects** below run. A failure inside an effect is
  logged, never undoes the send result.

### Effects (moved from the callers to "when it actually sends")

| Kind | On SENT | On FAILED | On ABORTED |
|---|---|---|---|
| INITIAL_CONFIRMATION | `confirmationEmailSentAt = now`, event `INITIAL_EMAIL_SENT` | event `INITIAL_EMAIL_FAILED` (error), staff alert | event `INITIAL_EMAIL_ABORTED` |
| FINAL_CONFIRMATION | `finalConfirmationEmailSentAt = now`, event `FINAL_EMAIL_SENT` | event `FINAL_EMAIL_FAILED`, staff alert | event `FINAL_EMAIL_ABORTED` |
| CANCELLATION | `cancellationEmailSentAt = now`, event `CANCELLATION_EMAIL_SENT` | event `CANCELLATION_EMAIL_FAILED`, staff alert | event `CANCELLATION_EMAIL_ABORTED` |
| MARKETING | recipient `SENT` | recipient `FAILED` + error | recipient `ABORTED` |
| ALERT, INBOUND_FORWARD | — | — (an alert about a failed alert would loop) | — |

New `ReservationEventType` values: `INITIAL_EMAIL_QUEUED`, `FINAL_EMAIL_QUEUED`,
`CANCELLATION_EMAIL_QUEUED`, `INITIAL_EMAIL_ABORTED`, `FINAL_EMAIL_ABORTED`,
`CANCELLATION_EMAIL_ABORTED`.

The staff alert on a failed guest email is itself an outbox `ALERT` entry (also 5 minutes).

### Changes to the existing callers

- `EmailService` keeps its public methods and signatures, but each now renders the content and
  **enqueues** it (returning the entry) instead of calling Resend. It gains optional link
  parameters (`reservationId`, `campaignRecipientId`) where relevant. All Resend calls move to
  the sender.
- `ReservationsService.sendInitialEmail` / `sendCancellationEmail` and
  `ReservationConfirmationService.sendFinalEmail`: enqueue, record the `*_QUEUED` event, return
  `true`. They no longer stamp `*SentAt`, record `*_SENT`/`_FAILED`, or alert — the effects do.
  Rendering errors (e.g. Settings unavailable) still surface as today: `*_FAILED` event, alert,
  `false`.
- Existing "resend" endpoints (`resend-initial-email`, `resend-final-email`,
  `resend-cancellation-email`) keep their routes and `{ sent, reservation }` response; `sent`
  now means "queued". The admin's success copy changes to "Se envía en 5 minutos" (button
  results), and the reservation page's email rows show "Programado para las HH:MM" while an
  entry is waiting.
- `CampaignsService.send`: creates each `CampaignRecipient` as `SCHEDULED` and enqueues its
  email (no 600ms sleeps here — the dispatcher paces sends). Campaign history shows the new
  statuses.
- `sendAlert`: enqueues an `ALERT` entry to `ALERT_EMAIL` (unchanged recipient logic).
- The deposit reminder keys on `confirmationEmailSentAt`, which now means "actually sent" —
  the intended meaning; no change needed there.

## Inbound

- Resend receives mail for the address/domain configured in Resend (an MX record on a domain or
  subdomain the owner chooses), and calls `POST /webhooks/resend` with an `email.received`
  event.
- The endpoint is public but **signature-verified**: `resend.webhooks.verify({ payload: rawBody,
  headers: { id, timestamp, signature }, webhookSecret: RESEND_WEBHOOK_SECRET })` using the
  `svix-id`/`svix-timestamp`/`svix-signature` headers. Invalid or missing signature → 401.
  Requires the raw request body (`NestFactory.create(..., { rawBody: true })`).
- On `email.received`: create an `INBOUND_FORWARD` entry (`to = EMAIL_FORWARD_TO`,
  `subject = "Fwd: <subject> (de <from>)"` for the admin list, `inboundEmailId = email_id`,
  `sendAt = now`) and send it immediately through the same routine. Any other event type → 200,
  ignored. Idempotent: a repeated webhook delivery for an `email_id` that already has an entry
  creates nothing new. A failed forward stays `FAILED` and can be retried from the admin.
- If `EMAIL_FORWARD_TO` isn't set, the webhook responds 200 and logs a warning (nothing to
  forward to).

## Configuration

| Env var | Meaning |
|---|---|
| `EMAIL_SEND_DELAY_MS` | Delay before sending (default `300000`) |
| `EMAIL_DEBUG_RECIPIENT` | Debug-mode recipient (default `damian.mantuano@gmail.com`) |
| `EMAIL_INBOUND_ADDRESS` | Address Resend receives on; used as Reply-To on outgoing emails (optional) |
| `EMAIL_FORWARD_TO` | Staff mailbox inbound emails are forwarded to |
| `RESEND_WEBHOOK_SECRET` | Signing secret of the Resend webhook |

Owner setup (not code): MX record for the receiving domain, the `email.received` webhook in
Resend pointing at `https://api.labrisa.com.ar/webhooks/resend`, and the env values.

## Admin

- **API** (JWT-protected): `GET /outbound-emails?status=&reservationId=` (newest first, paged
  50), `GET /outbound-emails/:id` (includes HTML), `POST /outbound-emails/:id/abort`,
  `POST /outbound-emails/:id/retry`, `POST /outbound-emails/:id/resend`.
- **"Emails" page** (new sidebar entry): status filter (Todos, Programados, Enviados, Fallidos,
  Abortados), table with created time, "sends in m:ss" countdown or sent time, kind, recipient
  (plus debug target), subject, reservation link, status badge, and per-row actions —
  **Abortar** (Programado), **Reintentar** (Falló), **Reenviar** (Abortado/Enviado/Falló). A row
  opens a preview of the email (HTML in a sandboxed iframe) and its error, if any. Auto-refreshes
  every 15 seconds.
- **Reservation page**: an "Emails" section listing that reservation's entries with the same
  actions (shared component).

## Error handling

- The dispatcher never throws out of a tick; each entry's failure is recorded on that entry.
- Abort/retry/resend on an entry in the wrong state → 409 with a Spanish message the admin shows.
- Unknown id → 404.

## Testing

- `EmailOutboxService` unit: enqueue sets `sendAt` from the delay; abort/retry/resend state
  rules and 409s; resend copies content and links.
- Sender/dispatcher unit: claims only `SCHEDULED` due entries; a lost claim doesn't send; debug
  redirection and subject prefix; Reply-To; forward via `receiving.forward`; effects per kind
  and outcome; no alert for a failed alert; tick overlap guard.
- Existing caller specs updated (reservations, reservation-confirmation, campaigns, channel-sync).
- E2E: outbound-emails endpoints (list/abort/retry/resend, 401, 404, 409); webhook signature
  (valid → forward entry created, invalid → 401, duplicate delivery → one entry). Resend itself
  is always stubbed.
- admin-web: Emails page (filters, actions, countdown, errors), reservation page section.
