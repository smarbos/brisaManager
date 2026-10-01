import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { WhatsappService } from './whatsapp.service';
import { WhatsappReminderSchedulerService } from './whatsapp-reminder.scheduler';
import { WhatsappDeliveryService } from './whatsapp-delivery.service';
import { TwilioWebhooksController } from './twilio-webhooks.controller';
import { SettingsModule } from '../settings/settings.module';

// ThrottlerModule is scoped to this module (not global), same reasoning as
// ChannelImportModule: the limit applies to the machine-facing Twilio webhook only. Generous —
// Twilio posts several status updates per message — it only bounds forged-request floods.
@Module({
  imports: [
    SettingsModule,
    ThrottlerModule.forRoot([
      { name: 'twilio-webhooks', ttl: 60_000, limit: 200 },
    ]),
  ],
  controllers: [TwilioWebhooksController],
  providers: [
    WhatsappService,
    WhatsappReminderSchedulerService,
    WhatsappDeliveryService,
  ],
  exports: [WhatsappService, WhatsappDeliveryService],
})
export class WhatsappModule {}
