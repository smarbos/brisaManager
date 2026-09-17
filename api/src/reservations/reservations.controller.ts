import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationsService } from './reservations.service';
import { ReservationConfirmationService } from '../reservation-confirmation/reservation-confirmation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { QueryReservationDto } from './dto/query-reservation.dto';
import { CheckOverlapDto } from './dto/check-overlap.dto';

@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly confirmationService: ReservationConfirmationService,
  ) {}

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

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.reservationsService.cancel(id);
  }

  @Post(':id/resend-initial-email')
  resendInitialEmail(@Param('id') id: string) {
    return this.reservationsService.resendInitialEmail(id);
  }

  @Post(':id/resend-final-email')
  resendFinalEmail(@Param('id') id: string) {
    return this.confirmationService.resendFinalEmail(id);
  }

  @Post(':id/resend-cancellation-email')
  resendCancellationEmail(@Param('id') id: string) {
    return this.reservationsService.resendCancellationEmail(id);
  }

  @Get(':id/events')
  listEvents(@Param('id') id: string) {
    return this.reservationsService.listEvents(id);
  }
}
