import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

// The full path a real Twilio status callback takes: form-encoded body through the global
// ValidationPipe, signature check, status applied, and the reservation list flagging it.
describe('WhatsApp delivery tracking (e2e)', () => {
  const API_ORIGIN = 'https://api.e2e.example';
  const AUTH_TOKEN = 'e2e-twilio-auth-token';
  const WEBHOOK_PATH = '/webhooks/twilio/whatsapp-status';
  const GUEST_NAME = 'WhatsApp Delivery E2E Guest';
  const originalOrigin = process.env.API_ORIGIN;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;

  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let reservationId: string;

  function signedStatus(params: Record<string, string>) {
    const signature = getExpectedTwilioSignature(AUTH_TOKEN, `${API_ORIGIN}${WEBHOOK_PATH}`, params);
    return request(app.getHttpServer())
      .post(WEBHOOK_PATH)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);
  }

  async function listedIssues() {
    const response = await request(app.getHttpServer())
      .get('/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const listed = (response.body as { id: string; whatsappIssues: unknown[] }[]).find((r) => r.id === reservationId);
    return listed?.whatsappIssues;
  }

  beforeAll(async () => {
    process.env.API_ORIGIN = API_ORIGIN;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-whatsapp-delivery@labrisa.com.ar';
    await prisma.adminUser.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash: await bcrypt.hash('password123', 10) },
    });
    accessToken = (await moduleRef.get(AuthService).login(email, 'password123')).accessToken;

    const reservation = await prisma.reservation.create({
      data: {
        guestName: GUEST_NAME,
        guestPhone: '+5491122334455',
        checkIn: new Date('2099-02-01'),
        checkOut: new Date('2099-02-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 1000,
        currency: 'ARS',
      },
    });
    reservationId = reservation.id;
    await prisma.whatsappMessage.create({
      data: { reservationId, kind: 'CHECKIN_LINK', twilioSid: 'SM-e2e-1', status: 'queued' },
    });
  });

  afterAll(async () => {
    await prisma.whatsappMessage.deleteMany({ where: { reservationId } });
    await prisma.reservationEvent.deleteMany({ where: { reservationId } });
    await prisma.reservation.deleteMany({ where: { guestName: GUEST_NAME } });
    process.env.API_ORIGIN = originalOrigin;
    process.env.TWILIO_AUTH_TOKEN = originalToken;
    await app.close();
  });

  it('rejects an unsigned callback without changing anything', async () => {
    await request(app.getHttpServer())
      .post(WEBHOOK_PATH)
      .type('form')
      .send({ MessageSid: 'SM-e2e-1', MessageStatus: 'undelivered' })
      .expect(403);

    const message = await prisma.whatsappMessage.findUnique({ where: { twilioSid: 'SM-e2e-1' } });
    expect(message?.status).toBe('queued');
  });

  it('marks the message undelivered from a signed callback, logs it, and flags the reservation', async () => {
    await signedStatus({ MessageSid: 'SM-e2e-1', MessageStatus: 'undelivered', ErrorCode: '63016' }).expect(204);

    const message = await prisma.whatsappMessage.findUnique({ where: { twilioSid: 'SM-e2e-1' } });
    expect(message).toMatchObject({ status: 'undelivered', errorCode: '63016' });

    const events = await prisma.reservationEvent.findMany({
      where: { reservationId, type: 'WHATSAPP_UNDELIVERED' },
    });
    expect(events).toHaveLength(1);

    expect(await listedIssues()).toEqual([{ kind: 'CHECKIN_LINK', status: 'undelivered', errorCode: '63016' }]);
  });

  it('ignores a late out-of-order callback', async () => {
    await signedStatus({ MessageSid: 'SM-e2e-1', MessageStatus: 'sent' }).expect(204);

    const message = await prisma.whatsappMessage.findUnique({ where: { twilioSid: 'SM-e2e-1' } });
    expect(message?.status).toBe('undelivered');
  });

  it('clears the warning once a later send of the same message is delivered', async () => {
    await prisma.whatsappMessage.create({
      data: { reservationId, kind: 'CHECKIN_LINK', twilioSid: 'SM-e2e-2', status: 'queued' },
    });
    await signedStatus({ MessageSid: 'SM-e2e-2', MessageStatus: 'delivered' }).expect(204);

    expect(await listedIssues()).toEqual([]);
  });
});
