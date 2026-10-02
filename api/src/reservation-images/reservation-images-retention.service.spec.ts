import { ReservationImagesRetentionService, RECEIPT_RETENTION_DAYS_AFTER_CHECKOUT } from './reservation-images-retention.service';

describe('ReservationImagesRetentionService', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  let prisma: { reservationImage: { findMany: jest.Mock; update: jest.Mock } };
  let fileStorage: { delete: jest.Mock };
  let service: ReservationImagesRetentionService;

  beforeEach(() => {
    prisma = { reservationImage: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } };
    fileStorage = { delete: jest.fn() };
    service = new ReservationImagesRetentionService(prisma as never, fileStorage as never);
  });

  it('selects undeleted receipts whose stay ended with the deposit returned, or ended 30+ days ago', async () => {
    await service.deleteExpiredReceipts(now);

    const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_DAYS_AFTER_CHECKOUT * 86_400_000);
    expect(prisma.reservationImage.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        reservation: {
          OR: [{ depositReturnedAt: { not: null }, checkOut: { lt: now } }, { checkOut: { lt: cutoff } }],
        },
      },
    });
    expect(RECEIPT_RETENTION_DAYS_AFTER_CHECKOUT).toBe(30);
  });

  it('deletes each file, then marks its row deleted (keeping the row)', async () => {
    prisma.reservationImage.findMany.mockResolvedValue([
      { id: 'i1', filename: 'a.jpg' },
      { id: 'i2', filename: 'b.png' },
    ]);

    const result = await service.deleteExpiredReceipts(now);

    expect(fileStorage.delete).toHaveBeenCalledWith('receipts', 'a.jpg');
    expect(fileStorage.delete).toHaveBeenCalledWith('receipts', 'b.png');
    expect(prisma.reservationImage.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { deletedAt: now } });
    expect(prisma.reservationImage.update).toHaveBeenCalledWith({ where: { id: 'i2' }, data: { deletedAt: now } });
    expect(result).toEqual({ deleted: 2, failed: 0 });
  });

  it('isolates per-file failures: a file that cannot be deleted stays unmarked and the job continues', async () => {
    prisma.reservationImage.findMany.mockResolvedValue([
      { id: 'i1', filename: 'locked.jpg' },
      { id: 'i2', filename: 'b.png' },
    ]);
    fileStorage.delete.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    const result = await service.deleteExpiredReceipts(now);

    expect(prisma.reservationImage.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'i1' } }));
    expect(prisma.reservationImage.update).toHaveBeenCalledWith({ where: { id: 'i2' }, data: { deletedAt: now } });
    expect(result).toEqual({ deleted: 1, failed: 1 });
  });

  it('never lets the cron handler throw', async () => {
    prisma.reservationImage.findMany.mockRejectedValue(new Error('db down'));

    await expect(service.handleRetention()).resolves.toBeUndefined();
  });
});
