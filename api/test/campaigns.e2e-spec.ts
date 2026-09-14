import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('CampaignsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let templateId: string;
  let guestId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
      data: { email: 'e2e-campaign-guest@example.com', name: 'E2E Campaign Guest' },
    });
    guestId = guest.id;
  });

  afterAll(async () => {
    await prisma.campaignRecipient.deleteMany({ where: { guestId } });
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

    expect(sendResponse.body.recipientCount).toBeGreaterThanOrEqual(1);

    const historyResponse = await request(app.getHttpServer())
      .get('/campaigns')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(historyResponse.body.some((c: { id: string }) => c.id === sendResponse.body.id)).toBe(true);
  });
});
