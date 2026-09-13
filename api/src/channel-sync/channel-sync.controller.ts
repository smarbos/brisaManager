import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChannelSyncService } from './channel-sync.service';

@UseGuards(JwtAuthGuard)
@Controller('channel-sync')
export class ChannelSyncController {
  constructor(private readonly channelSyncService: ChannelSyncService) {}

  @Post('run')
  async run() {
    await this.channelSyncService.syncAll();
    return { triggeredAt: new Date() };
  }
}
