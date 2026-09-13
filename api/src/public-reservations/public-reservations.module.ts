import { Module } from '@nestjs/common';
import { PublicReservationsController } from './public-reservations.controller';
import { PublicReservationsService } from './public-reservations.service';
import { SettingsModule } from '../settings/settings.module';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';

@Module({
  imports: [SettingsModule, ReservationConfirmationModule],
  controllers: [PublicReservationsController],
  providers: [PublicReservationsService],
})
export class PublicReservationsModule {}
