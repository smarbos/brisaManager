import { Module } from '@nestjs/common';
import { ReservationConfirmationService } from './reservation-confirmation.service';

@Module({
  providers: [ReservationConfirmationService],
  exports: [ReservationConfirmationService],
})
export class ReservationConfirmationModule {}
