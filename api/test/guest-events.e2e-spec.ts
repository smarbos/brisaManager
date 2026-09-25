import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('GuestEventsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let guestId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-guest-events@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    const guest = await prisma.guest.create({
      data: { email: 'e2e-guest-events-guest@example.com', name: 'E2E Log Guest' },
    });
    guestId = guest.id;
    await prisma.guestEvent.create({
      data: { guestId, type: 'NAME_CHANGED', detail: 'Nombre: "Jane" → "E2E Log Guest"' },
    });
  });

  afterAll(async () => {
    await prisma.guestEvent.deleteMany({ where: { guestId } });
    await prisma.guest.delete({ where: { id: guestId } });
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-guest-events@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/guest-events').expect(401);
  });

  it('lists events across all guests, including the guest each belongs to', async () => {
    const response = await request(app.getHttpServer())
      .get('/guest-events')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const event = response.body.find((e: { guestId: string }) => e.guestId === guestId);
    expect(event).toMatchObject({
      type: 'NAME_CHANGED',
      detail: 'Nombre: "Jane" → "E2E Log Guest"',
      guest: { name: 'E2E Log Guest', email: 'e2e-guest-events-guest@example.com' },
    });
  });
});
