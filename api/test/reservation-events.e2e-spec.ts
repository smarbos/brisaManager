import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ReservationEventsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let reservationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-reservation-events@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'E2E Log Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
      },
    });
    reservationId = reservation.id;
    await prisma.reservationEvent.create({
      data: { reservationId, type: 'RESERVATION_CREATED', detail: 'Created manually by staff' },
    });
  });

  afterAll(async () => {
    await prisma.reservationEvent.deleteMany({ where: { reservationId } });
    await prisma.reservation.delete({ where: { id: reservationId } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservation-events@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/reservation-events').expect(401);
  });

  it('lists events across all reservations, including which reservation each belongs to', async () => {
    const response = await request(app.getHttpServer())
      .get('/reservation-events')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const event = response.body.find((e: { reservationId: string }) => e.reservationId === reservationId);
    expect(event).toMatchObject({
      type: 'RESERVATION_CREATED',
      detail: 'Created manually by staff',
      reservation: { guestName: 'E2E Log Guest', source: 'DIRECT' },
    });
  });
});
