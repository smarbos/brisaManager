import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReservationsService } from '../src/reservations/reservations.service';

describe('ChannelImportController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const apiKey = process.env.EXTENSION_API_KEY as string;

  const basePayload = {
    source: 'booking.com',
    hotel_id: '9586863',
    res_id: 'e2e-test-res-id',
    guest_name: null,
    guest_email: null,
    check_in: null,
    check_out: null,
    guests: null,
    total_price: null,
    currency: null,
    status: null,
    unverified_fields: ['guest_name', 'check_in', 'check_out', 'guests', 'total_price', 'currency', 'status'],
  };

  beforeAll(async () => {
    // Any reservation with a guest_email now triggers a real confirmation-email attempt
    // (see ChannelImportService.import()), independent of whether other fields are
    // verified. ReservationsService.sendInitialEmail is fire-and-forget (`void ...`) —
    // mocking only EmailService still leaves its own internal Prisma writes (marking
    // confirmationEmailSentAt, recording an event) live, which raced against this test
    // file's own cleanup and crashed on a foreign-key violation once the reservation was
    // already deleted. Overriding the whole service removes that downstream write
    // entirely, not just the outbound Resend call — the exact call to sendInitialEmail is
    // already verified with mocks in channel-import.service.spec.ts, so this file doesn't
    // need to re-observe it, only confirm nothing here reaches a real external API.
    // This file's own request count (across every `it` below) has grown past the
    // endpoint's real 10-req/min-per-IP throttle limit, which exists to slow down brute-
    // force token guesses — a legitimate production concern, not something to loosen just
    // to fit a test suite. The guard runs against this test file's own isolated app
    // instance/in-memory throttle storage, so disabling it here has no effect on the real
    // limit or on any other test file.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ReservationsService)
      .useValue({ sendInitialEmail: jest.fn().mockResolvedValue(undefined) })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    const where = {
      OR: [
        { source: 'BOOKING' as const, externalReference: { startsWith: 'booking-extranet-e2e-test' } },
        { source: 'AIRBNB' as const, externalReference: { startsWith: 'airbnb-thread-e2e-test' } },
      ],
    };
    const created = await prisma.reservation.findMany({ where, select: { id: true } });
    await prisma.reservationEvent.deleteMany({ where: { reservationId: { in: created.map((r) => r.id) } } });
    await prisma.reservation.deleteMany({ where });
    await prisma.guest.deleteMany({ where: { email: 'e2e-test-guest@example.com' } });
    await app.close();
  });

  it('requires a valid API key', async () => {
    await request(app.getHttpServer()).post('/reservations/import').send(basePayload).expect(401);

    await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', 'Bearer wrong-key')
      .send(basePayload)
      .expect(401);
  });

  it('creates a placeholder reservation when every field is unverified', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(basePayload)
      .expect(201);

    expect(response.body.created).toBe(true);
    expect(response.body.guestName).toBe('Huésped de Booking.com (pendiente de completar)');
    expect(response.body.status).toBe('PENDING');

    const stored = await prisma.reservation.findUnique({
      where: { id: response.body.id },
    });
    expect(stored?.externalReference).toBe('booking-extranet-e2e-test-res-id');
    expect(stored?.notes).toContain('Campos sin verificar');
  });

  it('does not create a duplicate when the same res_id is imported again', async () => {
    const first = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...basePayload, res_id: 'e2e-test-dedupe' })
      .expect(201);
    expect(first.body.created).toBe(true);

    const second = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...basePayload, res_id: 'e2e-test-dedupe' })
      .expect(201);

    expect(second.body.created).toBe(false);
    expect(second.body.id).toBe(first.body.id);
  });

  it('creates a fresh reservation when the existing one for the same res_id was cancelled', async () => {
    const first = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...basePayload, res_id: 'e2e-test-cancelled-rebook' })
      .expect(201);
    expect(first.body.created).toBe(true);

    await prisma.reservation.update({ where: { id: first.body.id }, data: { status: 'CANCELLED' } });

    const second = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...basePayload, res_id: 'e2e-test-cancelled-rebook' })
      .expect(201);

    expect(second.body.created).toBe(true);
    expect(second.body.id).not.toBe(first.body.id);

    const oldReservation = await prisma.reservation.findUnique({ where: { id: first.body.id } });
    expect(oldReservation?.externalReference).toBe(
      `booking-extranet-e2e-test-cancelled-rebook-superseded-${first.body.id}`,
    );
    expect(oldReservation?.status).toBe('CANCELLED');

    const newReservation = await prisma.reservation.findUnique({ where: { id: second.body.id } });
    expect(newReservation?.externalReference).toBe('booking-extranet-e2e-test-cancelled-rebook');
  });

  it('stores the guest email and forces status to PENDING when a scraped status is present too', async () => {
    // Even with every core field verified (so this DOES reach the email-sending branch),
    // no real email goes out — EmailService is overridden for this whole file. Only the
    // reliable, synchronous outcomes are asserted: the fire-and-forget send call itself
    // (and the guest-record sync) are verified with mocks in channel-import.service.spec.ts,
    // not raced against here.
    const response = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        ...basePayload,
        res_id: 'e2e-test-guest-email',
        guest_name: 'E2E Test Guest',
        guest_email: 'E2E-Test-Guest@example.com',
        check_in: '2026-11-06',
        check_out: '2026-11-08',
        guests: 2,
        total_price: '$100',
        currency: 'ARS',
        status: 'confirmed',
        unverified_fields: [],
      })
      .expect(201);

    expect(response.body.status).toBe('PENDING');

    const stored = await prisma.reservation.findUnique({ where: { id: response.body.id } });
    expect(stored?.guestEmail).toBe('e2e-test-guest@example.com');
    expect(stored?.status).toBe('PENDING');
  });

  it('imports an Airbnb reservation without a hotel_id and returns a confirmation link + pre-filled message', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        source: 'airbnb',
        res_id: 'e2e-test-airbnb-thread',
        guest_name: 'María Laura',
        guest_email: null,
        check_in: '2026-11-06',
        check_out: '2026-11-08',
        guests: 3,
        total_price: null,
        currency: null,
        status: null,
        unverified_fields: ['check_in', 'check_out', 'total_price', 'currency', 'status'],
      })
      .expect(201);

    expect(response.body.created).toBe(true);
    expect(response.body.guestName).toBe('María Laura');
    expect(response.body.confirmationUrl).toContain('/r/');
    expect(response.body.message).toContain('María Laura');
    expect(response.body.message).toContain(response.body.confirmationUrl);

    const stored = await prisma.reservation.findUnique({ where: { id: response.body.id } });
    expect(stored?.source).toBe('AIRBNB');
    expect(stored?.externalReference).toBe('airbnb-thread-e2e-test-airbnb-thread');
  });

  it('does not create a duplicate Airbnb reservation when the same thread id is imported again', async () => {
    const payload = {
      source: 'airbnb',
      res_id: 'e2e-test-airbnb-dedupe',
      guest_name: 'Dedupe Guest',
      guest_email: null,
      check_in: null,
      check_out: null,
      guests: null,
      total_price: null,
      currency: null,
      status: null,
      unverified_fields: ['check_in', 'check_out', 'guests', 'total_price', 'currency', 'status'],
    };

    const first = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(payload)
      .expect(201);
    expect(first.body.created).toBe(true);

    const second = await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(payload)
      .expect(201);

    expect(second.body.created).toBe(false);
    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects a payload where check_out is not after check_in', async () => {
    await request(app.getHttpServer())
      .post('/reservations/import')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        ...basePayload,
        res_id: 'e2e-test-bad-dates',
        check_in: '2026-11-08',
        check_out: '2026-11-06',
        unverified_fields: [],
      })
      .expect(400);
  });
});
