import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarAuthService } from './google-calendar-auth.service';
import { GoogleCalendarPushService } from './google-calendar-push.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarAuthService, GoogleCalendarPushService],
  exports: [GoogleCalendarAuthService, GoogleCalendarPushService],
})
export class GoogleCalendarModule {}
