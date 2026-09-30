import {
  Controller,
  Get,
  Header,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  RECEIPT_FILE_CSP,
  ReservationImagesService,
} from './reservation-images.service';

@UseGuards(JwtAuthGuard)
@Controller('reservations/:reservationId/images')
export class ReservationImagesController {
  constructor(
    private readonly reservationImagesService: ReservationImagesService,
  ) {}

  @Get()
  list(@Param('reservationId') reservationId: string) {
    return this.reservationImagesService.listForReservation(reservationId);
  }

  // Even a genuine image is never a document: sandboxed, no subresources, no sniffing.
  @Get(':imageId/file')
  @Header('Content-Security-Policy', RECEIPT_FILE_CSP)
  async getFile(
    @Param('reservationId') reservationId: string,
    @Param('imageId') imageId: string,
  ): Promise<StreamableFile> {
    const image = await this.reservationImagesService.getOne(
      reservationId,
      imageId,
    );
    const buffer = await this.reservationImagesService.readFile(image);
    return new StreamableFile(
      buffer,
      this.reservationImagesService.streamOptions(image),
    );
  }
}
