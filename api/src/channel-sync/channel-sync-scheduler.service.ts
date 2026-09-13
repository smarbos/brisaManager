import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChannelSyncService } from './channel-sync.service';

@Injectable()
export class ChannelSyncSchedulerService {
  constructor(private readonly channelSyncService: ChannelSyncService) {}

  @Cron('*/30 * * * *')
  async handleScheduledSync(): Promise<void> {
    await this.channelSyncService.syncAll();
  }
}
