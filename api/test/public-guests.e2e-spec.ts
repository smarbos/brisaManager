import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('PublicGuestsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-public-guests@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    // unsubscribeByToken() always records an UNSUBSCRIBED GuestEvent (see GuestsService), so
    // those rows must be cleared before the guests they reference, or the FK constraint on
    // GuestEvent.guestId rejects the delete.
    const guests = await prisma.guest.findMany({
      where: { email: { in: ['e2e-unsubscribe@example.com', 'e2e-unsubscribe-2@example.com', 'e2e-unsubscribe-event@example.com'] } },
    });
    await prisma.guestEvent.deleteMany({ where: { guestId: { in: guests.map((g) => g.id) } } });
    await prisma.guest.deleteMany({ where: { email: { in: ['e2e-unsubscribe@example.com', 'e2e-unsubscribe-2@example.com', 'e2e-unsubscribe-event@example.com'] } } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-public-guests@labrisa.com.ar' } });
    await app.close();
  });

  it('unsubscribes a guest by their token, with no authentication required', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'e2e-unsubscribe@example.com', name: 'E2E Unsubscribe Guest' },
    });
    expect(guest.unsubscribedAt).toBeNull();

    const response = await request(app.getHttpServer())
      .get(`/public/guests/${guest.unsubscribeToken}/unsubscribe`)
      .expect(200);

    expect(response.text).toContain('diste de baja');

    const updated = await prisma.guest.findUnique({ where: { id: guest.id } });
    expect(updated?.unsubscribedAt).not.toBeNull();
  });

  it('does not error for an unknown token', async () => {
    await request(app.getHttpServer()).get('/public/guests/unknown-token/unsubscribe').expect(200);
  });

  it('is idempotent for an already-unsubscribed guest', async () => {
    const guest = await prisma.guest.create({
      data: {
        email: 'e2e-unsubscribe-2@example.com',
        name: 'E2E Unsubscribe Guest 2',
        unsubscribedAt: new Date('2026-01-01'),
      },
    });

    await request(app.getHttpServer()).get(`/public/guests/${guest.unsubscribeToken}/unsubscribe`).expect(200);

    // unsubscribeByToken() records a GuestEvent on every call, even when already unsubscribed
    // (see GuestsService.unsubscribeByToken), so it must be cleared before the guest.
    await prisma.guestEvent.deleteMany({ where: { guestId: guest.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });

  it('records an UNSUBSCRIBED GuestEvent when unsubscribing succeeds', async () => {
    const guest = await prisma.guest.create({
      data: { email: 'e2e-unsubscribe-event@example.com', name: 'E2E Unsubscribe Event Guest' },
    });

    await request(app.getHttpServer())
      .get(`/public/guests/${guest.unsubscribeToken}/unsubscribe`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/guests/${guest.id}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.some((e: { type: string }) => e.type === 'UNSUBSCRIBED')).toBe(true);

    await prisma.guestEvent.deleteMany({ where: { guestId: guest.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });
});
