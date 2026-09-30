import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

// PublicReservationsService.confirmDates() fires GuestsService.syncFromReservation() without
// awaiting it (`void this.guestsService.syncFromReservation(...)`), so its writes land some
// time after the confirm-dates HTTP response returns. Tests that assert on those writes poll
// for them instead of racing a fixed-length sync assumption.
async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 3000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition was not met within the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('GuestsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-guests@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    await prisma.guest.create({ data: { email: 'e2e-guest-1@example.com', name: 'E2E Guest One' } });
  });

  afterAll(async () => {
    await prisma.guest.deleteMany({ where: { email: 'e2e-guest-1@example.com' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-guests@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/guests').expect(401);
  });

  it('lists guests', async () => {
    const response = await request(app.getHttpServer())
      .get('/guests')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.some((g: { email: string }) => g.email === 'e2e-guest-1@example.com')).toBe(true);
  });

  it('records a GuestEvent when an existing guest is re-synced with a different name', async () => {
    const reservationA = await prisma.reservation.create({
      data: {
        guestName: 'Placeholder',
        checkIn: new Date('2099-03-01'),
        checkOut: new Date('2099-03-05'),
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 50000,
        currency: 'ARS',
      },
    });
    const reservationB = await prisma.reservation.create({
      data: {
        guestName: 'Placeholder',
        checkIn: new Date('2099-04-01'),
        checkOut: new Date('2099-04-05'),
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 50000,
        currency: 'ARS',
      },
    });

    // A phone distinct from public-reservations.e2e-spec.ts's '+54 9 223 555-9999' (same
    // format, different number) — Guest.phone is globally unique, and Jest runs spec files
    // in parallel workers against the same database, so sharing that literal collides here.
    await request(app.getHttpServer())
      .post(`/public/reservations/${reservationA.confirmationToken}/confirm-dates`)
      .send({ fullName: 'Jane', phone: '+54 9 223 555-9998', email: 'e2e-guest-history@example.com' })
      .expect(201);

    // Wait for the first sync's *last* write (totalStays, set after guest upsert, event
    // recording, and reservation.guestId) so the second confirm-dates call below diffs
    // against a fully-settled guest row instead of racing the first sync.
    const guestAfterFirst = await waitFor(() =>
      prisma.guest
        .findUnique({ where: { email: 'e2e-guest-history@example.com' } })
        .then((g) => (g?.totalStays === 1 ? g : null)),
    );

    await request(app.getHttpServer())
      .post(`/public/reservations/${reservationB.confirmationToken}/confirm-dates`)
      .send({ fullName: 'Jane Doe', phone: '+54 9 223 555-9998', email: 'e2e-guest-history@example.com' })
      .expect(201);

    // Same wait for the second sync's last write, so cleanup below never races an in-flight
    // background write over the same rows.
    const guest = await waitFor(() =>
      prisma.guest.findUnique({ where: { id: guestAfterFirst.id } }).then((g) => (g?.totalStays === 2 ? g : null)),
    );

    const response = await request(app.getHttpServer())
      .get(`/guests/${guest.id}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.some((e: { type: string; detail: string }) =>
      e.type === 'NAME_CHANGED' && e.detail === 'Nombre: "Jane" → "Jane Doe"',
    )).toBe(true);

    await prisma.reservationEvent.deleteMany({ where: { reservationId: { in: [reservationA.id, reservationB.id] } } });
    await prisma.reservation.deleteMany({ where: { id: { in: [reservationA.id, reservationB.id] } } });
    await prisma.guestEvent.deleteMany({ where: { guestId: guest.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  });

  it('gets a single guest with their reservation history', async () => {
    const guest = await prisma.guest.findUniqueOrThrow({ where: { email: 'e2e-guest-1@example.com' } });

    const response = await request(app.getHttpServer())
      .get(`/guests/${guest.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.id).toBe(guest.id);
    expect(response.body.email).toBe('e2e-guest-1@example.com');
    expect(response.body.reservations).toEqual([]);
  });

  it('404s for an unknown guest id', async () => {
    await request(app.getHttpServer())
      .get('/guests/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
