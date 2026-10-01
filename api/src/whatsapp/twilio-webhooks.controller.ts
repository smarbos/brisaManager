import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { validateRequest } from 'twilio';
import { WhatsappDeliveryService } from './whatsapp-delivery.service';
import { whatsappStatusCallbackUrl } from './whatsapp-message-status';

// Called by Twilio, not by a logged-in user, so there's no JWT guard — the X-Twilio-Signature
// check below is the only gate, and it fails closed: no configured callback URL, no auth
// token, no signature, or a signature that doesn't match all mean 403 and nothing changes.
//
// ThrottlerGuard runs first so that forged requests still count against the per-IP limit.
@UseGuards(ThrottlerGuard)
@Controller('webhooks/twilio')
export class TwilioWebhooksController {
  constructor(private readonly deliveryService: WhatsappDeliveryService) {}

  // Twilio posts application/x-www-form-urlencoded; the signature covers the URL plus every
  // posted param, so the body is validated as-is (a plain object, no DTO — the global
  // ValidationPipe's whitelist would otherwise strip params and break the signature).
  @Post('whatsapp-status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async whatsappStatus(
    @Headers('x-twilio-signature') signature: string | undefined,
    @Body() params: Record<string, string>,
  ): Promise<void> {
    const url = whatsappStatusCallbackUrl();
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (
      !url ||
      !authToken ||
      !signature ||
      !validateRequest(authToken, signature, url, params)
    ) {
      throw new ForbiddenException('Invalid Twilio signature');
    }

    const { MessageSid, MessageStatus, ErrorCode } = params;
    if (!MessageSid || !MessageStatus) {
      return;
    }
    await this.deliveryService.applyStatus(
      MessageSid,
      MessageStatus,
      ErrorCode || null,
    );
  }
}
