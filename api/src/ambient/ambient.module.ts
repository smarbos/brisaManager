import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { AmbientAlertReportController } from './ambient-alert-report.controller';
import { AmbientAlertsController } from './ambient-alerts.controller';
import { AmbientHeartbeatReportController } from './ambient-heartbeat-report.controller';
import { AmbientDevicesController } from './ambient-devices.controller';
import { AmbientOfflineSchedulerService } from './ambient-offline-scheduler.service';
import { AmbientService } from './ambient.service';

// ThrottlerModule is scoped to this module (not global), same reasoning as
// ExtensionErrorsModule: the rate limit should only apply to the machine-facing report endpoints.
@Module({
  imports: [
    NotificationsModule,
    SettingsModule,
    ThrottlerModule.forRoot([{ name: 'ambient-alerts', ttl: 60_000, limit: 20 }]),
  ],
  controllers: [
    AmbientAlertReportController,
    AmbientAlertsController,
    AmbientHeartbeatReportController,
    AmbientDevicesController,
  ],
  providers: [AmbientService, AmbientOfflineSchedulerService],
  exports: [AmbientService],
})
export class AmbientModule {}
