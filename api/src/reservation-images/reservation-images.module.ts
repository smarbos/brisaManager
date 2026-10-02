import { Module } from '@nestjs/common';
import { ReservationImagesController } from './reservation-images.controller';
import { ReservationImagesService } from './reservation-images.service';
import { ReservationImagesRetentionService } from './reservation-images-retention.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ReservationImagesController],
  providers: [ReservationImagesService, ReservationImagesRetentionService],
  exports: [ReservationImagesService],
})
export class ReservationImagesModule {}
