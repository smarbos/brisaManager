jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { createWorker } from 'tesseract.js';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('ReservationImportController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    (createWorker as jest.Mock).mockResolvedValue({
      recognize: jest.fn().mockResolvedValue({
        data: { text: 'Jane Doe\n5459856627 Genius\nvie, 6 nov 2026 dom, 8 nov 2026\n3 adultos' },
      }),
      terminate: jest.fn().mockResolvedValue(undefined),
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-reservation-import@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({ where: { email }, update: {}, create: { email, passwordHash } });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;
  });

  afterAll(async () => {
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-reservation-import@labrisa.com.ar' } });
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/reservation-import/parse-screenshot')
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'screenshot.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('extracts reservation fields from an uploaded screenshot', async () => {
    const response = await request(app.getHttpServer())
      .post('/reservation-import/parse-screenshot')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'screenshot.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(response.body).toEqual({
      guestName: 'Jane Doe',
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });
  });
});
