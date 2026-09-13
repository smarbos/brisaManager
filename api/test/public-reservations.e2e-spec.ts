import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PublicReservationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.reservationEvent.deleteMany({
      where: { reservation: { guestName: 'Public E2E Guest' } },
    });
    await prisma.reservation.deleteMany({
      where: { guestName: 'Public E2E Guest' },
    });
    await app.close();
  });

  it('returns 404 for an unknown token', async () => {
    await request(app.getHttpServer())
      .get('/public/reservations/does-not-exist')
      .expect(404);
  });

  it('walks through confirm-dates and accept-contract via the public endpoints', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Public E2E Guest',
        checkIn: new Date('2026-03-01'),
        checkOut: new Date('2026-03-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    await request(app.getHttpServer())
      .get(`/public/reservations/${reservation.confirmationToken}`)
      .expect(200)
      .expect((res) => {
        if (res.body.guestName !== 'Public E2E Guest')
          throw new Error('unexpected guestName');
      });

    await request(app.getHttpServer())
      .post(
        `/public/reservations/${reservation.confirmationToken}/confirm-dates`,
      )
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/public/reservations/${reservation.confirmationToken}/accept-contract`,
      )
      .send({ fullName: 'Jane Doe' })
      .expect(201);

    const updated = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(updated?.datesConfirmedAt).not.toBeNull();
    expect(updated?.contractAcceptedName).toBe('Jane Doe');
    expect(updated?.contractSnapshot).toBeTruthy();
  });

  it('rejects contract acceptance with an empty name', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Public E2E Guest',
        checkIn: new Date('2026-03-01'),
        checkOut: new Date('2026-03-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    await request(app.getHttpServer())
      .post(
        `/public/reservations/${reservation.confirmationToken}/accept-contract`,
      )
      .send({ fullName: '' })
      .expect(400);
  });
});
