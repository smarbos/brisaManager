import { Global, Module } from '@nestjs/common';
import { ReservationEventsService } from './reservation-events.service';

@Global()
@Module({
  providers: [ReservationEventsService],
  exports: [ReservationEventsService],
})
export class ReservationEventsModule {}
