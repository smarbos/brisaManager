import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('NotificationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-notifications@labrisa.com.ar';
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
    await prisma.notification.deleteMany({ where: { message: { contains: 'E2E notifications test' } } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-notifications@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication for every route', async () => {
    await request(app.getHttpServer()).get('/notifications').expect(401);
    await request(app.getHttpServer()).get('/notifications/unread-count').expect(401);
    await request(app.getHttpServer()).post('/notifications/some-id/read').expect(401);
  });

  it('lists notifications, reports an unread count, and marks one read', async () => {
    const created = await prisma.notification.create({
      data: { type: 'CALENDAR_MISMATCH', message: 'E2E notifications test alert' },
    });

    const listResponse = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listResponse.body.some((n: { id: string }) => n.id === created.id)).toBe(true);

    const beforeCount = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(beforeCount.body.count).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .post(`/notifications/${created.id}/read`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const updated = await prisma.notification.findUnique({ where: { id: created.id } });
    expect(updated?.readAt).not.toBeNull();
  });
});
