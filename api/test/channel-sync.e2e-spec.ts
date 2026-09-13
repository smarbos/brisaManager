import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ChannelSyncController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let originalSettings: { houseRulesText: string; paymentInstructions: string; bookingIcalUrl: string | null; airbnbIcalUrl: string | null } | null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-channel-sync@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash },
    });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    // Preserve whatever real Settings exist before this test forces the iCal URLs to null.
    originalSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });

    // Force both feed URLs off so the sync genuinely runs as a no-op regardless of what's
    // actually configured in this environment, rather than relying on an ambient assumption.
    if (originalSettings) {
      await prisma.settings.update({
        where: { id: 'singleton' },
        data: { bookingIcalUrl: null, airbnbIcalUrl: null },
      });
    } else {
      await prisma.settings.create({
        data: {
          id: 'singleton',
          houseRulesText: 'E2E house rules',
          paymentInstructions: 'E2E payment instructions',
          bookingIcalUrl: null,
          airbnbIcalUrl: null,
        },
      });
    }
  });

  afterAll(async () => {
    if (originalSettings) {
      await prisma.settings.update({ where: { id: 'singleton' }, data: originalSettings });
    } else {
      await prisma.settings.delete({ where: { id: 'singleton' } }).catch(() => {
        // Already gone or never created — nothing to clean up.
      });
    }
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-channel-sync@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).post('/channel-sync/run').expect(401);
  });

  it('triggers a sync and returns a timestamp (both feed URLs unset in this test env, so it succeeds as a no-op)', async () => {
    const response = await request(app.getHttpServer())
      .post('/channel-sync/run')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(response.body.triggeredAt).toBeTruthy();
  });
});
