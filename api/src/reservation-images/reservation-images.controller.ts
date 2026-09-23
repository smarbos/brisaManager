import { Controller, Get, Param, StreamableFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReservationImagesService } from './reservation-images.service';

@UseGuards(JwtAuthGuard)
@Controller('reservations/:reservationId/images')
export class ReservationImagesController {
  constructor(private readonly reservationImagesService: ReservationImagesService) {}

  @Get()
  list(@Param('reservationId') reservationId: string) {
    return this.reservationImagesService.listForReservation(reservationId);
  }

  @Get(':imageId/file')
  async getFile(
    @Param('reservationId') reservationId: string,
    @Param('imageId') imageId: string,
  ): Promise<StreamableFile> {
    const image = await this.reservationImagesService.getOne(reservationId, imageId);
    const buffer = await this.reservationImagesService.readFile(image);
    return new StreamableFile(buffer, { type: image.mimeType });
  }
}
