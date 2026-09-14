import { Global, Module } from '@nestjs/common';
import { ReservationEventsService } from './reservation-events.service';
import { ReservationEventsController } from './reservation-events.controller';

@Global()
@Module({
  controllers: [ReservationEventsController],
  providers: [ReservationEventsService],
  exports: [ReservationEventsService],
})
export class ReservationEventsModule {}
