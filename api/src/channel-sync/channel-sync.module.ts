import { Module } from '@nestjs/common';
import { ChannelSyncService } from './channel-sync.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [ChannelSyncService],
  exports: [ChannelSyncService],
})
export class ChannelSyncModule {}
