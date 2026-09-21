import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ExtensionErrorsService } from './extension-errors.service';
import { LogExtensionErrorDto } from './dto/log-extension-error.dto';

// Separate from ExtensionErrorsController (same reasoning as ChannelImportController vs
// ReservationsController): this is called by the Chrome extension with the shared API key,
// not a staff browser session, so it can't share a class-level @UseGuards with the JWT-guarded
// listing endpoint below.
@UseGuards(ThrottlerGuard, ApiKeyGuard)
@Controller('extension-errors')
export class ExtensionErrorReportController {
  constructor(private readonly extensionErrorsService: ExtensionErrorsService) {}

  @Post()
  report(@Body() dto: LogExtensionErrorDto) {
    return this.extensionErrorsService.record(dto);
  }
}
