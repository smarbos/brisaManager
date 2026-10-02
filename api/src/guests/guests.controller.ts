import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuestsService } from './guests.service';
import { GuestEventsService } from '../guest-events/guest-events.service';
import { QueryGuestsDto } from './dto/query-guests.dto';

@UseGuards(JwtAuthGuard)
@Controller('guests')
export class GuestsController {
  constructor(
    private readonly guestsService: GuestsService,
    private readonly guestEventsService: GuestEventsService,
  ) {}

  @Get()
  findAll(@Query() query: QueryGuestsDto) {
    return this.guestsService.findAll(
      query.document
        ? { type: query.documentType ?? 'DNI', country: query.documentCountry, number: query.document }
        : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.guestsService.findOne(id);
  }

  @Get(':id/events')
  listEvents(@Param('id') id: string) {
    return this.guestEventsService.listForGuest(id);
  }
}
