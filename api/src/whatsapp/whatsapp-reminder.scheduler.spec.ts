import { Test } from '@nestjs/testing';
import { WhatsappReminderSchedulerService } from './whatsapp-reminder.scheduler';
import { WhatsappService } from './whatsapp.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WhatsappReminderSchedulerService', () => {
  let scheduler: WhatsappReminderSchedulerService;
  let prisma: { reservation: { findMany: jest.Mock; update: jest.Mock } };
  let whatsappService: { sendTemplate: jest.Mock };
  let settingsService: { get: jest.Mock };

  const baseSettings = {
    reservationReminderDaysBefore: 3,
    depositReminderDaysAfter: 3,
  };

  beforeEach(async () => {
    prisma = { reservation: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } };
    whatsappService = { sendTemplate: jest.fn() };
    settingsService = { get: jest.fn().mockResolvedValue(baseSettings) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappReminderSchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsappService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    scheduler = moduleRef.get(WhatsappReminderSchedulerService);
  });

  it('sends a reservation reminder and stamps reservationReminderSentAt on success', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([
        { id: 'res-1', confirmationToken: 'tok-1', guestName: 'Jane', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
      ])
      .mockResolvedValueOnce([]);
    whatsappService.sendTemplate.mockResolvedValue(true);

    await scheduler.handleDailyReminders();

    expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5491122334455',
      expect.objectContaining({
        variables: { '1': 'Jane', '2': '18/09/2026', '3': '20/09/2026', '4': 'tok-1' },
      }),
    );
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { reservationReminderSentAt: expect.any(Date) },
    });
    expect(prisma.reservation.findMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        status: 'CONFIRMED',
        guestPhone: { not: null },
        reservationReminderSentAt: null,
        checkIn: { gte: expect.any(Date), lt: expect.any(Date) },
      }),
    });
  });

  it('does not stamp reservationReminderSentAt when the send fails', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([
        { id: 'res-1', confirmationToken: 'tok-1', guestName: 'Jane', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
      ])
      .mockResolvedValueOnce([]);
    whatsappService.sendTemplate.mockResolvedValue(false);

    await scheduler.handleDailyReminders();

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('sends a deposit reminder and stamps depositReminderSentAt on success', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'res-2', confirmationToken: 'tok-2', guestName: 'John', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18') },
      ]);
    whatsappService.sendTemplate.mockResolvedValue(true);

    await scheduler.handleDailyReminders();

    expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
      '+5491122334455',
      expect.objectContaining({
        variables: { '1': 'John', '2': '18/09/2026', '3': 'tok-2' },
      }),
    );
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-2' },
      data: { depositReminderSentAt: expect.any(Date) },
    });
    expect(prisma.reservation.findMany).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        guestPhone: { not: null },
        confirmationPaymentReceivedAt: null,
        depositReminderSentAt: null,
        confirmationEmailSentAt: { not: null, lte: expect.any(Date) },
        checkIn: { gte: expect.any(Date) },
      }),
    });
  });

  it('continues processing remaining reservations when one send throws', async () => {
    prisma.reservation.findMany
      .mockResolvedValueOnce([
        { id: 'res-1', confirmationToken: 'tok-1', guestName: 'Jane', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
        { id: 'res-2', confirmationToken: 'tok-2', guestName: 'Bob', guestPhone: '+5491122334455', checkIn: new Date('2026-09-18'), checkOut: new Date('2026-09-20') },
      ])
      .mockResolvedValueOnce([]);
    whatsappService.sendTemplate.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);

    await scheduler.handleDailyReminders();

    expect(prisma.reservation.update).toHaveBeenCalledTimes(1);
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-2' },
      data: { reservationReminderSentAt: expect.any(Date) },
    });
  });

  it('logs and does not throw when settingsService.get() rejects', async () => {
    settingsService.get.mockRejectedValue(new Error('settings unavailable'));

    await expect(scheduler.handleDailyReminders()).resolves.toBeUndefined();
  });
});
