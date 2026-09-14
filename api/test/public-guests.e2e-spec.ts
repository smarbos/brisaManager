import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PublicGuestsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.guest.deleteMany({ where: { email: { in: ['e2e-unsubscribe@example.com', 'e2e-unsubscribe-2@example.com'] } } });
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

    expect(response.text).toContain('unsubscribed');

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

    await prisma.guest.delete({ where: { id: guest.id } });
  });
});
