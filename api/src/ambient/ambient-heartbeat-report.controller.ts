import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AmbientApiKeyGuard } from './ambient-api-key.guard';
import { AmbientService } from './ambient.service';
import { LogAmbientHeartbeatDto } from './dto/log-ambient-heartbeat.dto';

// Machine-facing, same as AmbientAlertReportController - a device calls this every
// HEARTBEAT_INTERVAL_MS regardless of whether anything is alert-worthy.
@UseGuards(ThrottlerGuard, AmbientApiKeyGuard)
@Controller('ambient-heartbeat')
export class AmbientHeartbeatReportController {
  constructor(private readonly ambientService: AmbientService) {}

  @Post()
  report(@Body() dto: LogAmbientHeartbeatDto) {
    return this.ambientService.recordHeartbeat(dto);
  }
}
