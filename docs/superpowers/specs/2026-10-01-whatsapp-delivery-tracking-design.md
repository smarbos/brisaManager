# Design: WhatsApp Delivery Tracking

Status: Approved and implemented
Date: 2026-10-01

## Purpose

The reservation list's warning icon should flag reservations whose WhatsApp messages didn't reach the guest. Before this, the app only knew whether Twilio *accepted* a send. A message Twilio accepted but never delivered (the number has no WhatsApp, the 24h window expired, the recipient blocked it, etc.) looked successful.

## Decisions (confirmed with the owner)

| Question | Decision |
|---|---|
| Which failures | Both **rejected at send time** and **undelivered later** (via Twilio's status callback). |
| Which messages | All three: check-in link, reservation reminder, deposit reminder. |
| When a warning clears | When a later send of the same kind succeeds (only the latest send counts), or when the message no longer matters. Never on cancelled reservations (existing rule). |
| Storage | A `WhatsappMessage` table, one row per send (chosen over columns on `Reservation` or IDs in event text). |

"No longer matters" means:
- check-in link → the guest has confirmed their dates;
- deposit reminder → the **confirmation payment** has been received. The reminder is only sent while `confirmationPaymentReceivedAt` is null, so that's what it actually chases, despite its name;
- reservation reminder → check-in has passed.

## Data model

- `enum WhatsappMessageKind { CHECKIN_LINK, RESERVATION_REMINDER, DEPOSIT_REMINDER }`
- `model WhatsappMessage`: `reservationId`, `kind`, `twilioSid` (unique, null when rejected), `status` (a Twilio MessageStatus, or our own `rejected`), `errorCode`, `errorMessage`, timestamps. Indexed on `(reservationId, kind, createdAt)`.
- `ReservationEventType.WHATSAPP_UNDELIVERED`: written once when a message becomes failed/undelivered.

The existing `confirmationWhatsappSentAt` / `reservationReminderSentAt` / `depositReminderSentAt` timestamps keep meaning "Twilio accepted it". The reminder scheduler still uses them to avoid re-sending.

## Sending

`WhatsappService.sendTemplate(phone, message, { reservationId, kind })` records the attempt through `WhatsappDeliveryService.recordSend()`:
- accepted → `twilioSid` plus Twilio's initial status;
- rejected → our reason, and Twilio's error code when there is one.

Recording is best-effort and never blocks the send. An invalid phone on the check-in link (which returns before reaching Twilio) is recorded as rejected too.

`statusCallback` is sent with each message as `${API_ORIGIN}/webhooks/twilio/whatsapp-status`, only when `API_ORIGIN` is `https://`. Local dev can't receive callbacks. No Twilio console configuration is needed.

## Status webhook

`POST /webhooks/twilio/whatsapp-status` (`TwilioWebhooksController`), no JWT:

- **Signature:** `X-Twilio-Signature` is verified with `twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, params)`, where `url` is built from `API_ORIGIN`, never from the request's `Host`. It fails closed: no https origin, no token, no signature, or a mismatch → 403, and nothing changes.
- **Body:** a plain object, with no DTO, so the global `ValidationPipe` whitelist can't strip the params the signature covers.
- **Throttling:** per IP, 200/min (module-scoped `ThrottlerModule`, the same pattern as the other machine-facing endpoints).
- **Applying a status:**
  - an unknown SID → 204, ignored;
  - statuses only move forward: `queued/accepted/scheduled` < `sending` < `sent` < `failed/undelivered/canceled` < `delivered` < `read`. Out-of-order and duplicate callbacks are no-ops;
  - the update is conditional on the status that was read, so concurrent callbacks can't double-apply;
  - a newly failed/undelivered message writes one `WHATSAPP_UNDELIVERED` event: "Link de check-in: WhatsApp no entregado (error Twilio 63016)".

## API and admin

- `GET /reservations` adds `whatsappIssues` to each reservation; `GET /reservations/:id` adds `whatsappIssues` and `whatsappMessages` (the latest per kind). One query loads all the latest messages for the list.
- `getReservationWarnings()` adds one tooltip line per issue, e.g. "El link de check-in por WhatsApp no se entregó".
- The reservation detail page shows each kind's latest status in Spanish. Twilio error codes link to `https://www.twilio.com/docs/api/errors/<code>` instead of a local translation table.

## Rollout

- One migration: `20261001030856_whatsapp_message_tracking`.
- No new env vars. Production's `API_ORIGIN` must be exactly `https://api.labrisa.com.ar` (the public URL Twilio posts to), or every callback gets a 403.
- Messages sent before the deploy have no tracking row, so their failures stay visible only in the activity log. Resending creates a tracked row.
