import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PublicReservationsController } from './public-reservations.controller';
import { PublicReservationsService } from './public-reservations.service';
import { PublicReservationTokenGuard } from './public-reservation-token.guard';
import { SettingsModule } from '../settings/settings.module';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';
import { GuestsModule } from '../guests/guests.module';
import { ReservationImagesModule } from '../reservation-images/reservation-images.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AmbientModule } from '../ambient/ambient.module';

// ThrottlerModule is scoped to this module (not global), same reasoning as
// ChannelImportModule. Generous default — one guest page load fans out into several requests
// (reservation, image list, one per receipt thumbnail, sensors) — tightened per-route on the
// upload endpoint.
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'public', ttl: 60_000, limit: 120 }]),
    SettingsModule,
    ReservationConfirmationModule,
    GuestsModule,
    ReservationImagesModule,
    NotificationsModule,
    AmbientModule,
  ],
  controllers: [PublicReservationsController],
  providers: [PublicReservationsService, PublicReservationTokenGuard],
})
export class PublicReservationsModule {}
