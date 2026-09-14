import { Module } from '@nestjs/common';
import { ReservationImportController } from './reservation-import.controller';
import { ReservationImportService } from './reservation-import.service';

@Module({
  controllers: [ReservationImportController],
  providers: [ReservationImportService],
})
export class ReservationImportModule {}
