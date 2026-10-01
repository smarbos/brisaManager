import { Injectable, Logger } from '@nestjs/common';
import Twilio from 'twilio';
import { normalizePhoneForWhatsapp } from './phone-normalizer';
import { TemplateMessage } from './whatsapp-templates';
import { WhatsappDeliveryService, WhatsappSendContext, WhatsappSendOutcome } from './whatsapp-delivery.service';
import { whatsappStatusCallbackUrl } from './whatsapp-message-status';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly from = process.env.TWILIO_WHATSAPP_FROM as string;
  private client: ReturnType<typeof Twilio> | null = null;

  constructor(private readonly deliveryService: WhatsappDeliveryService) {}

  // Twilio's constructor throws synchronously on a malformed TWILIO_ACCOUNT_SID (e.g. a
  // value that doesn't start with "AC"). Since this class is instantiated by Nest's DI
  // container at app boot, constructing the client eagerly as a property initializer
  // would let a bad env var crash the entire API over what's supposed to be an optional,
  // never-blocking notification channel. So construction is deferred to first use and
  // wrapped so a failure is logged and turned into a plain `null`, never a thrown error.
  private getClient(): ReturnType<typeof Twilio> | null {
    if (this.client) {
      return this.client;
    }
    try {
      this.client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      return this.client;
    } catch (error) {
      this.logger.error(`Failed to construct Twilio client: ${(error as Error).message}`);
      return null;
    }
  }

  // Never throws: every caller gets a plain boolean, matching this feature's "log it
  // silently, never block anything else" failure-handling decision (see the design spec).
  // Freeform text only delivers within 24h of the guest's last message to us — anything
  // business-initiated goes through sendTemplate() instead.
  async sendMessage(rawPhone: string, body: string, context?: WhatsappSendContext): Promise<boolean> {
    return this.send(rawPhone, { body }, context);
  }

  // Sends a Meta-approved template (Twilio Content API). Without a configured template SID,
  // sends the message's equivalent freeform text instead, which is what works on the Twilio
  // Sandbox and in local dev. `context` identifies the reservation and message kind so the
  // attempt — and Twilio's later delivery reports for it — can be tracked
  // (see WhatsappDeliveryService).
  async sendTemplate(rawPhone: string, message: TemplateMessage, context?: WhatsappSendContext): Promise<boolean> {
    if (!message.templateSid) {
      return this.sendMessage(rawPhone, message.fallbackBody, context);
    }
    return this.send(
      rawPhone,
      {
        contentSid: message.templateSid,
        contentVariables: JSON.stringify(message.variables),
      },
      context,
    );
  }

  private async send(
    rawPhone: string,
    content: { body: string } | { contentSid: string; contentVariables: string },
    context?: WhatsappSendContext,
  ): Promise<boolean> {
    const outcome = await this.attemptSend(rawPhone, content);
    if (context) {
      await this.deliveryService.recordSend(context, outcome);
    }
    return outcome.accepted;
  }

  private async attemptSend(
    rawPhone: string,
    content: { body: string } | { contentSid: string; contentVariables: string },
  ): Promise<WhatsappSendOutcome> {
    const to = normalizePhoneForWhatsapp(rawPhone);
    if (!to) {
      this.logger.warn(`Could not normalize phone number for WhatsApp: ${rawPhone}`);
      return { accepted: false, errorCode: null, errorMessage: 'Teléfono inválido para WhatsApp' };
    }

    const client = this.getClient();
    if (!client) {
      return { accepted: false, errorCode: null, errorMessage: 'El cliente de Twilio no está configurado' };
    }

    // Only registered when there's a public https callback URL — see whatsappStatusCallbackUrl().
    const statusCallback = whatsappStatusCallbackUrl();

    try {
      const message = await client.messages.create({
        from: this.from,
        to,
        ...content,
        ...(statusCallback ? { statusCallback } : {}),
      });
      return { accepted: true, twilioSid: message.sid, status: message.status ?? 'queued' };
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp message to ${to}: ${(error as Error).message}`);
      // Twilio's RestException carries its numeric error code (e.g. 63016) on `.code`.
      const code = (error as { code?: unknown }).code;
      return {
        accepted: false,
        errorCode: typeof code === 'number' || typeof code === 'string' ? String(code) : null,
        errorMessage: (error as Error).message,
      };
    }
  }
}
