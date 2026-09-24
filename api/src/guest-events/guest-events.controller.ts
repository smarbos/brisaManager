import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuestEventsService } from './guest-events.service';

@UseGuards(JwtAuthGuard)
@Controller('guest-events')
export class GuestEventsController {
  constructor(private readonly guestEventsService: GuestEventsService) {}

  @Get()
  listAll() {
    return this.guestEventsService.listAll();
  }
}
