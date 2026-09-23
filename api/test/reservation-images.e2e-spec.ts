import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ReservationImagesController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-reservation-images@labrisa.com.ar';
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
    await prisma.notification.deleteMany({ where: { reservation: { guestName: 'Admin Images E2E Guest' } } });
    await prisma.reservationImage.deleteMany({ where: { reservation: { guestName: 'Admin Images E2E Guest' } } });
    await prisma.reservation.deleteMany({ where: { guestName: 'Admin Images E2E Guest' } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservation-images@labrisa.com.ar' } });
    await app.close();
  });

  async function createReservation() {
    return prisma.reservation.create({
      data: {
        guestName: 'Admin Images E2E Guest',
        checkIn: new Date('2026-03-01'),
        checkOut: new Date('2026-03-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });
  }

  it('requires authentication', async () => {
    const reservation = await createReservation();

    await request(app.getHttpServer()).get(`/reservations/${reservation.id}/images`).expect(401);
    await request(app.getHttpServer()).get(`/reservations/${reservation.id}/images/some-id/file`).expect(401);
  });

  it('lists images uploaded through the public endpoint and streams the file back', async () => {
    const reservation = await createReservation();

    const uploadResponse = await request(app.getHttpServer())
      .post(`/public/reservations/${reservation.confirmationToken}/images`)
      .attach('file', Buffer.from('fake png bytes'), { filename: 'comprobante.png', contentType: 'image/png' })
      .expect(200);

    const listResponse = await request(app.getHttpServer())
      .get(`/reservations/${reservation.id}/images`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].id).toBe(uploadResponse.body.id);

    const fileResponse = await request(app.getHttpServer())
      .get(`/reservations/${reservation.id}/images/${uploadResponse.body.id}/file`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(fileResponse.headers['content-type']).toContain('image/png');
    expect(fileResponse.body.toString()).toBe('fake png bytes');
  });

  it('returns 404 for an image requested through the wrong reservation id', async () => {
    const reservationA = await createReservation();
    const reservationB = await createReservation();

    const uploadResponse = await request(app.getHttpServer())
      .post(`/public/reservations/${reservationA.confirmationToken}/images`)
      .attach('file', Buffer.from('fake png bytes'), { filename: 'a.png', contentType: 'image/png' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/reservations/${reservationB.id}/images/${uploadResponse.body.id}/file`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
