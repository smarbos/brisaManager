import { Injectable, Logger } from '@nestjs/common';
import { OutboundEmail } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { renderTemplate } from '../common/render-template';
import { escapeHtmlVars } from '../common/escape-html';
import { EmailOutboxService } from './email-outbox.service';
import { buildAlert } from './email-alert';

function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

// Renders each kind of email and queues it in the outbox — nothing is sent from here. Every
// email waits EMAIL_SEND_DELAY_MS (5 minutes by default) and can be aborted from the admin
// before EmailDispatcherService sends it; debug-mode redirection and failure handling happen at
// send time, in EmailSenderService. See docs/superpowers/specs/2026-10-01-email-outbox-design.md.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly outbox: EmailOutboxService,
  ) {}

  // Guest replies come back to the inbound address, which Resend forwards to staff (see
  // ResendWebhooksController). Decided when the email is queued, so the admin preview shows
  // exactly what goes out.
  private replyTo(): string | null {
    return process.env.EMAIL_INBOUND_ADDRESS || null;
  }

  // guestName/confirmationUrl are the only variables this template supports.
  async sendInitialConfirmationEmail(
    to: string,
    guestName: string,
    confirmationUrl: string,
    reservationId?: string,
  ): Promise<OutboundEmail> {
    const settings = await this.settingsService.get();
    return this.outbox.enqueue({
      kind: 'INITIAL_CONFIRMATION',
      to,
      subject: 'Confirmá tu reserva en La Brisa de Mar del Plata',
      html: renderTemplate(settings.initialEmailTemplate, escapeHtmlVars({ guestName, confirmationUrl })),
      replyTo: this.replyTo(),
      reservationId,
    });
  }

  // guestName/propertyAddress/googleMapsUrl/confirmationUrl are the only variables this
  // template supports. propertyAddress/googleMapsUrl come from Settings; confirmationUrl is the
  // guest's own check-in page link, so they can get back to it after the stay is confirmed.
  async sendFinalConfirmationEmail(
    to: string,
    guestName: string,
    confirmationUrl: string,
    reservationId?: string,
  ): Promise<OutboundEmail> {
    const settings = await this.settingsService.get();
    return this.outbox.enqueue({
      kind: 'FINAL_CONFIRMATION',
      to,
      subject: '¡Tu reserva está confirmada!',
      html: renderTemplate(
        settings.finalEmailTemplate,
        escapeHtmlVars({
          guestName,
          propertyAddress: settings.propertyAddress,
          googleMapsUrl: settings.googleMapsUrl,
          confirmationUrl,
        }),
      ),
      replyTo: this.replyTo(),
      reservationId,
    });
  }

  // guestName/checkIn/checkOut are the only variables this template supports. Dates are
  // formatted DD/MM/YYYY (en-GB, pinned to UTC) to match the rest of this app's guest-facing
  // date formatting — checkIn/checkOut are stored as UTC midnight.
  async sendCancellationEmail(
    to: string,
    guestName: string,
    checkIn: Date,
    checkOut: Date,
    reservationId?: string,
  ): Promise<OutboundEmail> {
    const settings = await this.settingsService.get();
    return this.outbox.enqueue({
      kind: 'CANCELLATION',
      to,
      subject: 'Tu reserva fue cancelada',
      html: renderTemplate(
        settings.cancellationEmailTemplate,
        escapeHtmlVars({ guestName, checkIn: formatDateOnly(checkIn), checkOut: formatDateOnly(checkOut) }),
      ),
      replyTo: this.replyTo(),
      reservationId,
    });
  }

  sendMarketingEmail(to: string, subject: string, html: string, campaignRecipientId?: string): Promise<OutboundEmail> {
    return this.outbox.enqueue({
      kind: 'MARKETING',
      to,
      subject,
      html,
      replyTo: this.replyTo(),
      campaignRecipientId,
    });
  }

  // Never throws — alerts are called from failure paths that must not fail themselves.
  async sendAlert(subject: string, message: string): Promise<void> {
    const alert = buildAlert(subject, message);
    if (!alert) {
      return;
    }
    try {
      await this.outbox.enqueue({ kind: 'ALERT', ...alert });
    } catch (error) {
      this.logger.error(`Failed to queue alert email: ${(error as Error).message}`);
    }
  }
}
