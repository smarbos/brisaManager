# Email Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every outgoing email waits 5 minutes in an outbox the operator can abort/retry/resend from; debug mode redirects to damian.mantuano@gmail.com; inbound email received by Resend is forwarded immediately to a staff mailbox.

**Architecture:** A new `OutboundEmail` table. `EmailOutboxService` creates and transitions entries, `EmailSenderService` performs one send (debug redirect, Reply-To, Resend send / receiving.forward) and applies per-kind effects (reservation `*SentAt` + events, campaign recipient status, staff alert on failure), `EmailDispatcherService` is a 30s cron that claims due entries. `EmailService` keeps its method signatures but enqueues instead of sending. A signature-verified `POST /webhooks/resend` forwards `email.received`. Admin gets an "Emails" page and a per-reservation section.

**Tech Stack:** NestJS 11, Prisma/PostgreSQL, `resend` 6.28 (`emails.send`, `emails.receiving.forward`, `webhooks.verify`), `@nestjs/schedule`, Jest + Supertest; React + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-email-outbox-design.md`

## Global Constraints

- Delay: `EMAIL_SEND_DELAY_MS`, default `300000`. Debug recipient: `EMAIL_DEBUG_RECIPIENT`, default `damian.mantuano@gmail.com`; debug subject prefix `[DEBUG → <real to>] `.
- Statuses: `SCHEDULED`, `SENDING`, `SENT`, `FAILED`, `ABORTED`. Kinds: `INITIAL_CONFIRMATION`, `FINAL_CONFIRMATION`, `CANCELLATION`, `MARKETING`, `ALERT`, `INBOUND_FORWARD`.
- Abort only from `SCHEDULED`; retry only from `FAILED`; resend only from `ABORTED|SENT|FAILED`; wrong state → 409, unknown id → 404.
- Dispatcher: every 30s, ≤20 due entries per tick, 600ms between sends, skip a tick while the previous one runs; claim = conditional `SCHEDULED → SENDING`.
- No alert is enqueued for a failed `ALERT` or `INBOUND_FORWARD`.
- Resend is always stubbed in tests — no test may reach the network.
- Work only in the worktree `/home/smarbos/dev/brisaManager-email` (branch `email-outbox`); the main checkout has another agent's uncommitted work. API tests run via the scratchpad `wt-api.sh` (API image, worktree mounted, separate `brisa_email` database); admin-web tests via `wt-admin.sh`.
- Per `CLAUDE.md`: bump `api/package.json` (now `0.0.13`) and `admin-web/package.json` (now `0.1.5`) patch versions in commits touching them.
- Staff-facing copy in Spanish (Argentina).

## Review Focus

1. **Double send** — two dispatcher ticks or an abort racing the dispatcher. Expected: the conditional claim lets exactly one actor transition; a lost claim never calls Resend. Pinned in Task 4.
2. **Debug mode leaking to real guests** — Expected: with `DEBUG_MODE=true` every path (send, retry, forward) goes to the debug recipient. Pinned in Task 3.
3. **Callers relying on immediate "sent" semantics** — `confirmationEmailSentAt` (deposit reminder), `resend-*` endpoint responses, auto-confirm flow. Expected: stamped only on actual send. Pinned in Tasks 3 and 5.
4. **Webhook forgery / replay** — Expected: missing/invalid signature → 401; duplicate `email_id` → one entry. Pinned in Task 7.
5. **Alert loops** — a failing alert must not enqueue another alert. Pinned in Task 3.

---

### Task 1: Schema and migration

**Files:** `api/prisma/schema.prisma`; create `api/prisma/migrations/20261001120000_add_outbound_email/migration.sql`.

- [ ] Add enums `OutboundEmailKind`, `OutboundEmailStatus` and model `OutboundEmail` exactly as in the spec's Data model; add back-relations `outboundEmails OutboundEmail[]` on `Reservation` and `outboundEmail OutboundEmail?` on `CampaignRecipient`.
- [ ] `CampaignRecipientStatus` += `SCHEDULED`, `ABORTED`. `ReservationEventType` += `INITIAL_EMAIL_QUEUED`, `FINAL_EMAIL_QUEUED`, `CANCELLATION_EMAIL_QUEUED`, `INITIAL_EMAIL_ABORTED`, `FINAL_EMAIL_ABORTED`, `CANCELLATION_EMAIL_ABORTED`.
- [ ] Generate the SQL with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <brisa_email_shadow> --script` (or hand-write), apply with `migrate deploy`, then verify `migrate diff --from-schema-datasource … --to-schema-datamodel …` prints "No difference detected."
- [ ] Commit (api version → 0.0.14).

### Task 2: EmailOutboxService

**Files:** create `api/src/email/email-outbox.service.ts`, `email-outbox.service.spec.ts`.

**Interfaces (produced):**
```ts
type EnqueueInput = { kind: OutboundEmailKind; to: string; subject: string; html?: string; replyTo?: string | null;
  reservationId?: string | null; campaignRecipientId?: string | null; inboundEmailId?: string | null;
  sendAt?: Date; resentFromId?: string | null };
enqueue(input: EnqueueInput): Promise<OutboundEmail>          // sendAt default now + delay
abort(id: string): Promise<OutboundEmail>                       // 404 / 409; runs sender.applyEffects(entry,'ABORTED')
resend(id: string): Promise<OutboundEmail>                      // 404 / 409; new SCHEDULED copy
retry(id: string): Promise<OutboundEmail>                       // 404 / 409; claims FAILED→SENDING then sender.send(entry)
list(filter: { status?: OutboundEmailStatus; reservationId?: string; page?: number }): Promise<OutboundEmail[]>
get(id: string): Promise<OutboundEmail>                         // 404
sendDelayMs(): number
```
Uses `PrismaService`, `EmailSenderService` (Task 3; inject with `forwardRef` if needed).

- [ ] Tests: enqueue default and explicit sendAt; abort from SCHEDULED (conditional updateMany count 1) and 409 when count 0, 404 unknown; resend copies kind/to/subject/html/replyTo/reservationId/inboundEmailId, sets resentFromId, new sendAt, and 409 from SCHEDULED/SENDING (campaignRecipientId is NOT copied — it's unique; the copy carries no campaign link); retry calls sender.send after a successful FAILED→SENDING claim, 409 otherwise; list filters and orders by createdAt desc, take 50.
- [ ] Implement, green, commit.

### Task 3: EmailSenderService (send + effects)

**Files:** create `api/src/email/email-sender.service.ts`, `email-sender.service.spec.ts`.

**Interfaces:**
```ts
send(entry: OutboundEmail): Promise<OutboundEmail>   // entry must already be SENDING; never throws
applyEffects(entry: OutboundEmail, outcome: 'SENT' | 'FAILED' | 'ABORTED'): Promise<void>  // never throws
```
Depends on `PrismaService`, `ReservationEventsService`, and enqueues alerts via `prisma.outboundEmail.create` directly (to avoid a cycle with EmailOutboxService) using the same delay rule.

- [ ] Tests: normal send calls `resend.emails.send({from,to,subject,html,replyTo})`, marks SENT with sentAt/resendId/sentTo/attempts; Resend error → FAILED with lastError; thrown error → FAILED; debug mode → sentTo = default debug address and subject prefixed (and env override respected); Reply-To = EMAIL_INBOUND_ADDRESS when set, omitted otherwise, never on INBOUND_FORWARD; INBOUND_FORWARD uses `emails.receiving.forward({emailId,to,from,passthrough:true})` and also respects debug; effects table per kind (SENT stamps the reservation field + event; FAILED records event with error and enqueues an ALERT; ABORTED records the *_ABORTED event; MARKETING updates the CampaignRecipient status/error); no alert enqueued for ALERT/INBOUND_FORWARD failures; an effect that throws is logged and doesn't change the send result.
- [ ] Implement, green, commit.

### Task 4: EmailDispatcherService

**Files:** create `api/src/email/email-dispatcher.service.ts`, spec; register all three services in `EmailModule`.

```ts
@Cron(CronExpression.EVERY_30_SECONDS) tick(): Promise<void>   // never throws
```
- [ ] Tests: loads due SCHEDULED (sendAt ≤ now, oldest first, take 20); claims each with updateMany(SCHEDULED→SENDING) and only sends when count is 1; lost claim doesn't send; overlapping tick returns immediately; one entry's failure doesn't stop the rest; pacing delay is injectable (0 in tests).
- [ ] Implement, green, commit.

### Task 5: Move EmailService and callers onto the outbox

**Files:** `api/src/email/email.service.ts` (+spec), `api/src/reservations/reservations.service.ts` (+spec), `api/src/reservation-confirmation/reservation-confirmation.service.ts` (+spec), `api/src/campaigns/campaigns.service.ts` (+spec, `api/test/campaigns.e2e-spec.ts`), any e2e that asserted immediate `*SentAt`/`*_SENT`.

- `EmailService.sendInitialConfirmationEmail(to, guestName, url, reservationId?)`, `sendFinalConfirmationEmail(…, reservationId?)`, `sendCancellationEmail(…, reservationId?)`, `sendMarketingEmail(to, subject, html, campaignRecipientId?)`, `sendAlert(subject, message)` — render as today, then `outbox.enqueue(...)`; return the entry (alerts: never throw).
- `sendInitialEmail` / `sendCancellationEmail` / `sendFinalEmail`: enqueue with reservationId, record `*_QUEUED`, return true; on render/enqueue error keep today's `*_FAILED` event + alert + false. Remove the immediate `*SentAt` stamps and `*_SENT` events.
- `CampaignsService.send`: create the Campaign with recipients `SCHEDULED`, then enqueue each recipient's email with its id; drop the 600ms sleep.
- [ ] Update tests first to the new contract (watch them fail), implement, run full unit suite + affected e2e, commit.

### Task 6: Outbound emails API

**Files:** create `api/src/email/outbound-emails.controller.ts`, `dto/list-outbound-emails.dto.ts`, `api/test/outbound-emails.e2e-spec.ts`.

- [ ] Routes (JwtAuthGuard): `GET /outbound-emails` (status?, reservationId?, page?), `GET /outbound-emails/:id`, `POST /outbound-emails/:id/abort|retry|resend`.
- [ ] E2E (override `EmailSenderService.send` / Resend with stubs): list + filter, abort 201 then 409, resend creates a new SCHEDULED entry, retry on FAILED, 404, 401.
- [ ] Commit.

### Task 7: Inbound webhook

**Files:** `api/src/main.ts` (`rawBody: true`), create `api/src/email/resend-webhooks.controller.ts`, `api/test/resend-webhooks.e2e-spec.ts`; e2e app setups that need rawBody create the app with `{ rawBody: true }`.

- [ ] `POST /webhooks/resend` (public): verify with `resend.webhooks.verify({ payload: req.rawBody.toString(), headers: { id, timestamp, signature }, webhookSecret })` → 401 on failure/missing secret; on `email.received`, if no entry with that `inboundEmailId` exists and `EMAIL_FORWARD_TO` is set: enqueue INBOUND_FORWARD (sendAt now), claim and send immediately; return 200 for all verified events.
- [ ] E2E: valid signature (generate with the `svix` signing scheme in the test: HMAC-SHA256 of `${id}.${timestamp}.${body}` with the base64 secret after `whsec_`) creates one entry and calls the stubbed forward; duplicate delivery → still one entry; bad signature → 401; non-received event → 200, nothing created.
- [ ] Commit.

### Task 8: Admin web

**Files:** `admin-web/src/api/outbound-emails.ts`, `admin-web/src/emails/EmailsPage.tsx` (+test), `admin-web/src/emails/OutboundEmailTable.tsx` (shared), `App.tsx` route `/emails`, `AppNav.tsx` item "Emails", `ReservationFormPage.tsx` section + resend copy, `lib/labels.ts` (kinds, statuses, new event labels), campaigns recipient status labels/tones.

- [ ] Tests: page lists entries with status filter; Abortar/Reintentar/Reenviar visible per status and call the API; countdown text for SCHEDULED; 409 error message shown; reservation page shows its emails; "Reenviar email" success shows "Se envía en 5 minutos".
- [ ] Implement, full admin suite + tsc, commit (admin-web → 0.1.6).

### Task 9: Config, docs, verification

- [ ] `.env.example`: `EMAIL_SEND_DELAY_MS`, `EMAIL_DEBUG_RECIPIENT` (comment: defaults to damian.mantuano@gmail.com), `EMAIL_INBOUND_ADDRESS`, `EMAIL_FORWARD_TO`, `RESEND_WEBHOOK_SECRET`. README env section: outbox + inbound setup (MX, webhook URL).
- [ ] Full api unit + e2e, admin suite, tsc baselines; final review.
