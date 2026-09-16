import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicReservationsService } from './public-reservations.service';
import { ConfirmDatesDto } from './dto/confirm-dates.dto';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: PublicReservationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Post(':token/confirm-dates')
  confirmDates(@Param('token') token: string, @Body() dto: ConfirmDatesDto) {
    return this.service.confirmDates(token, dto.fullName, dto.phone, dto.email);
  }

  @Post(':token/accept-contract')
  acceptContract(@Param('token') token: string) {
    return this.service.acceptContract(token);
  }
}
