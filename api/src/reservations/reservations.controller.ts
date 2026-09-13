import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';
import { CheckOverlapDto } from './dto/check-overlap.dto';

@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryReservationDto) {
    return this.reservationsService.findAll(query);
  }

  @Get('check-overlap')
  checkOverlap(@Query() query: CheckOverlapDto) {
    return this.reservationsService.checkOverlap(query.checkIn, query.checkOut, query.excludeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reservationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.reservationsService.update(id, dto);
  }

  @Post(':id/mark-payment-received')
  markPaymentReceived(@Param('id') id: string) {
    return this.reservationsService.markPaymentReceived(id);
  }

  @Post(':id/mark-deposit-received')
  markDepositReceived(@Param('id') id: string) {
    return this.reservationsService.markDepositReceived(id);
  }

  @Post(':id/mark-deposit-returned')
  markDepositReturned(@Param('id') id: string) {
    return this.reservationsService.markDepositReturned(id);
  }

  @Get(':id/events')
  listEvents(@Param('id') id: string) {
    return this.reservationsService.listEvents(id);
  }
}
