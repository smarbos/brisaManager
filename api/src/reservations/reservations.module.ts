import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationConfirmationModule } from '../reservation-confirmation/reservation-confirmation.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { GuestsModule } from '../guests/guests.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [ReservationConfirmationModule, GoogleCalendarModule, GuestsModule, WhatsappModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
