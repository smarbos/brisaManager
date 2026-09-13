import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GoogleCalendarPullService } from './google-calendar-pull.service';

@Injectable()
export class GoogleCalendarSchedulerService {
  private readonly logger = new Logger(GoogleCalendarSchedulerService.name);

  constructor(private readonly pullService: GoogleCalendarPullService) {}

  @Cron('*/5 * * * *')
  async handleScheduledPull(): Promise<void> {
    try {
      await this.pullService.pull();
    } catch (error) {
      this.logger.error(`Scheduled Google Calendar pull failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }
}
