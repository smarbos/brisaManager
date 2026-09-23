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
    await prisma.notification.deleteMany({
      where: { reservation: { guestName: 'Public E2E Guest' } },
    });
    await prisma.reservationImage.deleteMany({
      where: { reservation: { guestName: 'Public E2E Guest' } },
    });
    await prisma.reservation.deleteMany({
      where: { guestName: 'Public E2E Guest' },
    });
    await prisma.guest.deleteMany({ where: { email: 'public-e2e-guest@example.com' } });
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
        // Regression check: totalAmount comes from a real Prisma Decimal column here (unlike
        // the unit spec's mocked Prisma, which can't reproduce this) — Decimal serializes to
        // a JSON *string* unless explicitly cast with Number(), which silently broke guest-
        // web's toLocaleString() money formatting (a string's toLocaleString() just falls
        // back to toString(), no thousands separators).
        if (typeof res.body.totalAmount !== 'number' || res.body.totalAmount !== 100000) {
          throw new Error(`expected totalAmount to be the number 100000, got ${JSON.stringify(res.body.totalAmount)}`);
        }
      });

    await request(app.getHttpServer())
      .post(
        `/public/reservations/${reservation.confirmationToken}/confirm-dates`,
      )
      .send({ fullName: 'Jane Doe', phone: '+54 9 223 555-9999', email: 'public-e2e-guest@example.com' })
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/public/reservations/${reservation.confirmationToken}/accept-contract`,
      )
      .expect(201);

    const updated = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    });
    expect(updated?.datesConfirmedAt).not.toBeNull();
    expect(updated?.contractAcceptedName).toBe('Jane Doe');
    expect(updated?.contractSnapshot).toBeTruthy();
    expect(updated?.guestPhone).toBe('+54 9 223 555-9999');
    expect(updated?.guestEmail).toBe('public-e2e-guest@example.com');
  });

  it('rejects date confirmation with an empty name', async () => {
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
        `/public/reservations/${reservation.confirmationToken}/confirm-dates`,
      )
      .send({ fullName: '', phone: '+54911', email: 'a@example.com' })
      .expect(400);
  });

  it('rejects date confirmation with an invalid phone number', async () => {
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
        `/public/reservations/${reservation.confirmationToken}/confirm-dates`,
      )
      .send({ fullName: 'Jane Doe', phone: 'not a phone number', email: 'a@example.com' })
      .expect(400);
  });

  describe('receipt images', () => {
    it('uploads an image, lists it, streams it back, and raises a notification', async () => {
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

      const uploadResponse = await request(app.getHttpServer())
        .post(`/public/reservations/${reservation.confirmationToken}/images`)
        .attach('file', Buffer.from('fake png bytes'), { filename: 'comprobante.png', contentType: 'image/png' })
        .expect(200);

      expect(uploadResponse.body.id).toBeTruthy();
      expect(uploadResponse.body.reservationId).toBe(reservation.id);

      const listResponse = await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/images`)
        .expect(200);
      expect(listResponse.body).toHaveLength(1);
      expect(listResponse.body[0].id).toBe(uploadResponse.body.id);

      const fileResponse = await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/images/${uploadResponse.body.id}/file`)
        .expect(200);
      expect(fileResponse.headers['content-type']).toContain('image/png');
      expect(fileResponse.body.toString()).toBe('fake png bytes');

      const notification = await prisma.notification.findFirst({
        where: { reservationId: reservation.id, type: 'PAYMENT_RECEIPT_UPLOADED' },
      });
      expect(notification).not.toBeNull();
      expect(notification?.message).toContain('Public E2E Guest');
    });

    it('rejects a non-image file', async () => {
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
        .post(`/public/reservations/${reservation.confirmationToken}/images`)
        .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' })
        .expect(400);
    });

    it('returns 404 for an image requested through the wrong reservation token', async () => {
      const reservationA = await prisma.reservation.create({
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
      const reservationB = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date('2026-04-01'),
          checkOut: new Date('2026-04-05'),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        },
      });

      const uploadResponse = await request(app.getHttpServer())
        .post(`/public/reservations/${reservationA.confirmationToken}/images`)
        .attach('file', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservationB.confirmationToken}/images/${uploadResponse.body.id}/file`)
        .expect(404);
    });
  });
});
