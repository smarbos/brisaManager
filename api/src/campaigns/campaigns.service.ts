import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignFilterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuestsService } from '../guests/guests.service';
import { EmailService } from '../email/email.service';
import { escapeHtml } from '../common/escape-html';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guestsService: GuestsService,
    private readonly emailService: EmailService,
  ) {}

  async preview(templateId: string, filterType: CampaignFilterType, filterMonths?: number) {
    const guests = await this.guestsService.findEligibleForCampaign(filterType, filterMonths);
    const withoutConsent = await this.guestsService.findEligibleForCampaign(filterType, filterMonths, {
      requireConsent: false,
    });
    // How many guests would have been reached if consent weren't required — shown so staff
    // understand why the list is smaller than before (existing guests have no consent yet).
    return { recipientCount: guests.length, excludedForConsent: withoutConsent.length - guests.length };
  }

  async send(templateId: string, filterType: CampaignFilterType, filterMonths?: number) {
    const template = await this.prisma.campaignTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException(`Template ${templateId} not found`);
    }

    const guests = await this.guestsService.findEligibleForCampaign(filterType, filterMonths);

    // Every recipient starts SCHEDULED: each email waits in the outbox (5 minutes, abortable)
    // and EmailSenderService moves its recipient to SENT/FAILED/ABORTED. Pacing to stay under
    // Resend's rate limit happens in EmailDispatcherService, not here.
    const campaign = await this.prisma.campaign.create({
      data: {
        templateId,
        filterType,
        filterMonths: filterMonths ?? null,
        recipientCount: guests.length,
        recipients: { create: guests.map((guest) => ({ guestId: guest.id, status: 'SCHEDULED' as const, error: null })) },
      },
      include: { recipients: true },
    });

    for (const guest of guests) {
      const recipient = campaign.recipients.find((r) => r.guestId === guest.id);
      const unsubscribeUrl = `${process.env.API_ORIGIN}/public/guests/${guest.unsubscribeToken}/unsubscribe`;
      const subject = template.subject.replaceAll('{{guestName}}', guest.name);
      // The subject is plain text, but the body is HTML: guest.name is whatever the guest typed
      // on the check-in page, so it's escaped here.
      const html = `${template.bodyHtml.replaceAll('{{guestName}}', escapeHtml(guest.name))}<p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;

      try {
        // findEligibleForCampaign() filters to guests with a non-null email.
        await this.emailService.sendMarketingEmail(guest.email as string, subject, html, recipient?.id);
      } catch (error) {
        if (recipient) {
          await this.prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: 'FAILED', error: (error as Error).message },
          });
        }
      }
    }

    return campaign;
  }

  listHistory() {
    return this.prisma.campaign.findMany({
      orderBy: { sentAt: 'desc' },
      include: { template: true, recipients: true },
    });
  }
}
