import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReservationImagesService } from './reservation-images.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';

describe('ReservationImagesService', () => {
  let service: ReservationImagesService;
  let prisma: {
    reservation: { findUnique: jest.Mock };
    reservationImage: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let fileStorage: { save: jest.Mock; read: jest.Mock };

  beforeEach(async () => {
    prisma = {
      reservation: { findUnique: jest.fn() },
      reservationImage: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    fileStorage = { save: jest.fn(), read: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationImagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: FileStorageService, useValue: fileStorage },
      ],
    }).compile();

    service = moduleRef.get(ReservationImagesService);
  });

  describe('upload', () => {
    const file = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      originalname: 'comprobante.jpg',
      mimetype: 'image/jpeg',
      size: 12345,
    } as Express.Multer.File;

    it('saves the file and creates the row', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: 'res-1',
        guestName: 'Jane Doe',
      });
      fileStorage.save.mockResolvedValue('generated-uuid.jpg');
      prisma.reservationImage.create.mockResolvedValue({
        id: 'img-1',
        reservationId: 'res-1',
      });

      const result = await service.upload('res-1', file);

      expect(fileStorage.save).toHaveBeenCalledWith(
        'receipts',
        file.buffer,
        'receipt.jpg',
      );
      expect(prisma.reservationImage.create).toHaveBeenCalledWith({
        data: {
          reservationId: 'res-1',
          filename: 'generated-uuid.jpg',
          originalName: 'comprobante.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 12345,
          message: null,
        },
      });
      expect(result).toEqual({ id: 'img-1', reservationId: 'res-1' });
    });

    it('stores the given message on the row', async () => {
      prisma.reservation.findUnique.mockResolvedValue({
        id: 'res-1',
        guestName: 'Jane Doe',
      });
      fileStorage.save.mockResolvedValue('generated-uuid.jpg');
      prisma.reservationImage.create.mockResolvedValue({
        id: 'img-1',
        reservationId: 'res-1',
      });

      await service.upload('res-1', file, 'es la seña');

      expect(prisma.reservationImage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ message: 'es la seña' }),
      });
    });

    it('stores the type detected from the bytes, not the client-claimed mimetype', async () => {
      prisma.reservation.findUnique.mockResolvedValue({ id: 'res-1' });
      fileStorage.save.mockResolvedValue('generated-uuid.png');
      prisma.reservationImage.create.mockResolvedValue({ id: 'img-1' });

      await service.upload('res-1', {
        ...file,
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        originalname: 'recibo.html',
        mimetype: 'image/jpeg',
      } as Express.Multer.File);

      expect(fileStorage.save).toHaveBeenCalledWith(
        'receipts',
        expect.any(Buffer),
        'receipt.png',
      );
      expect(prisma.reservationImage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mimeType: 'image/png' }),
      });
    });

    it('rejects an SVG claiming to be an image and never saves it', async () => {
      const svg = {
        ...file,
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        originalname: 'recibo.svg',
        mimetype: 'image/svg+xml',
      } as Express.Multer.File;

      await expect(service.upload('res-1', svg)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(() => service.assertAllowedImages([file, svg])).toThrow(
        BadRequestException,
      );
      expect(fileStorage.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown reservation and never saves the file', async () => {
      prisma.reservation.findUnique.mockResolvedValue(null);

      await expect(service.upload('missing', file)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fileStorage.save).not.toHaveBeenCalled();
    });
  });

  describe('getOne', () => {
    it('returns the image when it belongs to the given reservation', async () => {
      prisma.reservationImage.findUnique.mockResolvedValue({
        id: 'img-1',
        reservationId: 'res-1',
      });

      const result = await service.getOne('res-1', 'img-1');

      expect(result).toEqual({ id: 'img-1', reservationId: 'res-1' });
    });

    it('throws NotFoundException when the image does not exist', async () => {
      prisma.reservationImage.findUnique.mockResolvedValue(null);

      await expect(service.getOne('res-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the image belongs to a different reservation', async () => {
      prisma.reservationImage.findUnique.mockResolvedValue({
        id: 'img-1',
        reservationId: 'res-OTHER',
      });

      await expect(service.getOne('res-1', 'img-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('streamOptions', () => {
    it('serves a detected raster type as itself', () => {
      expect(service.streamOptions({ mimeType: 'image/png' })).toEqual({
        type: 'image/png',
      });
    });

    it('serves a legacy SVG row as an opaque attachment', () => {
      expect(service.streamOptions({ mimeType: 'image/svg+xml' })).toEqual({
        type: 'application/octet-stream',
        disposition: 'attachment',
      });
    });
  });

  describe('listForReservation', () => {
    it('orders by newest first', async () => {
      prisma.reservationImage.findMany.mockResolvedValue([]);

      await service.listForReservation('res-1');

      expect(prisma.reservationImage.findMany).toHaveBeenCalledWith({
        where: { reservationId: 'res-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
