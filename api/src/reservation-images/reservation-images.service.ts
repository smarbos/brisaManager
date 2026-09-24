import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';

const RECEIPTS_SUBDIR = 'receipts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    const filename = await this.fileStorage.save(
      RECEIPTS_SUBDIR,
      file.buffer,
      file.originalname,
    );

    return this.prisma.reservationImage.create({
      data: {
        reservationId,
        filename,
        originalName: file.originalname || null,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        message: message || null,
      },
    });
  }

  listForReservation(reservationId: string) {
    return this.prisma.reservationImage.findMany({
      where: { reservationId },
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
    if (!image || image.reservationId !== reservationId) {
      throw new NotFoundException(
        `Image ${imageId} not found for this reservation`,
      );
    }
    return image;
  }

  readFile(image: { filename: string }): Promise<Buffer> {
    return this.fileStorage.read(RECEIPTS_SUBDIR, image.filename);
  }
}
