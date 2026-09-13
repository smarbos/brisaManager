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
  });

  afterAll(async () => {
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
