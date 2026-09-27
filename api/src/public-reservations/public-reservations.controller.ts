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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PublicReservationsService } from './public-reservations.service';
import { ConfirmDatesDto } from './dto/confirm-dates.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import { MAX_UPLOAD_BYTES } from '../reservation-images/reservation-images.service';

// A guest realistically attaches a handful of receipts per submission, never more — this
// just bounds worst-case request size/processing, not a real product constraint.
const MAX_FILES_PER_SUBMISSION = 10;

@Controller('public/reservations')
export class PublicReservationsController {
  constructor(private readonly service: PublicReservationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Get(':token/ambient')
  getAmbientReadings(@Param('token') token: string) {
    return this.service.getAmbientReadings(token);
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
    FilesInterceptor('files', MAX_FILES_PER_SUBMISSION, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadImages(
    @Param('token') token: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadReceiptDto,
  ) {
    return this.service.submitPaymentUpdate(token, files ?? [], dto.message);
  }

  @Get(':token/images')
  listImages(@Param('token') token: string) {
    return this.service.listImages(token);
  }

  @Get(':token/images/:imageId/file')
  async getImageFile(
    @Param('token') token: string,
    @Param('imageId') imageId: string,
  ): Promise<StreamableFile> {
    const { image, buffer } = await this.service.getImageFile(token, imageId);
    return new StreamableFile(buffer, { type: image.mimeType });
  }
}
