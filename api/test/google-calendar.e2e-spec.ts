import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('GoogleCalendarController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-google-calendar@labrisa.com.ar';
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
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-google-calendar@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication for the connect-url endpoint', async () => {
    await request(app.getHttpServer()).get('/google-calendar/oauth/connect-url').expect(401);
  });

  it('returns a Google consent URL when authenticated', async () => {
    const response = await request(app.getHttpServer())
      .get('/google-calendar/oauth/connect-url')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.url).toContain('accounts.google.com');
  });

  it('requires authentication for the status endpoint', async () => {
    await request(app.getHttpServer()).get('/google-calendar/status').expect(401);
  });

  it('reports not connected in this test environment', async () => {
    const response = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.connected).toBe(false);
  });

  it('redirects to the admin app with an error when the callback is missing a code', async () => {
    const response = await request(app.getHttpServer()).get('/google-calendar/oauth/callback').expect(302);

    expect(response.headers.location).toContain('googleCalendar=error');
  });

  it('requires authentication for sync-now', async () => {
    await request(app.getHttpServer()).post('/google-calendar/sync-now').expect(401);
  });

  it('triggers a sync and returns a timestamp (not connected in this test env, so it succeeds as a no-op)', async () => {
    const response = await request(app.getHttpServer())
      .post('/google-calendar/sync-now')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(response.body.triggeredAt).toBeTruthy();
  });

  it('requires authentication for disconnect', async () => {
    await request(app.getHttpServer()).post('/google-calendar/disconnect').expect(401);
  });

  it('disconnects without error even when never connected', async () => {
    await request(app.getHttpServer())
      .post('/google-calendar/disconnect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
  });
});
