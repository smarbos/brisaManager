import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';

describe('PublicReservationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Some of these flows complete every auto-confirm condition and trigger a real final
    // confirmation email — the fake @example.com recipient makes Resend genuinely reject it,
    // which used to fire a real alert email to whoever ALERT_EMAIL points at in this
    // environment. Stubbed here so this suite never depends on (or spams) a real provider.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailService)
      .useValue({
        sendInitialConfirmationEmail: jest.fn().mockResolvedValue(undefined),
        sendFinalConfirmationEmail: jest.fn().mockResolvedValue(undefined),
        sendCancellationEmail: jest.fn().mockResolvedValue(undefined),
        sendMarketingEmail: jest.fn().mockResolvedValue(undefined),
        sendAlert: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
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
    await prisma.guest.deleteMany({
      where: { email: 'public-e2e-guest@example.com' },
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
        // Regression check: totalAmount comes from a real Prisma Decimal column here (unlike
        // the unit spec's mocked Prisma, which can't reproduce this) — Decimal serializes to
        // a JSON *string* unless explicitly cast with Number(), which silently broke guest-
        // web's toLocaleString() money formatting (a string's toLocaleString() just falls
        // back to toString(), no thousands separators).
        if (
          typeof res.body.totalAmount !== 'number' ||
          res.body.totalAmount !== 100000
        ) {
          throw new Error(
            `expected totalAmount to be the number 100000, got ${JSON.stringify(res.body.totalAmount)}`,
          );
        }
      });

    await request(app.getHttpServer())
      .post(
        `/public/reservations/${reservation.confirmationToken}/confirm-dates`,
      )
      .send({
        fullName: 'Jane Doe',
        phone: '+54 9 223 555-9999',
        email: 'public-e2e-guest@example.com',
      })
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
      .send({
        fullName: 'Jane Doe',
        phone: 'not a phone number',
        email: 'a@example.com',
      })
      .expect(400);
  });

  describe('receipt images', () => {
    it('uploads an image with a message, lists it, streams it back, and raises a notification', async () => {
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
        .field('message', 'es la seña')
        .attach('files', Buffer.from('fake png bytes'), {
          filename: 'comprobante.png',
          contentType: 'image/png',
        })
        .expect(200);

      expect(uploadResponse.body.images).toHaveLength(1);
      const uploaded = uploadResponse.body.images[0];
      expect(uploaded.id).toBeTruthy();
      expect(uploaded.reservationId).toBe(reservation.id);
      expect(uploaded.message).toBe('es la seña');

      const listResponse = await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/images`)
        .expect(200);
      expect(listResponse.body).toHaveLength(1);
      expect(listResponse.body[0].id).toBe(uploaded.id);

      const fileResponse = await request(app.getHttpServer())
        .get(
          `/public/reservations/${reservation.confirmationToken}/images/${uploaded.id}/file`,
        )
        .expect(200);
      expect(fileResponse.headers['content-type']).toContain('image/png');
      expect(fileResponse.body.toString()).toBe('fake png bytes');

      const notification = await prisma.notification.findFirst({
        where: {
          reservationId: reservation.id,
          type: 'PAYMENT_RECEIPT_UPLOADED',
        },
      });
      expect(notification).not.toBeNull();
      expect(notification?.message).toContain('Public E2E Guest');
      expect(notification?.message).toContain('es la seña');
    });

    it('uploads multiple images in one submission and raises exactly one notification', async () => {
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
        .attach('files', Buffer.from('fake png bytes 1'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .attach('files', Buffer.from('fake png bytes 2'), {
          filename: 'b.png',
          contentType: 'image/png',
        })
        .expect(200);

      expect(uploadResponse.body.images).toHaveLength(2);

      const notifications = await prisma.notification.findMany({
        where: {
          reservationId: reservation.id,
          type: 'PAYMENT_RECEIPT_UPLOADED',
        },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain('2 comprobantes');
    });

    it('accepts a message with no image and raises a GUEST_MESSAGE notification', async () => {
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
        .field('message', 'todavía no transferí')
        .expect(200);

      expect(uploadResponse.body.images).toHaveLength(0);

      const notification = await prisma.notification.findFirst({
        where: { reservationId: reservation.id, type: 'GUEST_MESSAGE' },
      });
      expect(notification).not.toBeNull();
      expect(notification?.message).toContain('todavía no transferí');
    });

    it('rejects a submission with neither a file nor a message', async () => {
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
        .expect(400);
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
        .attach('files', Buffer.from('not an image'), {
          filename: 'file.txt',
          contentType: 'text/plain',
        })
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
        .attach('files', Buffer.from('fake png bytes'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(200);

      await request(app.getHttpServer())
        .get(
          `/public/reservations/${reservationB.confirmationToken}/images/${uploadResponse.body.images[0].id}/file`,
        )
        .expect(404);
    });
  });

  describe('GET /public/reservations/:token/ambient', () => {
    const originalDebugMode = process.env.DEBUG_MODE;
    const AMBIENT_DEVICE_ID = 'e2e-public-ambient-device';

    beforeEach(() => {
      process.env.DEBUG_MODE = 'false';
    });

    afterEach(async () => {
      process.env.DEBUG_MODE = originalDebugMode;
      await prisma.ambientDeviceReading.deleteMany({ where: { deviceId: AMBIENT_DEVICE_ID } });
      await prisma.ambientDevice.deleteMany({ where: { id: AMBIENT_DEVICE_ID } });
    });

    it('returns 404 for an unknown token', async () => {
      await request(app.getHttpServer())
        .get('/public/reservations/does-not-exist/ambient')
        .expect(404);
    });

    it('returns 403 for a reservation that is not fully confirmed, even during its stay dates', async () => {
      const now = new Date();
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        },
      });

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(403);
    });

    it('returns 403 for a fully-confirmed reservation outside its stay dates', async () => {
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date('2020-01-01'),
          checkOut: new Date('2020-01-05'),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
          confirmationPaymentReceivedAt: new Date(),
          depositReceivedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(403);
    });

    it('returns current device readings for a fully-confirmed reservation during its stay', async () => {
      const now = new Date();
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          checkOut: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
          confirmationPaymentReceivedAt: now,
          depositReceivedAt: now,
        },
      });
      await prisma.ambientDevice.create({
        data: { id: AMBIENT_DEVICE_ID, name: 'E2E Living Room', lastSeenAt: now },
      });
      await prisma.ambientDeviceReading.create({
        data: { deviceId: AMBIENT_DEVICE_ID, sensor: 'temperature', level: 23 },
      });

      const response = await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(200);

      const device = response.body.find((d: { id: string }) => d.id === AMBIENT_DEVICE_ID);
      expect(device).toBeTruthy();
      expect(device.readings).toEqual(
        expect.arrayContaining([expect.objectContaining({ sensor: 'temperature', level: 23 })]),
      );
    });

    it('returns current device readings regardless of confirmation/dates when DEBUG_MODE is on', async () => {
      process.env.DEBUG_MODE = 'true';
      const reservation = await prisma.reservation.create({
        data: {
          guestName: 'Public E2E Guest',
          checkIn: new Date('2020-01-01'),
          checkOut: new Date('2020-01-05'),
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        },
      });

      await request(app.getHttpServer())
        .get(`/public/reservations/${reservation.confirmationToken}/ambient`)
        .expect(200);
    });
  });
});
