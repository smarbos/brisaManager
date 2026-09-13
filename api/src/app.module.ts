import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SettingsModule } from './settings/settings.module';
import { ReservationEventsModule } from './reservation-events/reservation-events.module';
import { EmailModule } from './email/email.module';
import { PublicReservationsModule } from './public-reservations/public-reservations.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ReservationsModule,
    SettingsModule,
    ReservationEventsModule,
    EmailModule,
    PublicReservationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
