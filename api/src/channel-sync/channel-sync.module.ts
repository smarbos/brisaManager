import { Module } from '@nestjs/common';
import { ChannelSyncController } from './channel-sync.controller';
import { ChannelSyncService } from './channel-sync.service';
import { ChannelSyncSchedulerService } from './channel-sync-scheduler.service';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SettingsModule, NotificationsModule],
  controllers: [ChannelSyncController],
  providers: [ChannelSyncService, ChannelSyncSchedulerService],
  exports: [ChannelSyncService],
})
export class ChannelSyncModule {}
