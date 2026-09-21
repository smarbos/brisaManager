import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ExtensionErrorReportController } from './extension-error-report.controller';
import { ExtensionErrorsController } from './extension-errors.controller';
import { ExtensionErrorsService } from './extension-errors.service';

// ThrottlerModule is scoped to this module (not global), same reasoning as
// ChannelImportModule: the rate limit should only apply to the machine-facing report endpoint.
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'extension-errors', ttl: 60_000, limit: 20 }])],
  controllers: [ExtensionErrorReportController, ExtensionErrorsController],
  providers: [ExtensionErrorsService],
})
export class ExtensionErrorsModule {}
