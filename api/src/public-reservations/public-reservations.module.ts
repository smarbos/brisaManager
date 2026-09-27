import { Module } from '@nestjs/common';
import { PublicReservationsController } from './public-reservations.controller';
import { PublicReservationsService } from './public-reservations.service';
import { SettingsModule } from '../settings/settings.module';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';
import { GuestsModule } from '../guests/guests.module';
import { ReservationImagesModule } from '../reservation-images/reservation-images.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AmbientModule } from '../ambient/ambient.module';

@Module({
  imports: [
    SettingsModule,
    ReservationConfirmationModule,
    GuestsModule,
    ReservationImagesModule,
    NotificationsModule,
    AmbientModule,
  ],
  controllers: [PublicReservationsController],
  providers: [PublicReservationsService],
})
export class PublicReservationsModule {}
