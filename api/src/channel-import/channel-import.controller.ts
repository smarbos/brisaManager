import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { renderTemplate } from '../common/render-template';
import { SettingsService } from '../settings/settings.service';
import { ChannelImportService } from './channel-import.service';
import { ImportReservationDto } from './dto/import-reservation.dto';
import { ImportStatusQueryDto } from './dto/import-status-query.dto';

// Separate controller (not a method on ReservationsController) because it's guarded
// differently: ApiKeyGuard for machine callers (the Chrome extension) instead of JwtAuthGuard
// for staff browser sessions — mixing the two on one class-level @UseGuards would apply both
// to every route on that controller.
//
// ThrottlerGuard runs BEFORE ApiKeyGuard (guards execute in array order, first rejection
// wins) so that repeated wrong-key attempts still count against the per-IP limit — otherwise
// an attacker brute-forcing the key would never trip the throttle, since every failed guess
// would be rejected by ApiKeyGuard first.
@UseGuards(ThrottlerGuard, ApiKeyGuard)
@Controller('reservations/import')
export class ChannelImportController {
  constructor(
    private readonly channelImportService: ChannelImportService,
    private readonly settingsService: SettingsService,
  ) {}

  // Passive check the extension runs on page load, before the operator has clicked
  // anything — lets it show "already loaded" instead of only finding out after a click.
  @Get('status')
  status(@Query() query: ImportStatusQueryDto) {
    return this.channelImportService.checkStatus(query.source, query.res_id);
  }

  @Post()
  async import(@Body() dto: ImportReservationDto) {
    const { reservation, created } = await this.channelImportService.import(dto);
    const confirmationUrl = `${process.env.GUEST_WEB_ORIGIN}/r/${reservation.confirmationToken}`;

    // Only Airbnb needs a pre-composed message: Booking.com's flow already emails the guest
    // directly (a real relay email is scrapeable from its extranet page), while Airbnb's
    // messages page never exposes the guest's email, so the confirmation link travels back
    // through the same Airbnb message thread instead — the extension pastes this into the
    // compose box for the host to review and send.
    const message =
      dto.source === 'airbnb'
        ? renderTemplate((await this.settingsService.get()).airbnbMessageTemplate, {
            guestName: reservation.guestName,
            confirmationUrl,
          })
        : null;

    return {
      id: reservation.id,
      created,
      guestName: reservation.guestName,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      status: reservation.status,
      confirmationUrl,
      message,
    };
  }
}
