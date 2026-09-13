import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicReservationsService } from './public-reservations.service';
import { AcceptContractDto } from './dto/accept-contract.dto';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: PublicReservationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Post(':token/confirm-dates')
  confirmDates(@Param('token') token: string) {
    return this.service.confirmDates(token);
  }

  @Post(':token/accept-contract')
  acceptContract(
    @Param('token') token: string,
    @Body() dto: AcceptContractDto,
  ) {
    return this.service.acceptContract(token, dto.fullName);
  }
}
