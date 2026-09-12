import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [PrismaModule, AuthModule, ReservationsModule],
  controllers: [AppController],
})
export class AppModule {}
