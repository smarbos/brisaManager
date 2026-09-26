import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AmbientService } from './ambient.service';

@Injectable()
export class AmbientOfflineSchedulerService {
  private readonly logger = new Logger(AmbientOfflineSchedulerService.name);

  constructor(private readonly ambientService: AmbientService) {}

  @Cron('* * * * *')
  async handleOfflineCheck(): Promise<void> {
    try {
      await this.ambientService.checkOfflineDevices();
    } catch (error) {
      this.logger.error(`Ambient device offline check failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }
}
