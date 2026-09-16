import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

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
