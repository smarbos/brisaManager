import { Global, Module } from '@nestjs/common';
import { GuestEventsService } from './guest-events.service';
import { GuestEventsController } from './guest-events.controller';

@Global()
@Module({
  controllers: [GuestEventsController],
  providers: [GuestEventsService],
  exports: [GuestEventsService],
})
export class GuestEventsModule {}
