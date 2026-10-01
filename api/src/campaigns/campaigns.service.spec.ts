import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { GuestsService } from '../guests/guests.service';
import { EmailService } from '../email/email.service';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: {
    campaignTemplate: { findUnique: jest.Mock };
    campaign: { create: jest.Mock; findMany: jest.Mock };
    campaignRecipient: { update: jest.Mock };
  };
  let guestsService: { findEligibleForCampaign: jest.Mock };
  let emailService: { sendMarketingEmail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      campaignTemplate: { findUnique: jest.fn() },
      campaign: { create: jest.fn(), findMany: jest.fn() },
      campaignRecipient: { update: jest.fn() },
    };
    guestsService = { findEligibleForCampaign: jest.fn() };
    emailService = { sendMarketingEmail: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GuestsService, useValue: guestsService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(CampaignsService);
    process.env.API_ORIGIN = 'http://localhost:3001';
  });

  describe('preview', () => {
    it('returns the count of eligible guests without sending anything', async () => {
      guestsService.findEligibleForCampaign.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);

      const result = await service.preview('tpl-1', 'ALL');

      expect(result).toEqual({ recipientCount: 2 });
      expect(emailService.sendMarketingEmail).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('throws NotFoundException for a missing template', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue(null);

      await expect(service.send('missing', 'ALL')).rejects.toThrow(NotFoundException);
    });

    it('creates the Campaign with every recipient SCHEDULED and queues one email per recipient', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        subject: 'Hi {{guestName}}',
        bodyHtml: '<p>Hi {{guestName}}</p>',
      });
      guestsService.findEligibleForCampaign.mockResolvedValue([
        { id: 'g1', name: 'Jane Doe', email: 'jane@example.com', unsubscribeToken: 'tok-1' },
        { id: 'g2', name: 'John Smith', email: 'john@example.com', unsubscribeToken: 'tok-2' },
      ]);
      const created = {
        id: 'camp-1',
        recipientCount: 2,
        recipients: [
          { id: 'cr-1', guestId: 'g1', status: 'SCHEDULED' },
          { id: 'cr-2', guestId: 'g2', status: 'SCHEDULED' },
        ],
      };
      prisma.campaign.create.mockResolvedValue(created);
      emailService.sendMarketingEmail.mockResolvedValue({ id: 'e1' });

      const result = await service.send('tpl-1', 'ALL');

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: {
          templateId: 'tpl-1',
          filterType: 'ALL',
          filterMonths: null,
          recipientCount: 2,
          recipients: {
            create: [
              { guestId: 'g1', status: 'SCHEDULED', error: null },
              { guestId: 'g2', status: 'SCHEDULED', error: null },
            ],
          },
        },
        include: { recipients: true },
      });
      expect(emailService.sendMarketingEmail).toHaveBeenNthCalledWith(
        1,
        'jane@example.com',
        'Hi Jane Doe',
        expect.stringContaining('Hi Jane Doe'),
        'cr-1',
      );
      expect(emailService.sendMarketingEmail).toHaveBeenNthCalledWith(
        2,
        'john@example.com',
        'Hi John Smith',
        expect.stringContaining('Hi John Smith'),
        'cr-2',
      );
      expect(emailService.sendMarketingEmail.mock.calls[0][2]).toContain('http://localhost:3001/public/guests/tok-1/unsubscribe');
      expect(result).toBe(created);
    });

    it('marks a recipient FAILED when its email could not be queued', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', subject: 'Hi', bodyHtml: '<p>Hi</p>' });
      guestsService.findEligibleForCampaign.mockResolvedValue([
        { id: 'g1', name: 'Jane Doe', email: 'jane@example.com', unsubscribeToken: 'tok-1' },
      ]);
      prisma.campaign.create.mockResolvedValue({
        id: 'camp-1',
        recipientCount: 1,
        recipients: [{ id: 'cr-1', guestId: 'g1', status: 'SCHEDULED' }],
      });
      emailService.sendMarketingEmail.mockRejectedValue(new Error('db down'));

      await service.send('tpl-1', 'ALL');

      expect(prisma.campaignRecipient.update).toHaveBeenCalledWith({
        where: { id: 'cr-1' },
        data: { status: 'FAILED', error: 'db down' },
      });
    });

    it('creates a Campaign row with zero SENT even when there are no eligible guests', async () => {
      prisma.campaignTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', subject: 'Hi', bodyHtml: '<p>Hi</p>' });
      guestsService.findEligibleForCampaign.mockResolvedValue([]);
      prisma.campaign.create.mockResolvedValue({ id: 'camp-1', recipientCount: 0, recipients: [] });

      await service.send('tpl-1', 'ALL');

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ recipientCount: 0, recipients: { create: [] } }),
        include: { recipients: true },
      });
    });
  });

  describe('listHistory', () => {
    it('returns campaigns ordered most-recent-first with template and recipients included', async () => {
      prisma.campaign.findMany.mockResolvedValue([{ id: 'camp-1' }]);

      const result = await service.listHistory();

      expect(prisma.campaign.findMany).toHaveBeenCalledWith({
        orderBy: { sentAt: 'desc' },
        include: { template: true, recipients: true },
      });
      expect(result).toEqual([{ id: 'camp-1' }]);
    });
  });
});
