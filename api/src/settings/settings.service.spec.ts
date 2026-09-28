import { Test } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: { settings: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      settings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(SettingsService);
  });

  it('creates default settings on first read if none exist', async () => {
    prisma.settings.findUnique.mockResolvedValue(null);
    prisma.settings.create.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'default rules',
      paymentInstructions: 'default payment info',
    });

    const result = await service.get();

    expect(prisma.settings.create).toHaveBeenCalled();
    expect(result.id).toBe('singleton');
  });

  it('seeds the email templates and property fields alongside the house rules on first read', async () => {
    prisma.settings.findUnique.mockResolvedValue(null);
    prisma.settings.create.mockImplementation(({ data }) => Promise.resolve(data));

    const result = await service.get();

    expect(result.initialEmailTemplate).toContain('{{guestName}}');
    expect(result.initialEmailTemplate).toContain('{{confirmationUrl}}');
    expect(result.finalEmailTemplate).toContain('{{propertyAddress}}');
    expect(result.finalEmailTemplate).toContain('{{googleMapsUrl}}');
    expect(result.finalEmailTemplate).toContain('{{confirmationUrl}}');
    expect(result.cancellationEmailTemplate).toContain('{{checkIn}}');
    expect(result.cancellationEmailTemplate).toContain('{{checkOut}}');
    expect(result.propertyAddress).toBeTruthy();
    expect(result.googleMapsUrl).toBe('');
  });

  it('returns existing settings without creating a new row', async () => {
    prisma.settings.findUnique.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'existing',
      paymentInstructions: 'existing',
    });

    await service.get();

    expect(prisma.settings.create).not.toHaveBeenCalled();
  });

  it('updates settings', async () => {
    prisma.settings.findUnique.mockResolvedValue({ id: 'singleton' });
    prisma.settings.update.mockResolvedValue({
      id: 'singleton',
      houseRulesText: 'new rules',
      paymentInstructions: 'new payment info',
      depositInstructions: 'new deposit info',
    });

    const result = await service.update({
      houseRulesText: 'new rules',
      paymentInstructions: 'new payment info',
      depositInstructions: 'new deposit info',
      propertyAddress: 'new address',
      googleMapsUrl: 'https://maps.example/new',
      initialEmailTemplate: 'new initial template',
      finalEmailTemplate: 'new final template',
      cancellationEmailTemplate: 'new cancellation template',
      reservationReminderDaysBefore: 3,
      depositReminderDaysAfter: 3,
      reservationReminderWhatsappTemplate: 'new reservation reminder template',
      depositReminderWhatsappTemplate: 'new deposit reminder template',
      confirmationStepText: 'new confirmation step text',
      confirmationPaymentValue: '30%',
      securityDepositValue: '15%',
      airbnbMessageTemplate: 'new airbnb message template',
    });

    expect(result.houseRulesText).toBe('new rules');
    expect(result.depositInstructions).toBe('new deposit info');
  });
});
