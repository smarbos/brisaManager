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
    // Reservations created through the real ReservationsService.create() now have a
    // RESERVATION_CREATED event row pointing at them — delete those first, or the reservation
    // delete below violates the ReservationEvent -> Reservation foreign key.
    const createdReservations = await prisma.reservation.findMany({
      where: { guestName: { in: ['E2E Guest', 'Overlap E2E Guest'] } },
      select: { id: true },
    });
    await prisma.reservationEvent.deleteMany({
      where: { reservationId: { in: createdReservations.map((r) => r.id) } },
    });
    await prisma.reservation.deleteMany({ where: { guestName: 'E2E Guest' } });
    await prisma.reservation.deleteMany({ where: { guestName: 'Overlap E2E Guest' } });
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

  it('finds overlapping reservations and respects excludeId', async () => {
    const first = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'Overlap E2E Guest',
        checkIn: '2026-07-01',
        checkOut: '2026-07-10',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      })
      .expect(201);

    const overlapResponse = await request(app.getHttpServer())
      .get('/reservations/check-overlap?checkIn=2026-07-05&checkOut=2026-07-08')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(overlapResponse.body.some((r: { id: string }) => r.id === first.body.id)).toBe(true);

    const excludedResponse = await request(app.getHttpServer())
      .get(`/reservations/check-overlap?checkIn=2026-07-05&checkOut=2026-07-08&excludeId=${first.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(excludedResponse.body.some((r: { id: string }) => r.id === first.body.id)).toBe(false);
  });
});
