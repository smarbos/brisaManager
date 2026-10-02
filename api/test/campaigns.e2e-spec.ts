import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/email/email.service';

describe('CampaignsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let templateId: string;
  let guestId: string;
  let sentCampaignId: string;

  beforeAll(async () => {
    // Stub EmailService so this test never makes a real outbound call to Resend: `filterType:
    // 'ALL'` below resolves every non-unsubscribed Guest row in the (shared) test database, not
    // just the one this file creates, so an un-mocked send here could email real people on any
    // environment with a real RESEND_API_KEY configured. overrideProvider still exercises the
    // full HTTP -> controller -> service -> Prisma path; it only replaces the one call that would
    // hit the external API.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ sendMarketingEmail: jest.fn().mockResolvedValue(undefined) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-campaigns@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    const template = await prisma.campaignTemplate.create({
      data: { name: 'E2E Campaign Template', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' },
    });
    templateId = template.id;

    const guest = await prisma.guest.create({
      // Campaigns only reach guests who opted in at check-in.
      data: { email: 'e2e-campaign-guest@example.com', name: 'E2E Campaign Guest', marketingConsentAt: new Date() },
    });
    guestId = guest.id;
  });

  afterAll(async () => {
    // filterType: 'ALL' in the send test below sweeps in every non-unsubscribed guest that
    // happens to exist in the shared test database at that moment, not just this file's own
    // guest — so it can create CampaignRecipient rows pointing at guests owned by other spec
    // files. Clean up by campaignId (every recipient this campaign created, whichever guest it
    // references) rather than by guestId, so no dangling recipient row is left blocking another
    // spec file's own guest.delete() in its afterAll (CampaignRecipient.guest is a required
    // relation with the default onDelete: Restrict).
    if (sentCampaignId) {
      await prisma.campaignRecipient.deleteMany({ where: { campaignId: sentCampaignId } });
    }
    await prisma.campaign.deleteMany({ where: { templateId } });
    await prisma.campaignTemplate.deleteMany({ where: { id: templateId } });
    await prisma.guest.deleteMany({ where: { id: guestId } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-campaigns@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication for preview', async () => {
    await request(app.getHttpServer()).get(`/campaigns/preview?templateId=${templateId}&filterType=ALL`).expect(401);
  });

  it('previews the recipient count without sending anything', async () => {
    const response = await request(app.getHttpServer())
      .get(`/campaigns/preview?templateId=${templateId}&filterType=ALL`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.recipientCount).toBeGreaterThanOrEqual(1);
  });

  it('requires filterMonths for a month-based filter', async () => {
    await request(app.getHttpServer())
      .get(`/campaigns/preview?templateId=${templateId}&filterType=STAYED_WITHIN_MONTHS`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('sends a campaign and records it in history', async () => {
    const sendResponse = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ templateId, filterType: 'ALL' })
      .expect(201);

    sentCampaignId = sendResponse.body.id;

    expect(sendResponse.body.recipientCount).toBeGreaterThanOrEqual(1);
    // Every recipient starts SCHEDULED: its email waits in the outbox, and EmailSenderService
    // moves it to SENT/FAILED/ABORTED when it goes out (EmailService is stubbed above).
    expect(
      sendResponse.body.recipients.every((r: { status: string }) => r.status === 'SCHEDULED'),
    ).toBe(true);
    const ownRecipient = sendResponse.body.recipients.find((r: { guestId: string }) => r.guestId === guestId);
    expect(ownRecipient).toBeDefined();

    const historyResponse = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(historyResponse.body.some((c: { id: string }) => c.id === sendResponse.body.id)).toBe(true);
  });
});
