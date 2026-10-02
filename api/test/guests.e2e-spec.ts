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

  it('recognizes a returning guest by document without letting the form overwrite their profile', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    // A's stay already ended (still inside the link's 30-day window); B is in the future.
    const reservationA = await prisma.reservation.create({
      data: {
        guestName: 'Placeholder',
        checkIn: new Date(Date.now() - 6 * DAY),
        checkOut: new Date(Date.now() - 2 * DAY),
        paxCount: 1,
        source: 'DIRECT',
        totalAmount: 50000,
        currency: 'ARS',
      },
    });
    const reservationB = await prisma.reservation.create({
      data: {
        guestName: 'Only A Name',
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
    // Same for the DNI: each e2e file uses its own.
    await request(app.getHttpServer())
      .post(`/public/reservations/${reservationA.confirmationToken}/confirm-dates`)
      .send({
        fullName: 'Jane',
        phone: '+54 9 223 555-9998',
        email: 'e2e-guest-history@example.com',
        documentType: 'DNI',
        documentNumber: '30.111.222',
      })
      .expect(201);

    // confirm-dates syncs the guest fire-and-forget: wait for the link before the second
    // check-in, so it sees a settled guest row.
    const linkedA = await waitFor(() =>
      prisma.reservation.findUnique({ where: { id: reservationA.id } }).then((r) => (r?.guestId ? r : null)),
    );

    // Same DNI, typed differently, with a different name and email.
    await request(app.getHttpServer())
      .post(`/public/reservations/${reservationB.confirmationToken}/confirm-dates`)
      .send({
        fullName: 'Someone Else',
        phone: '+54 9 223 555-9997',
        email: 'e2e-guest-other@example.com',
        documentType: 'DNI',
        documentNumber: '30111222',
      })
      .expect(201);

    const linkedB = await waitFor(() =>
      prisma.reservation.findUnique({ where: { id: reservationB.id } }).then((r) => (r?.guestId ? r : null)),
    );
    expect(linkedB.guestId).toBe(linkedA.guestId);

    const events = await waitFor(() =>
      prisma.guestEvent
        .findMany({ where: { guestId: linkedA.guestId as string, type: 'CONTACT_INFO_NOT_APPLIED' } })
        .then((rows) => (rows.length === 3 ? rows : null)),
    );
    expect(events.map((e) => e.field).sort()).toEqual(['email', 'name', 'phone']);

    const response = await request(app.getHttpServer())
      .get(`/guests/${linkedA.guestId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      name: 'Jane',
      phone: '+54 9 223 555-9998',
      email: 'e2e-guest-history@example.com',
      document: { type: 'DNI', country: 'AR', number: '30111222' },
      documentMasked: 'DNI ···222',
      // Only A's stay has happened.
      totalStays: 1,
    });
    expect(response.body).not.toHaveProperty('documentHash');
    expect(response.body.reservations).toHaveLength(2);
    expect(JSON.stringify(response.body.reservations)).not.toContain('30111222');

    // The list carries the masked document only, and search by document finds the guest.
    const list = await request(app.getHttpServer())
      .get('/guests')
      .query({ documentType: 'DNI', document: '30.111.222' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.map((g: { id: string }) => g.id)).toEqual([linkedA.guestId]);
    expect(list.text).not.toContain('30111222');

    await prisma.reservationEvent.deleteMany({ where: { reservationId: { in: [reservationA.id, reservationB.id] } } });
    await prisma.reservation.deleteMany({ where: { id: { in: [reservationA.id, reservationB.id] } } });
    await prisma.guestEvent.deleteMany({ where: { guestId: linkedA.guestId as string } });
    await prisma.guest.delete({ where: { id: linkedA.guestId as string } });
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
