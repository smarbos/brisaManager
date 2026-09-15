import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  imports: [SettingsModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
