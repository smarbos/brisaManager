import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappReminderSchedulerService } from './whatsapp-reminder.scheduler';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [WhatsappService, WhatsappReminderSchedulerService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
