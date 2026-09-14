import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly from = process.env.EMAIL_FROM as string;
  private readonly alertEmail = process.env.ALERT_EMAIL ?? process.env.ADMIN_SEED_EMAIL;

  async sendInitialConfirmationEmail(to: string, guestName: string, confirmationUrl: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Confirm your reservation at La Brisa de Mar del Plata',
      html: `<p>Hi ${guestName},</p><p>Please confirm your reservation and complete a few quick steps:</p><p><a href="${confirmationUrl}">${confirmationUrl}</a></p>`,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async sendFinalConfirmationEmail(to: string, guestName: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Your reservation is confirmed!',
      html: `<p>Hi ${guestName},</p><p>Your reservation at La Brisa de Mar del Plata is now fully confirmed. We look forward to hosting you!</p>`,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async sendMarketingEmail(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });

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
        to: this.alertEmail,
        subject: `[Alert] ${subject}`,
        html: `<p>${message}</p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send alert email: ${(error as Error).message}`);
    }
  }
}
