import { Module } from '@nestjs/common';
import { ReservationImagesController } from './reservation-images.controller';
import { ReservationImagesService } from './reservation-images.service';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [ReservationImagesController],
  providers: [ReservationImagesService],
  exports: [ReservationImagesService],
})
export class ReservationImagesModule {}
