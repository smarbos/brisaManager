import { PrismaClient } from '@prisma/client';

describe('Marketing/CRM schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a Guest, links a Reservation to it, and reads the link back', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'schema-test-guest@example.com', name: 'Schema Test Guest' },
    });

    expect(guest.unsubscribeToken).toBeTruthy();
    expect(guest.totalStays).toBe(0);

    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        guestId: guest.id,
      },
    });

    const found = await prisma.guest.findUnique({
      where: { id: guest.id },
      include: { reservations: true },
    });

    expect(found?.reservations.map((r) => r.id)).toEqual([reservation.id]);

    await prisma.reservation.delete({ where: { id: reservation.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });

  it('creates a CampaignTemplate, a Campaign, and a CampaignRecipient, and links them', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'schema-test-recipient@example.com', name: 'Schema Test Recipient' },
    });
    const template = await prisma.campaignTemplate.create({
      data: { name: 'Schema Test Template', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' },
    });

    const campaign = await prisma.campaign.create({
      data: {
        templateId: template.id,
        filterType: 'ALL',
        recipientCount: 1,
        recipients: {
          create: [{ guestId: guest.id, status: 'SENT' }],
        },
      },
      include: { recipients: true },
    });

    expect(campaign.recipients).toHaveLength(1);
    expect(campaign.recipients[0].status).toBe('SENT');

    // A template referenced by a campaign must not be deletable at the database level either
    // (defense-in-depth alongside the service-layer check added in a later task).
    await expect(prisma.campaignTemplate.delete({ where: { id: template.id } })).rejects.toThrow();

    await prisma.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.campaignTemplate.delete({ where: { id: template.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });
});
