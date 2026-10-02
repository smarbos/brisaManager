import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { detectImageType, isServableMimeType } from './image-type';

export const RECEIPTS_SUBDIR = 'receipts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Sent on every receipt file response (staff and guest routes alike): if one were ever
// opened directly as a page, no script in it could run.
export const RECEIPT_FILE_CSP = "default-src 'none'; img-src 'self'; sandbox";

@Injectable()
export class ReservationImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
  ) {}

  // Notifying staff is the caller's job, not this method's: PublicReservationsService may
  // call this once per file in a multi-file submission, and needs to send exactly one
  // notification for the whole batch rather than one per image.
  async upload(
    reservationId: string,
    file: Express.Multer.File,
    message?: string,
  ) {
    const detected = detectImageType(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Only JPEG, PNG, GIF, WebP or HEIC images are allowed',
      );
    }

    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    const filename = await this.fileStorage.save(
      RECEIPTS_SUBDIR,
      file.buffer,
      // The stored extension comes from the detected type, not the client's filename.
      `receipt${detected.extension}`,
    );

    return this.prisma.reservationImage.create({
      data: {
        reservationId,
        filename,
        originalName: file.originalname || null,
        mimeType: detected.mimeType,
        sizeBytes: file.size,
        message: message || null,
      },
    });
  }

  // Staff see every receipt, including ones the retention job deleted (deletedAt set), so
  // the gallery can show that a receipt existed.
  listForReservation(reservationId: string) {
    return this.prisma.reservationImage.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The guest's own check-in page only lists receipts that still exist.
  listAvailableForReservation(reservationId: string) {
    return this.prisma.reservationImage.findMany({
      where: { reservationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(reservationId: string, imageId: string) {
    const image = await this.prisma.reservationImage.findUnique({
      where: { id: imageId },
    });
    // Checking reservationId here (not just relying on the id lookup) is what stops the
    // guest-facing endpoint from ever serving an image that belongs to a *different*
    // reservation's token holder — see PublicReservationsService, which resolves
    // reservationId from the token before calling this.
    // A receipt deleted by the retention job 404s like a missing one — its file is gone.
    if (!image || image.reservationId !== reservationId || image.deletedAt) {
      throw new NotFoundException(
        `Image ${imageId} not found for this reservation`,
      );
    }
    return image;
  }

  // Checks every file before any is saved, so a multi-file submission with one bad file is
  // rejected outright rather than half-stored.
  assertAllowedImages(files: Express.Multer.File[]): void {
    for (const file of files) {
      if (!detectImageType(file.buffer)) {
        throw new BadRequestException(
          'Only JPEG, PNG, GIF, WebP or HEIC images are allowed',
        );
      }
    }
  }

  // Response options for streaming a stored image back. Anything whose stored type isn't one
  // this service would itself have detected (legacy rows from before magic-byte checks)
  // goes out as an opaque attachment, never as something a browser renders.
  streamOptions(image: { mimeType: string }): {
    type: string;
    disposition?: string;
  } {
    return isServableMimeType(image.mimeType)
      ? { type: image.mimeType }
      : { type: 'application/octet-stream', disposition: 'attachment' };
  }

  readFile(image: { filename: string }): Promise<Buffer> {
    return this.fileStorage.read(RECEIPTS_SUBDIR, image.filename);
  }
}
