import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChannelSyncService } from './channel-sync.service';

@Injectable()
export class ChannelSyncSchedulerService {
  private readonly logger = new Logger(ChannelSyncSchedulerService.name);

  constructor(private readonly channelSyncService: ChannelSyncService) {}

  @Cron('*/30 * * * *')
  async handleScheduledSync(): Promise<void> {
    try {
      await this.channelSyncService.syncAll();
    } catch (error) {
      this.logger.error(`Scheduled channel sync failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }
}
