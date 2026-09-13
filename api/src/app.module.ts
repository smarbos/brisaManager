import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SettingsModule } from './settings/settings.module';
import { ReservationEventsModule } from './reservation-events/reservation-events.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [PrismaModule, AuthModule, ReservationsModule, SettingsModule, ReservationEventsModule, EmailModule],
  controllers: [AppController],
})
export class AppModule {}
