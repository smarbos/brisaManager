import { Module } from '@nestjs/common';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [GoogleCalendarAuthService],
  exports: [GoogleCalendarAuthService],
})
export class GoogleCalendarModule {}
