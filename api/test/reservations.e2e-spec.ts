import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';

const sendTemplate = jest.fn().mockResolvedValue(true);

describe('ReservationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    // This file creates reservations with a guestPhone, which now sends the check-in link
    // over WhatsApp — stub it so no test ever messages a real number through Twilio.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WhatsappService)
      .useValue({ sendTemplate, sendMessage: jest.fn().mockResolvedValue(true) })
      .compile();
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
    // Guests synced from the emails these reservations were created with.
    const guestEmails = ['e2e-reservations-guest@example.com', 'only-email@example.com', 'edit-me@example.com'];
    await prisma.guestEvent.deleteMany({ where: { guest: { email: { in: guestEmails } } } });
    await prisma.reservation.updateMany({ where: { guest: { email: { in: guestEmails } } }, data: { guestId: null } });
    await prisma.guest.deleteMany({ where: { email: { in: guestEmails } } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservations@labrisa.com.ar' } });
    await app.close();
  });

  it('creates, lists, and filters reservations by source', async () => {
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'E2E Guest',
        guestEmail: 'e2e-reservations-guest@example.com',
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

  it('creates a reservation with a valid guest phone', async () => {
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'E2E Guest',
        guestPhone: '+54 9 223 555-9999',
        checkIn: '2026-02-01',
        checkOut: '2026-02-05',
        paxCount: 3,
        source: 'AIRBNB',
        totalAmount: 50000,
        currency: 'ARS',
      })
      .expect(201);
  });

  it('rejects creating a reservation with an invalid guest phone', async () => {
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'E2E Guest',
        guestPhone: 'not a phone number',
        checkIn: '2026-02-01',
        checkOut: '2026-02-05',
        paxCount: 3,
        source: 'AIRBNB',
        totalAmount: 50000,
        currency: 'ARS',
      })
      .expect(400);
  });

  it('finds overlapping reservations and respects excludeId', async () => {
    const first = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'Overlap E2E Guest',
        guestEmail: 'e2e-reservations-guest@example.com',
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

  describe('POST /reservations/:id/send-initial-whatsapp', () => {
    async function createReservation(guestPhone?: string) {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          guestName: 'E2E Guest',
          ...(guestPhone ? { guestPhone } : { guestEmail: 'e2e-reservations-guest@example.com' }),
          checkIn: '2026-11-01',
          checkOut: '2026-11-05',
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
        })
        .expect(201);
      return response.body as { id: string; confirmationWhatsappSentAt: string | null };
    }

    it('sends the link on creation when there is a phone', async () => {
      sendTemplate.mockClear();

      const created = await createReservation('+54 9 223 555-1234');

      expect(sendTemplate).toHaveBeenCalledTimes(1);
      const events = await prisma.reservationEvent.findMany({ where: { reservationId: created.id } });
      expect(events.map((e) => e.type)).toContain('INITIAL_WHATSAPP_SENT');
    });

    it('resends on demand and returns { sent, reservation }', async () => {
      const created = await createReservation('+54 9 223 555-1234');
      sendTemplate.mockClear();

      const response = await request(app.getHttpServer())
        .post(`/reservations/${created.id}/send-initial-whatsapp`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(sendTemplate).toHaveBeenCalledTimes(1);
      expect(response.body.sent).toBe(true);
      expect(response.body.reservation.confirmationWhatsappSentAt).not.toBeNull();
    });

    it('returns 400 for a reservation without a phone', async () => {
      const created = await createReservation();

      await request(app.getHttpServer())
        .post(`/reservations/${created.id}/send-initial-whatsapp`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).post('/reservations/any-id/send-initial-whatsapp').expect(401);
    });
  });

  describe('guest contact: email or phone, at least one', () => {
    const base = {
      guestName: 'E2E Guest',
      checkIn: '2026-12-01',
      checkOut: '2026-12-05',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
    };

    it('saves a reservation with only an email (the phone left empty)', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...base, guestEmail: 'only-email@example.com', guestPhone: '' })
        .expect(201);

      expect(response.body.guestEmail).toBe('only-email@example.com');
      expect(response.body.guestPhone).toBeNull();
    });

    it('saves a reservation with only a phone, storing the empty email as none', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...base, guestEmail: '', guestPhone: '+54 9 223 555-1111' })
        .expect(201);

      expect(response.body.guestEmail).toBeNull();
      expect(response.body.guestPhone).toBe('+54 9 223 555-1111');
    });

    it('rejects a reservation with neither email nor phone', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...base, guestEmail: '', guestPhone: '' })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toContain('email o el teléfono');
    });

    it('rejects an edit that clears both, but allows an edit that leaves them alone', async () => {
      const created = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...base, guestEmail: 'edit-me@example.com' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ guestEmail: '', guestPhone: '' })
        .expect(400)
        .expect((res) => expect(JSON.stringify(res.body.message)).toContain('email o el teléfono'));

      await request(app.getHttpServer())
        .patch(`/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ paxCount: 3 })
        .expect(200);
    });
  });
});
