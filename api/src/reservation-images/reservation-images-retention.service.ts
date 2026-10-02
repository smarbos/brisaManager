import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { RECEIPTS_SUBDIR } from './reservation-images.service';

// Same window as the guest link's expiry (TOKEN_VALID_DAYS_AFTER_CHECKOUT in
// PublicReservationsService) — kept as its own constant to avoid a circular import.
export const RECEIPT_RETENTION_DAYS_AFTER_CHECKOUT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Payment receipts are deleted once the stay is settled: the check-in privacy notice promises
// "los comprobantes de pago se eliminan al cerrar tu estadía". The ReservationImage row stays
// (with deletedAt set) so staff can still see that a receipt existed.
@Injectable()
export class ReservationImagesRetentionService {
  private readonly logger = new Logger(ReservationImagesRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
  ) {}

  @Cron('0 4 * * *')
  async handleRetention(): Promise<void> {
    try {
      const { deleted, failed } = await this.deleteExpiredReceipts(new Date());
      if (deleted > 0 || failed > 0) {
        this.logger.log(`Receipt retention: ${deleted} deleted, ${failed} failed`);
      }
    } catch (error) {
      this.logger.error(`Receipt retention failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  // Either the deposit was returned and the stay is over, or the stay ended more than
  // RECEIPT_RETENTION_DAYS_AFTER_CHECKOUT ago.
  async deleteExpiredReceipts(now: Date): Promise<{ deleted: number; failed: number }> {
    const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_DAYS_AFTER_CHECKOUT * DAY_MS);
    const images = await this.prisma.reservationImage.findMany({
      where: {
        deletedAt: null,
        reservation: {
          OR: [{ depositReturnedAt: { not: null }, checkOut: { lt: now } }, { checkOut: { lt: cutoff } }],
        },
      },
    });

    let deleted = 0;
    let failed = 0;
    for (const image of images) {
      try {
        // A file that's already gone counts as deleted (FileStorageService.delete ignores
        // ENOENT); anything else throws, and the row is left for tomorrow's run.
        await this.fileStorage.delete(RECEIPTS_SUBDIR, image.filename);
        await this.prisma.reservationImage.update({ where: { id: image.id }, data: { deletedAt: now } });
        deleted++;
      } catch (error) {
        failed++;
        this.logger.error(`Could not delete receipt ${image.id}: ${(error as Error).message}`);
      }
    }
    return { deleted, failed };
  }
}
