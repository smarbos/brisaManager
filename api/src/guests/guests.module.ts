import { Module } from '@nestjs/common';
import { GuestsController } from './guests.controller';
import { PublicGuestsController } from './public-guests.controller';
import { GuestsService } from './guests.service';

@Module({
  controllers: [GuestsController, PublicGuestsController],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
