import { Module } from '@nestjs/common';
import { ChannelSyncController } from './channel-sync.controller';
import { ChannelSyncService } from './channel-sync.service';
import { ChannelSyncSchedulerService } from './channel-sync-scheduler.service';
import { SettingsModule } from '../settings/settings.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [SettingsModule, GoogleCalendarModule],
  controllers: [ChannelSyncController],
  providers: [ChannelSyncService, ChannelSyncSchedulerService],
  exports: [ChannelSyncService],
})
export class ChannelSyncModule {}
