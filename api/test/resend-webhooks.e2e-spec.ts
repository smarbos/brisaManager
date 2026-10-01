import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailSenderService } from '../src/email/email-sender.service';

// Resend signs webhooks with Svix: base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`, keyed with
// the base64 part of the `whsec_…` secret, sent as `svix-signature: v1,<signature>`.
const SECRET_BYTES = randomBytes(24);
const WEBHOOK_SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function signedHeaders(body: string, secretBytes = SECRET_BYTES) {
  const id = `msg_${randomBytes(8).toString('hex')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, 'content-type': 'application/json' };
}

describe('ResendWebhooksController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const savedEnv = { ...process.env };
  const sender = { send: jest.fn(), applyEffects: jest.fn() };
  const inboundEmailId = `e2e-inbound-${randomBytes(6).toString('hex')}`;

  const receivedEvent = (emailId: string) =>
    JSON.stringify({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId,
        created_at: new Date().toISOString(),
        from: 'Guest <guest@example.com>',
        to: ['reservas@inbound.labrisa.com.ar'],
        bcc: [],
        cc: [],
        received_for: ['reservas@inbound.labrisa.com.ar'],
        message_id: '<abc@example.com>',
        subject: 'Consulta por la reserva',
        attachments: [],
      },
    });

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.EMAIL_FORWARD_TO = 'staff@example.com';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSenderService)
      .useValue(sender)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
    sender.send.mockImplementation((entry: { id: string }) =>
      prisma.outboundEmail.update({ where: { id: entry.id }, data: { status: 'SENT', sentAt: new Date() } }),
    );
  });

  afterAll(async () => {
    await prisma.outboundEmail.deleteMany({ where: { inboundEmailId: { startsWith: 'e2e-inbound-' } } });
    await app.close();
    process.env = savedEnv;
  });

  it('forwards a received email to the staff mailbox right away', async () => {
    const body = receivedEvent(inboundEmailId);

    await request(app.getHttpServer()).post('/webhooks/resend').set(signedHeaders(body)).send(body).expect(200);

    const entries = await prisma.outboundEmail.findMany({ where: { inboundEmailId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'INBOUND_FORWARD',
      to: 'staff@example.com',
      subject: 'Fwd: Consulta por la reserva (de Guest <guest@example.com>)',
      status: 'SENT',
    });
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ inboundEmailId, status: 'SENDING' }));
  });

  it('ignores a repeated delivery of the same email', async () => {
    const body = receivedEvent(inboundEmailId);

    await request(app.getHttpServer()).post('/webhooks/resend').set(signedHeaders(body)).send(body).expect(200);

    expect(await prisma.outboundEmail.count({ where: { inboundEmailId } })).toBe(1);
  });

  it('rejects a request with a bad signature', async () => {
    const body = receivedEvent('e2e-inbound-forged');

    await request(app.getHttpServer())
      .post('/webhooks/resend')
      .set(signedHeaders(body, randomBytes(24)))
      .send(body)
      .expect(401);

    expect(await prisma.outboundEmail.count({ where: { inboundEmailId: 'e2e-inbound-forged' } })).toBe(0);
  });

  it('rejects a request without signature headers', async () => {
    const body = receivedEvent('e2e-inbound-unsigned');

    await request(app.getHttpServer()).post('/webhooks/resend').set('content-type', 'application/json').send(body).expect(401);
  });

  it('accepts and ignores other event types', async () => {
    const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'x' } });

    await request(app.getHttpServer()).post('/webhooks/resend').set(signedHeaders(body)).send(body).expect(200);
  });
});
