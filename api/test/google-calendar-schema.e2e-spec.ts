import { PrismaClient } from '@prisma/client';

describe('Google Calendar schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sets and reads the new Settings Google Calendar fields', async () => {
    const settings = await prisma.settings.upsert({
      where: { id: 'google-calendar-schema-test-singleton' },
      update: {},
      create: {
        id: 'google-calendar-schema-test-singleton',
        houseRulesText: 'No parties.',
        paymentInstructions: 'Bank X.',
        googleRefreshToken: 'refresh-token-value',
        googleCalendarId: 'calendar-id-value',
        googleSyncToken: 'sync-token-value',
        lastCalendarSyncAt: new Date(),
        lastCalendarSyncError: null,
      },
    });

    expect(settings.googleRefreshToken).toBe('refresh-token-value');
    expect(settings.googleCalendarId).toBe('calendar-id-value');
    expect(settings.googleSyncToken).toBe('sync-token-value');

    await prisma.settings.delete({ where: { id: 'google-calendar-schema-test-singleton' } });
  });

  it('sets and clears googleEventId on a Reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        googleEventId: 'event-id-value',
      },
    });

    expect(reservation.googleEventId).toBe('event-id-value');

    const cleared = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { googleEventId: null },
    });

    expect(cleared.googleEventId).toBeNull();

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });
});
