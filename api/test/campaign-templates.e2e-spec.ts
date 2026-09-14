import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('CampaignTemplatesController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let templateId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-campaign-templates@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    if (templateId) {
      await prisma.campaignTemplate.deleteMany({ where: { id: templateId } });
    }
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-campaign-templates@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/campaign-templates').expect(401);
  });

  it('creates, lists, updates, and deletes a template', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/campaign-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Template', subject: 'Hi {{guestName}}', bodyHtml: '<p>Hi {{guestName}}</p>' })
      .expect(201);

    templateId = createResponse.body.id;

    const listResponse = await request(app.getHttpServer())
      .get('/campaign-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listResponse.body.some((t: { id: string }) => t.id === templateId)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/campaign-templates/${templateId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Template Updated' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/campaign-templates/${templateId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    templateId = '';
  });
});
