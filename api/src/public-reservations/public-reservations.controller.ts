import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PublicReservationsService } from './public-reservations.service';
import { ConfirmDatesDto } from './dto/confirm-dates.dto';
import { UploadReceiptDto } from './dto/upload-receipt.dto';
import {
  MAX_UPLOAD_BYTES,
  RECEIPT_FILE_CSP,
} from '../reservation-images/reservation-images.service';
import { PublicReservationTokenGuard } from './public-reservation-token.guard';

// A guest realistically attaches a handful of receipts per submission, never more — this
// just bounds worst-case request size/processing, not a real product constraint.
const MAX_FILES_PER_SUBMISSION = 10;

// ThrottlerGuard runs first so that guessing tokens counts against the per-IP limit too.
@UseGuards(ThrottlerGuard, PublicReservationTokenGuard)
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
  @Throttle({ public: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_SUBMISSION, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      // A cheap early reject only — the client-sent mimetype can't be trusted, so the real
      // check is ReservationImagesService's magic-byte detection once the bytes are in.
      fileFilter: (_req, file, callback) => {
        if (
          !file.mimetype.startsWith('image/') ||
          file.mimetype === 'image/svg+xml'
        ) {
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
  @Header('Content-Security-Policy', RECEIPT_FILE_CSP)
  async getImageFile(
    @Param('token') token: string,
    @Param('imageId') imageId: string,
  ): Promise<StreamableFile> {
    const { buffer, streamOptions } = await this.service.getImageFile(
      token,
      imageId,
    );
    return new StreamableFile(buffer, streamOptions);
  }
}
