import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('SettingsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let originalSettings: {
    houseRulesText: string;
    paymentInstructions: string;
    depositInstructions: string;
    propertyAddress: string;
    googleMapsUrl: string;
    initialEmailTemplate: string;
    finalEmailTemplate: string;
    cancellationEmailTemplate: string;
    bookingIcalUrl: string | null;
    airbnbIcalUrl: string | null;
    reservationReminderDaysBefore: number;
    depositReminderDaysAfter: number;
    reservationReminderWhatsappTemplate: string;
    depositReminderWhatsappTemplate: string;
  } | null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleRef.get(PrismaService);

    const email = 'e2e-settings@labrisa.com.ar';
    const passwordHash = await bcrypt.hash('password123', 10);
    await prisma.adminUser.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash },
    });

    const authService = moduleRef.get(AuthService);
    const { accessToken: token } = await authService.login(email, 'password123');
    accessToken = token;

    // Preserve whatever real Settings exist before this test mutates them
    originalSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
  });

  afterAll(async () => {
    if (originalSettings) {
      await prisma.settings.update({ where: { id: 'singleton' }, data: originalSettings });
    } else {
      await prisma.settings.delete({ where: { id: 'singleton' } }).catch(() => {
        // Already gone or never created — nothing to clean up.
      });
    }
    await prisma.adminUser.deleteMany({ where: { email: 'e2e-settings@labrisa.com.ar' } });
    await app.close();
  });

  it('persists bookingIcalUrl and airbnbIcalUrl through PUT /settings', async () => {
    const response = await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        houseRulesText: 'E2E house rules',
        paymentInstructions: 'E2E payment instructions',
        depositInstructions: 'E2E deposit instructions',
        propertyAddress: 'E2E property address',
        googleMapsUrl: 'https://maps.example/e2e',
        initialEmailTemplate: 'E2E initial template {{guestName}}',
        finalEmailTemplate: 'E2E final template {{guestName}}',
        cancellationEmailTemplate: 'E2E cancellation template {{guestName}}',
        reservationReminderDaysBefore: 3,
        depositReminderDaysAfter: 3,
        reservationReminderWhatsappTemplate: 'E2E reservation reminder template {{guestName}}',
        depositReminderWhatsappTemplate: 'E2E deposit reminder template {{guestName}}',
        bookingIcalUrl: 'https://booking.example/e2e-cal.ics',
        airbnbIcalUrl: 'https://airbnb.example/e2e-cal.ics',
      })
      .expect(200);

    expect(response.body.bookingIcalUrl).toBe('https://booking.example/e2e-cal.ics');
    expect(response.body.airbnbIcalUrl).toBe('https://airbnb.example/e2e-cal.ics');

    const getResponse = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(getResponse.body.bookingIcalUrl).toBe('https://booking.example/e2e-cal.ics');
    expect(getResponse.body.airbnbIcalUrl).toBe('https://airbnb.example/e2e-cal.ics');
  });

  it('persists the WhatsApp reminder settings through PUT /settings', async () => {
    const response = await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        houseRulesText: 'E2E house rules',
        paymentInstructions: 'E2E payment instructions',
        depositInstructions: 'E2E deposit instructions',
        propertyAddress: 'E2E property address',
        googleMapsUrl: 'https://maps.example/e2e',
        initialEmailTemplate: 'E2E initial template {{guestName}}',
        finalEmailTemplate: 'E2E final template {{guestName}}',
        cancellationEmailTemplate: 'E2E cancellation template {{guestName}}',
        reservationReminderDaysBefore: 5,
        depositReminderDaysAfter: 4,
        reservationReminderWhatsappTemplate: 'E2E WhatsApp reservation reminder {{guestName}}',
        depositReminderWhatsappTemplate: 'E2E WhatsApp deposit reminder {{guestName}}',
      })
      .expect(200);

    expect(response.body.reservationReminderDaysBefore).toBe(5);
    expect(response.body.depositReminderDaysAfter).toBe(4);
    expect(response.body.reservationReminderWhatsappTemplate).toBe('E2E WhatsApp reservation reminder {{guestName}}');
    expect(response.body.depositReminderWhatsappTemplate).toBe('E2E WhatsApp deposit reminder {{guestName}}');

    const getResponse = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(getResponse.body.reservationReminderDaysBefore).toBe(5);
    expect(getResponse.body.depositReminderDaysAfter).toBe(4);
  });
});
