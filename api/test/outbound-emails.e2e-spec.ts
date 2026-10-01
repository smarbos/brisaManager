import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { EmailSenderService } from '../src/email/email-sender.service';

const SUBJECT = 'E2E outbox email';

describe('OutboundEmailsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  // Never reaches Resend: "sending" just marks the entry SENT, like a successful send would.
  const sender = {
    send: jest.fn(),
    applyEffects: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSenderService)
      .useValue(sender)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    sender.send.mockImplementation((entry: { id: string }) =>
      prisma.outboundEmail.update({ where: { id: entry.id }, data: { status: 'SENT', sentAt: new Date() } }),
    );

    const email = 'e2e-outbound-emails@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });
    accessToken = (await moduleRef.get(AuthService).login(email, 'password123')).accessToken;
  });

  afterAll(async () => {
    await prisma.outboundEmail.deleteMany({ where: { subject: SUBJECT } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-outbound-emails@labrisa.com.ar' } });
    await app.close();
  });

  function createEntry(status: 'SCHEDULED' | 'FAILED' | 'SENT' = 'SCHEDULED') {
    return prisma.outboundEmail.create({
      data: {
        kind: 'ALERT',
        status,
        to: 'owner@example.com',
        subject: SUBJECT,
        html: '<p>e2e</p>',
        sendAt: new Date(Date.now() + 300_000),
      },
    });
  }

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${accessToken}`);

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/outbound-emails').expect(401);
  });

  it('lists emails filtered by status, newest first', async () => {
    const scheduled = await createEntry('SCHEDULED');
    const failed = await createEntry('FAILED');

    const response = await auth(request(app.getHttpServer()).get('/outbound-emails').query({ status: 'FAILED' })).expect(200);

    const ids = response.body.map((e: { id: string }) => e.id);
    expect(ids).toContain(failed.id);
    expect(ids).not.toContain(scheduled.id);
  });

  it('rejects an unknown status filter', async () => {
    await auth(request(app.getHttpServer()).get('/outbound-emails').query({ status: 'NOPE' })).expect(400);
  });

  it('returns one email with its HTML', async () => {
    const entry = await createEntry();

    const response = await auth(request(app.getHttpServer()).get(`/outbound-emails/${entry.id}`)).expect(200);

    expect(response.body).toMatchObject({ id: entry.id, html: '<p>e2e</p>', status: 'SCHEDULED' });
  });

  it('aborts a scheduled email, then refuses to abort it again', async () => {
    const entry = await createEntry();

    const response = await auth(request(app.getHttpServer()).post(`/outbound-emails/${entry.id}/abort`)).expect(201);
    expect(response.body.status).toBe('ABORTED');

    const again = await auth(request(app.getHttpServer()).post(`/outbound-emails/${entry.id}/abort`)).expect(409);
    expect(again.body.message).toContain('no se puede abortar');
  });

  it('resends an aborted email as a new scheduled copy', async () => {
    const entry = await createEntry();
    await auth(request(app.getHttpServer()).post(`/outbound-emails/${entry.id}/abort`)).expect(201);

    const response = await auth(request(app.getHttpServer()).post(`/outbound-emails/${entry.id}/resend`)).expect(201);

    expect(response.body.id).not.toBe(entry.id);
    expect(response.body).toMatchObject({ status: 'SCHEDULED', resentFromId: entry.id, subject: SUBJECT });
  });

  it('retries a failed email right away', async () => {
    const entry = await createEntry('FAILED');

    const response = await auth(request(app.getHttpServer()).post(`/outbound-emails/${entry.id}/retry`)).expect(201);

    expect(response.body.status).toBe('SENT');
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, status: 'SENDING' }));
  });

  it('refuses to retry an email that has not failed', async () => {
    const entry = await createEntry('SCHEDULED');

    await auth(request(app.getHttpServer()).post(`/outbound-emails/${entry.id}/retry`)).expect(409);
  });

  it('404s an unknown email', async () => {
    await auth(request(app.getHttpServer()).post('/outbound-emails/00000000-0000-0000-0000-000000000000/abort')).expect(404);
  });
});
