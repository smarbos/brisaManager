import { Module } from '@nestjs/common';
import { PublicReservationsController } from './public-reservations.controller';
import { PublicReservationsService } from './public-reservations.service';
import { SettingsModule } from '../settings/settings.module';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';
import { GuestsModule } from '../guests/guests.module';

@Module({
  imports: [SettingsModule, ReservationConfirmationModule, GuestsModule],
  controllers: [PublicReservationsController],
  providers: [PublicReservationsService],
})
export class PublicReservationsModule {}
