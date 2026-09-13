import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';

@Module({
  imports: [ReservationConfirmationModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
