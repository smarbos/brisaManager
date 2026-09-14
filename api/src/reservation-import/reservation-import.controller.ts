import { BadRequestException, Controller, HttpCode, HttpStatus, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExtractedReservationFields, ReservationImportService } from './reservation-import.service';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@UseGuards(JwtAuthGuard)
@Controller('reservation-import')
export class ReservationImportController {
  constructor(private readonly reservationImportService: ReservationImportService) {}

  @Post('parse-screenshot')
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
  async parseScreenshot(@UploadedFile() file: Express.Multer.File): Promise<ExtractedReservationFields> {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }
    try {
      return await this.reservationImportService.extractFromScreenshot(file.buffer);
    } catch {
      throw new BadRequestException('Could not process the uploaded image');
    }
  }
}
