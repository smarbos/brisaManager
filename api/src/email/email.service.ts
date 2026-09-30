import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service';
import { renderTemplate } from '../common/render-template';
import { escapeHtml, escapeHtmlVars } from '../common/escape-html';

function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(date);
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly from = process.env.EMAIL_FROM as string;
  private readonly alertEmail = process.env.ALERT_EMAIL ?? process.env.ADMIN_SEED_EMAIL;

  // Named DEBUG_MODE rather than a bare DEBUG env var deliberately: several transitive
  // dependencies (Express included) treat a bare DEBUG env var as their own logging
  // namespace switch, which would enable unrelated verbose logging as a side effect.
  private readonly debugMode = process.env.DEBUG_MODE === 'true';
  private readonly debugRecipient = process.env.EMAIL_DEBUG_RECIPIENT;

  constructor(private readonly settingsService: SettingsService) {}

  // Redirects every outbound email to EMAIL_DEBUG_RECIPIENT when debug mode is on — for
  // testing guest-facing flows (like the reservation confirmation email) against a real
  // send pipeline without ever emailing a real guest. Falls back to the real recipient
  // (with a warning) if debug mode is on but no recipient is configured, rather than
  // silently doing nothing.
  private resolveRecipient(to: string): string {
    if (!this.debugMode) {
      return to;
    }
    if (!this.debugRecipient) {
      this.logger.warn('DEBUG_MODE is enabled but EMAIL_DEBUG_RECIPIENT is not set — sending to the real recipient.');
      return to;
    }
    return this.debugRecipient;
  }

  private subjectForDebug(subject: string, realTo: string): string {
    return this.debugMode && this.debugRecipient ? `[DEBUG → ${realTo}] ${subject}` : subject;
  }

  // guestName/confirmationUrl are the only variables this template supports.
  async sendInitialConfirmationEmail(to: string, guestName: string, confirmationUrl: string): Promise<void> {
    const settings = await this.settingsService.get();
    const html = renderTemplate(settings.initialEmailTemplate, escapeHtmlVars({ guestName, confirmationUrl }));

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: this.resolveRecipient(to),
      subject: this.subjectForDebug('Confirmá tu reserva en La Brisa de Mar del Plata', to),
      html,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  // guestName/propertyAddress/googleMapsUrl/confirmationUrl are the only variables this
  // template supports. propertyAddress/googleMapsUrl come from Settings, fetched here rather
  // than passed in by the caller; confirmationUrl is the guest's own check-in page link, same
  // one used in the initial email, so they can get back to it after the stay is confirmed.
  async sendFinalConfirmationEmail(to: string, guestName: string, confirmationUrl: string): Promise<void> {
    const settings = await this.settingsService.get();
    const html = renderTemplate(
      settings.finalEmailTemplate,
      escapeHtmlVars({
        guestName,
        propertyAddress: settings.propertyAddress,
        googleMapsUrl: settings.googleMapsUrl,
        confirmationUrl,
      }),
    );

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: this.resolveRecipient(to),
      subject: this.subjectForDebug('¡Tu reserva está confirmada!', to),
      html,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  // guestName/checkIn/checkOut are the only variables this template supports. Dates are
  // formatted DD/MM/YYYY (en-GB, pinned to UTC) to match the rest of this app's
  // guest-facing date formatting — checkIn/checkOut are stored as UTC midnight with no
  // real time-of-day component.
  async sendCancellationEmail(to: string, guestName: string, checkIn: Date, checkOut: Date): Promise<void> {
    const settings = await this.settingsService.get();
    const html = renderTemplate(
      settings.cancellationEmailTemplate,
      escapeHtmlVars({
        guestName,
        checkIn: formatDateOnly(checkIn),
        checkOut: formatDateOnly(checkOut),
      }),
    );

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: this.resolveRecipient(to),
      subject: this.subjectForDebug('Tu reserva fue cancelada', to),
      html,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async sendMarketingEmail(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: this.resolveRecipient(to),
      subject: this.subjectForDebug(subject, to),
      html,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async sendAlert(subject: string, message: string): Promise<void> {
    if (!this.alertEmail) {
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.from,
        to: this.resolveRecipient(this.alertEmail),
        subject: this.subjectForDebug(`[Alert] ${subject}`, this.alertEmail),
        // message routinely embeds a guest's name and upstream error text — escaped so neither
        // can inject markup (e.g. a phishing link) into an email that goes to staff.
        html: `<p>${escapeHtml(message)}</p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send alert email: ${(error as Error).message}`);
    }
  }
}
