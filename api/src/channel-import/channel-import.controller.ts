import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ChannelImportService } from './channel-import.service';
import { ImportReservationDto } from './dto/import-reservation.dto';

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
  constructor(private readonly channelImportService: ChannelImportService) {}

  @Post()
  async import(@Body() dto: ImportReservationDto) {
    const { reservation, created } = await this.channelImportService.import(dto);
    return {
      id: reservation.id,
      created,
      guestName: reservation.guestName,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      status: reservation.status,
    };
  }
}
