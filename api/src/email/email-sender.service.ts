import { Injectable, Logger } from '@nestjs/common';
import { OutboundEmail, OutboundEmailKind, Prisma, ReservationEventType } from '@prisma/client';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationEventsService } from '../reservation-events/reservation-events.service';
import { buildAlert } from './email-alert';
import { sendDelayMs } from './email-outbox.service';

const DEFAULT_DEBUG_RECIPIENT = 'damian.mantuano@gmail.com';

type Outcome = 'SENT' | 'FAILED' | 'ABORTED';

// Per reservation email kind: the timestamp stamped when it actually goes out, and the
// reservation events recorded for each outcome.
const RESERVATION_EFFECTS: Partial<
  Record<
    OutboundEmailKind,
    {
      sentAtField: 'confirmationEmailSentAt' | 'finalConfirmationEmailSentAt' | 'cancellationEmailSentAt';
      events: Record<Outcome, ReservationEventType>;
      alertSubject: string;
    }
  >
> = {
  INITIAL_CONFIRMATION: {
    sentAtField: 'confirmationEmailSentAt',
    events: { SENT: 'INITIAL_EMAIL_SENT', FAILED: 'INITIAL_EMAIL_FAILED', ABORTED: 'INITIAL_EMAIL_ABORTED' },
    alertSubject: 'Falló el email de confirmación inicial',
  },
  FINAL_CONFIRMATION: {
    sentAtField: 'finalConfirmationEmailSentAt',
    events: { SENT: 'FINAL_EMAIL_SENT', FAILED: 'FINAL_EMAIL_FAILED', ABORTED: 'FINAL_EMAIL_ABORTED' },
    alertSubject: 'Falló el email de confirmación final',
  },
  CANCELLATION: {
    sentAtField: 'cancellationEmailSentAt',
    events: { SENT: 'CANCELLATION_EMAIL_SENT', FAILED: 'CANCELLATION_EMAIL_FAILED', ABORTED: 'CANCELLATION_EMAIL_ABORTED' },
    alertSubject: 'Falló el email de cancelación',
  },
};

// Performs one send of an outbox entry — debug redirection, Resend call, result — and then
// applies its effects (reservation timestamps/events, campaign recipient status, staff alert on
// a failed guest email). Used by EmailDispatcherService for due entries and by
// EmailOutboxService.retry(). Never throws: every outcome is recorded on the entry.
@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: ReservationEventsService,
  ) {}

  // The entry must already be claimed (status SENDING) by the caller.
  async send(entry: OutboundEmail): Promise<OutboundEmail> {
    // Read at send time, not when the entry was queued: what matters is the mode the API is in
    // when the email actually leaves.
    const debugMode = process.env.DEBUG_MODE === 'true';
    const sentTo = debugMode ? process.env.EMAIL_DEBUG_RECIPIENT || DEFAULT_DEBUG_RECIPIENT : entry.to;
    const from = process.env.EMAIL_FROM as string;

    // Same key for the same attempt, so if Resend got a request whose response we never saw, a
    // repeat of that exact attempt is dropped on Resend's side instead of sent twice.
    const requestOptions = { idempotencyKey: `outbound-email-${entry.id}-${entry.attempts}` };

    // Only Resend's own answer decides SENT vs FAILED. A failure to *record* a successful send
    // (e.g. the database blipped) must not be written as FAILED — that would invite a retry and a
    // duplicate email — so the entry is left SENDING ("may already have gone out").
    let resendId: string | null;
    try {
      const { data, error } =
        entry.kind === 'INBOUND_FORWARD'
          ? await this.resend.emails.receiving.forward(
              { emailId: entry.inboundEmailId as string, to: sentTo, from, passthrough: true },
              requestOptions,
            )
          : await this.resend.emails.send(
              {
                from,
                to: sentTo,
                subject: debugMode ? `[DEBUG → ${entry.to}] ${entry.subject}` : entry.subject,
                html: entry.html,
                ...(entry.replyTo ? { replyTo: entry.replyTo } : {}),
              },
              requestOptions,
            );
      if (error) {
        return this.markFailed(entry, sentTo, error.message);
      }
      resendId = data?.id ?? null;
    } catch (error) {
      return this.markFailed(entry, sentTo, (error as Error).message);
    }

    let sent: OutboundEmail;
    try {
      sent = await this.prisma.outboundEmail.update({
        where: { id: entry.id },
        data: { status: 'SENT', sentAt: new Date(), sentTo, resendId, lastError: null, attempts: { increment: 1 } },
      });
    } catch (error) {
      this.logger.error(
        `Email ${entry.id} (${entry.kind}) was sent but recording it failed — left SENDING: ${(error as Error).message}`,
      );
      return entry;
    }
    await this.applyEffects(sent, 'SENT');
    return sent;
  }

  private async markFailed(entry: OutboundEmail, sentTo: string, message: string): Promise<OutboundEmail> {
    this.logger.error(`Email ${entry.id} (${entry.kind}) failed: ${message}`);
    try {
      const failed = await this.prisma.outboundEmail.update({
        where: { id: entry.id },
        data: { status: 'FAILED', sentTo, lastError: message, attempts: { increment: 1 } },
      });
      await this.applyEffects(failed, 'FAILED');
      return failed;
    } catch (error) {
      this.logger.error(`Recording the failure of email ${entry.id} failed: ${(error as Error).message}`);
      return entry;
    }
  }

  // Never throws: an effect failing (e.g. the reservation was deleted) is logged and doesn't
  // change what happened to the email itself.
  async applyEffects(entry: OutboundEmail, outcome: Outcome): Promise<void> {
    try {
      const reservationEffects = RESERVATION_EFFECTS[entry.kind];
      if (reservationEffects && entry.reservationId) {
        if (outcome === 'SENT') {
          await this.prisma.reservation.update({
            where: { id: entry.reservationId },
            data: { [reservationEffects.sentAtField]: new Date() } as Prisma.ReservationUpdateInput,
          });
          await this.eventsService.record(entry.reservationId, reservationEffects.events.SENT);
        } else if (outcome === 'FAILED') {
          await this.eventsService.record(entry.reservationId, reservationEffects.events.FAILED, entry.lastError ?? undefined);
        } else {
          await this.eventsService.record(entry.reservationId, reservationEffects.events.ABORTED);
        }
      }

      if (entry.kind === 'MARKETING' && entry.campaignRecipientId) {
        await this.prisma.campaignRecipient.update({
          where: { id: entry.campaignRecipientId },
          data: { status: outcome, error: outcome === 'FAILED' ? entry.lastError : null },
        });
      }

      // A staff alert for a failed guest email — never for a failed ALERT or INBOUND_FORWARD,
      // which would loop.
      if (outcome === 'FAILED' && reservationEffects) {
        await this.queueAlert(
          reservationEffects.alertSubject,
          `El email a ${entry.to}${entry.reservationId ? ` (reserva ${entry.reservationId})` : ''} no se pudo enviar: ${entry.lastError}`,
        );
      }
    } catch (error) {
      this.logger.error(`Effects for email ${entry.id} (${entry.kind}, ${outcome}) failed: ${(error as Error).message}`);
    }
  }

  // Created directly (not via EmailOutboxService, which depends on this service) with the same
  // delay rule, so the alert can be aborted like any other email.
  private async queueAlert(subject: string, message: string): Promise<void> {
    const alert = buildAlert(subject, message);
    if (!alert) {
      return;
    }
    await this.prisma.outboundEmail.create({
      data: { kind: 'ALERT', ...alert, sendAt: new Date(Date.now() + sendDelayMs()) },
    });
  }
}
