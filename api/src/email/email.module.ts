import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailOutboxService } from './email-outbox.service';
import { EmailSenderService } from './email-sender.service';
import { EmailDispatcherService } from './email-dispatcher.service';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  imports: [SettingsModule],
  providers: [EmailService, EmailOutboxService, EmailSenderService, EmailDispatcherService],
  exports: [EmailService, EmailOutboxService],
})
export class EmailModule {}
