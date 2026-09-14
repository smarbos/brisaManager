import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignTemplatesService } from './campaign-templates.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignTemplatesService', () => {
  let service: CampaignTemplatesService;
  let prisma: {
    campaignTemplate: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    campaign: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      campaignTemplate: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
      campaign: { count: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [CampaignTemplatesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(CampaignTemplatesService);
  });

  it('creates a template', async () => {
    prisma.campaignTemplate.create.mockResolvedValue({ id: '1', name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' });

    const result = await service.create({ name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' });

    expect(result.id).toBe('1');
    expect(prisma.campaignTemplate.create).toHaveBeenCalledWith({
      data: { name: 'Welcome back', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
    });
  });

  it('lists all templates', async () => {
    prisma.campaignTemplate.findMany.mockResolvedValue([{ id: '1' }]);

    const result = await service.findAll();

    expect(result).toEqual([{ id: '1' }]);
  });

  it('throws NotFoundException when finding a missing template', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('updates a template', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue({ id: '1' });
    prisma.campaignTemplate.update.mockResolvedValue({ id: '1', name: 'Updated name' });

    const result = await service.update('1', { name: 'Updated name' });

    expect(result.name).toBe('Updated name');
  });

  it('deletes a template that is not referenced by any campaign', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue({ id: '1' });
    prisma.campaign.count.mockResolvedValue(0);

    await service.remove('1');

    expect(prisma.campaignTemplate.delete).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('refuses to delete a template referenced by a campaign', async () => {
    prisma.campaignTemplate.findUnique.mockResolvedValue({ id: '1' });
    prisma.campaign.count.mockResolvedValue(2);

    await expect(service.remove('1')).rejects.toThrow(BadRequestException);
    expect(prisma.campaignTemplate.delete).not.toHaveBeenCalled();
  });
});
