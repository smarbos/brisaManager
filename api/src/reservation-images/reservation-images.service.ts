import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { NotificationsService } from '../notifications/notifications.service';

const RECEIPTS_SUBDIR = 'receipts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Injectable()
export class ReservationImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async upload(reservationId: string, file: Express.Multer.File) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} not found`);
    }

    const filename = await this.fileStorage.save(RECEIPTS_SUBDIR, file.buffer, file.originalname);

    const image = await this.prisma.reservationImage.create({
      data: {
        reservationId,
        filename,
        originalName: file.originalname || null,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });

    // Not gated on anything — every upload is worth a look, staff decide from the image
    // itself (and the two "mark as received" buttons next to it) what it actually covers.
    await this.notificationsService.create({
      type: 'PAYMENT_RECEIPT_UPLOADED',
      message: `${reservation.guestName} subió un comprobante de pago.`,
      reservationId,
    });

    return image;
  }

  listForReservation(reservationId: string) {
    return this.prisma.reservationImage.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(reservationId: string, imageId: string) {
    const image = await this.prisma.reservationImage.findUnique({ where: { id: imageId } });
    // Checking reservationId here (not just relying on the id lookup) is what stops the
    // guest-facing endpoint from ever serving an image that belongs to a *different*
    // reservation's token holder — see PublicReservationsService, which resolves
    // reservationId from the token before calling this.
    if (!image || image.reservationId !== reservationId) {
      throw new NotFoundException(`Image ${imageId} not found for this reservation`);
    }
    return image;
  }

  readFile(image: { filename: string }): Promise<Buffer> {
    return this.fileStorage.read(RECEIPTS_SUBDIR, image.filename);
  }
}
