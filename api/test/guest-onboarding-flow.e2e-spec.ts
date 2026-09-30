import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/email/email.service';

describe('Full guest onboarding flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    // This flow's auto-confirm step sends a real final-confirmation email — the reservation
    // uses a fake @example.com address, which Resend genuinely rejects, and that rejection
    // used to trigger a REAL alert email to whoever ALERT_EMAIL points at in this
    // environment. Stubbed here so the flow exercises confirmation logic without depending
    // on (or spamming) a real email provider.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-onboarding@labrisa.com.ar';
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
    await prisma.reservationEvent.deleteMany({
      where: { reservation: { guestName: 'Onboarding E2E Guest' } },
    });
    await prisma.reservation.deleteMany({ where: { guestName: 'Onboarding E2E Guest' } });
    // acceptContract now always syncs a Guest record from the phone/email the guest submits.
    await prisma.guest.deleteMany({ where: { email: 'onboarding-e2e-guest@example.com' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-onboarding@labrisa.com.ar' } });
    await app.close();
  });

  it('auto-confirms once all 4 onboarding steps are complete, in any order', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'Onboarding E2E Guest',
        checkIn: '2099-05-01',
        checkOut: '2099-05-05',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 150000,
        currency: 'ARS',
      })
      .expect(201);

    const reservationId = createResponse.body.id;
    const token = createResponse.body.confirmationToken;

    // Staff marks payment and deposit received first
    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-payment-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-deposit-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    // Reservation should still be PENDING — guest hasn't confirmed dates or accepted the contract yet
    let current = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(current?.status).toBe('PENDING');

    // Guest confirms dates (also giving name/phone/email) and accepts the contract
    await request(app.getHttpServer())
      .post(`/public/reservations/${token}/confirm-dates`)
      .send({ fullName: 'Onboarding E2E Guest', phone: '+54 9 223 555-0000', email: 'onboarding-e2e-guest@example.com' })
      .expect(201);
    await request(app.getHttpServer()).post(`/public/reservations/${token}/accept-contract`).expect(201);

    // Now all 4 conditions are met — reservation should be auto-confirmed
    current = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(current?.status).toBe('CONFIRMED');

    const eventsResponse = await request(app.getHttpServer())
      .get(`/reservations/${reservationId}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const eventTypes = eventsResponse.body.map((event: { type: string }) => event.type);
    expect(eventTypes).toContain('PAYMENT_RECEIVED');
    expect(eventTypes).toContain('DEPOSIT_RECEIVED');
    expect(eventTypes).toContain('DATES_CONFIRMED');
    expect(eventTypes).toContain('CONTRACT_ACCEPTED');
    expect(eventTypes).toContain('RESERVATION_CONFIRMED');
  });

  it('marking an already-marked step is idempotent (no error, no duplicate event)', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        guestName: 'Onboarding E2E Guest',
        checkIn: '2099-06-01',
        checkOut: '2099-06-05',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 150000,
        currency: 'ARS',
      })
      .expect(201);

    const reservationId = createResponse.body.id;

    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-payment-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/reservations/${reservationId}/mark-payment-received`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const eventsResponse = await request(app.getHttpServer())
      .get(`/reservations/${reservationId}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const paymentEvents = eventsResponse.body.filter((event: { type: string }) => event.type === 'PAYMENT_RECEIVED');
    expect(paymentEvents).toHaveLength(1);
  });
});
