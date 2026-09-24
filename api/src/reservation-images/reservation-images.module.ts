import { Module } from '@nestjs/common';
import { ReservationImagesController } from './reservation-images.controller';
import { ReservationImagesService } from './reservation-images.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ReservationImagesController],
  providers: [ReservationImagesService],
  exports: [ReservationImagesService],
})
export class ReservationImagesModule {}
