import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignFilterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuestsService } from '../guests/guests.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guestsService: GuestsService,
    private readonly emailService: EmailService,
  ) {}

  async preview(templateId: string, filterType: CampaignFilterType, filterMonths?: number) {
    const guests = await this.guestsService.findEligibleForCampaign(filterType, filterMonths);
    return { recipientCount: guests.length };
  }

  async send(templateId: string, filterType: CampaignFilterType, filterMonths?: number) {
    const template = await this.prisma.campaignTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    const guests = await this.guestsService.findEligibleForCampaign(filterType, filterMonths);

    const results: { guestId: string; status: 'SENT' | 'FAILED'; error: string | null }[] = [];

    for (const guest of guests) {
      const unsubscribeUrl = `${process.env.API_ORIGIN}/public/guests/${guest.unsubscribeToken}/unsubscribe`;
      const subject = template.subject.replaceAll('{{guestName}}', guest.name);
      const html = `${template.bodyHtml.replaceAll('{{guestName}}', guest.name)}<p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;

      try {
        await this.emailService.sendMarketingEmail(guest.email, subject, html);
        results.push({ guestId: guest.id, status: 'SENT', error: null });
      } catch (error) {
        results.push({ guestId: guest.id, status: 'FAILED', error: (error as Error).message });
      }
    }

    return this.prisma.campaign.create({
      data: {
        templateId,
        filterType,
        filterMonths: filterMonths ?? null,
        recipientCount: guests.length,
        recipients: { create: results },
      },
      include: { recipients: true },
    });
  }

  listHistory() {
    return this.prisma.campaign.findMany({
      orderBy: { sentAt: 'desc' },
      include: { template: true, recipients: true },
    });
  }
}
