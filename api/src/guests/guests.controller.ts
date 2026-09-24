import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuestsService } from './guests.service';
import { GuestEventsService } from '../guest-events/guest-events.service';

@UseGuards(JwtAuthGuard)
@Controller('guests')
export class GuestsController {
  constructor(
    private readonly guestsService: GuestsService,
    private readonly guestEventsService: GuestEventsService,
  ) {}

  @Get()
  findAll() {
    return this.guestsService.findAll();
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
