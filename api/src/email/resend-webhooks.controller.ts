import { Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Resend, WebhookEventPayload } from 'resend';
import { EmailOutboxService } from './email-outbox.service';

// Resend calls this for every event of the webhook configured in its dashboard; only
// email.received (an email arrived at the inbound address) does anything: it's forwarded to
// the staff mailbox. Public — no JWT — but every request must carry a valid Svix signature made
// with RESEND_WEBHOOK_SECRET, so only Resend can trigger it.
@Controller('webhooks')
export class ResendWebhooksController {
  private readonly resend = new Resend(process.env.RESEND_API_KEY);

  constructor(private readonly outbox: EmailOutboxService) {}

  @Post('resend')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
  ) {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret || !req.rawBody || !id || !timestamp || !signature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let event: WebhookEventPayload;
    try {
      event = this.resend.webhooks.verify({
        payload: req.rawBody.toString('utf8'),
        headers: { id, timestamp, signature },
        webhookSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (event.type === 'email.received') {
      await this.outbox.forwardInbound(event.data);
    }
    return { received: true };
  }
}
