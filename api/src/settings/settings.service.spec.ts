import { Test } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: { settings: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      settings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SettingsService);
  });

  it('creates default settings on first read if none exist', async () => {
    prisma.settings.findUnique.mockResolvedValue(null);
    prisma.settings.create.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'default rules',
      paymentInstructions: 'default payment info',
    });

    const result = await service.get();

    expect(prisma.settings.create).toHaveBeenCalled();
    expect(result.id).toBe('singleton');
  });

  it('returns existing settings without creating a new row', async () => {
    prisma.settings.findUnique.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'existing',
      paymentInstructions: 'existing',
    });

    await service.get();

    expect(prisma.settings.create).not.toHaveBeenCalled();
  });

  it('updates settings', async () => {
    prisma.settings.findUnique.mockResolvedValue({ id: 'singleton' });
    prisma.settings.update.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'new rules',
      paymentInstructions: 'new payment info',
    });

    const result = await service.update({ houseRulesText: 'new rules', paymentInstructions: 'new payment info' });

    expect(result.houseRulesText).toBe('new rules');
  });
});
