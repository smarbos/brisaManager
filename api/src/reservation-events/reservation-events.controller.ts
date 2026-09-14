import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationEventsService } from './reservation-events.service';

@UseGuards(JwtAuthGuard)
@Controller('reservation-events')
export class ReservationEventsController {
  constructor(private readonly reservationEventsService: ReservationEventsService) {}

  @Get()
  listAll() {
    return this.reservationEventsService.listAll();
  }
}
