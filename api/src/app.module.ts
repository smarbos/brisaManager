import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SettingsModule } from './settings/settings.module';
import { ReservationEventsModule } from './reservation-events/reservation-events.module';
import { EmailModule } from './email/email.module';
import { PublicReservationsModule } from './public-reservations/public-reservations.module';
import { ChannelSyncModule } from './channel-sync/channel-sync.module';
import { GoogleCalendarModule } from './google-calendar/google-calendar.module';
import { GuestsModule } from './guests/guests.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ReservationsModule,
    SettingsModule,
    ReservationEventsModule,
    EmailModule,
    PublicReservationsModule,
    ChannelSyncModule,
    GoogleCalendarModule,
    GuestsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
