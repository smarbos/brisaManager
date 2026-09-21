import { Test } from '@nestjs/testing';
import { ExtensionErrorsService } from './extension-errors.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ExtensionErrorsService', () => {
  let service: ExtensionErrorsService;
  let prisma: {
    extensionErrorLog: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = { extensionErrorLog: { create: jest.fn(), findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [ExtensionErrorsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ExtensionErrorsService);
  });

  it('records an error with every field populated', async () => {
    prisma.extensionErrorLog.create.mockResolvedValue({ id: '1' });

    await service.record({
      source: 'airbnb',
      resId: '1000000484',
      operation: 'submit_reservation',
      message: 'La Brisa respondió con un error (500).',
      detail: '{"error":"internal"}',
      url: 'https://www.airbnb.com/hosting/messages/1000000484',
      extensionVersion: '1.3.0',
    });

    expect(prisma.extensionErrorLog.create).toHaveBeenCalledWith({
      data: {
        source: 'airbnb',
        resId: '1000000484',
        operation: 'submit_reservation',
        message: 'La Brisa respondió con un error (500).',
        detail: '{"error":"internal"}',
        url: 'https://www.airbnb.com/hosting/messages/1000000484',
        extensionVersion: '1.3.0',
      },
    });
  });

  it('defaults missing optional fields to null', async () => {
    prisma.extensionErrorLog.create.mockResolvedValue({ id: '1' });

    await service.record({
      source: 'airbnb',
      operation: 'check_status',
      message: 'No pudimos conectar con La Brisa.',
      url: 'https://www.airbnb.com/hosting/messages/1000000484',
    });

    expect(prisma.extensionErrorLog.create).toHaveBeenCalledWith({
      data: {
        source: 'airbnb',
        resId: null,
        operation: 'check_status',
        message: 'No pudimos conectar con La Brisa.',
        detail: null,
        url: 'https://www.airbnb.com/hosting/messages/1000000484',
        extensionVersion: null,
      },
    });
  });

  it('lists every error most-recent-first', async () => {
    prisma.extensionErrorLog.findMany.mockResolvedValue([]);

    await service.listAll();

    expect(prisma.extensionErrorLog.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });
});
