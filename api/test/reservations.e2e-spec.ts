import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ReservationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-reservations@labrisa.com.ar';
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
    await prisma.reservation.deleteMany({ where: { guestName: 'E2E Guest' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservations@labrisa.com.ar' } });
    await app.close();
  });

  it('creates, lists, and filters reservations by source', async () => {
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'E2E Guest',
        checkIn: '2026-02-01',
        checkOut: '2026-02-05',
        paxCount: 3,
        source: 'AIRBNB',
        totalAmount: 50000,
        currency: 'ARS',
      })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get('/reservations?source=AIRBNB')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(listResponse.body.some((r: { guestName: string }) => r.guestName === 'E2E Guest')).toBe(true);
  });

  it('rejects requests without a valid token', async () => {
    await request(app.getHttpServer()).get('/reservations').expect(401);
  });
});
