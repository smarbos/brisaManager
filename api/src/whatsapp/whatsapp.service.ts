import { Injectable, Logger } from '@nestjs/common';
import Twilio from 'twilio';
import { normalizeArgentinePhoneForWhatsapp } from './phone-normalizer';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  private readonly from = process.env.TWILIO_WHATSAPP_FROM as string;

  // Never throws: every caller gets a plain boolean, matching this feature's "log it
  // silently, never block anything else" failure-handling decision (see the design spec).
  async sendMessage(rawPhone: string, body: string): Promise<boolean> {
    const to = normalizeArgentinePhoneForWhatsapp(rawPhone);
    if (!to) {
      this.logger.warn(`Could not normalize phone number for WhatsApp: ${rawPhone}`);
      return false;
    }

    try {
      await this.client.messages.create({ from: this.from, to, body });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp message to ${to}: ${(error as Error).message}`);
      return false;
    }
  }
}
