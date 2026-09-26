import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AmbientApiKeyGuard } from './ambient-api-key.guard';
import { AmbientService } from './ambient.service';
import { LogAmbientAlertDto } from './dto/log-ambient-alert.dto';

// Separate from AmbientAlertsController (same reasoning as ExtensionErrorReportController vs
// ExtensionErrorsController): this is called by an ambient-control device with the shared API
// key, not a staff browser session, so it can't share a class-level @UseGuards with the
// JWT-guarded listing endpoint below.
@UseGuards(ThrottlerGuard, AmbientApiKeyGuard)
@Controller('ambient-alerts')
export class AmbientAlertReportController {
  constructor(private readonly ambientService: AmbientService) {}

  @Post()
  report(@Body() dto: LogAmbientAlertDto) {
    return this.ambientService.recordAlert(dto);
  }
}
