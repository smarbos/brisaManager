import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PublicReservationsService } from './public-reservations.service';
import { ConfirmDatesDto } from './dto/confirm-dates.dto';
import { MAX_UPLOAD_BYTES } from '../reservation-images/reservation-images.service';

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: PublicReservationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Post(':token/confirm-dates')
  confirmDates(@Param('token') token: string, @Body() dto: ConfirmDatesDto) {
    return this.service.confirmDates(token, dto.fullName, dto.phone, dto.email);
  }

  @Post(':token/accept-contract')
  acceptContract(@Param('token') token: string) {
    return this.service.acceptContract(token);
  }

  @Post(':token/images')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          callback(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadImage(@Param('token') token: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    return this.service.uploadImage(token, file);
  }

  @Get(':token/images')
  listImages(@Param('token') token: string) {
    return this.service.listImages(token);
  }

  @Get(':token/images/:imageId/file')
  async getImageFile(@Param('token') token: string, @Param('imageId') imageId: string): Promise<StreamableFile> {
    const { image, buffer } = await this.service.getImageFile(token, imageId);
    return new StreamableFile(buffer, { type: image.mimeType });
  }
}
