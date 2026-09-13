import { PrismaClient } from '@prisma/client';

describe('Channel integrations schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sets and reads the new Settings sync fields', async () => {
    const settings = await prisma.settings.upsert({
      where: { id: 'channel-integrations-schema-test-singleton' },
      update: {},
      create: {
        id: 'channel-integrations-schema-test-singleton',
        houseRulesText: 'No parties.',
        paymentInstructions: 'Bank X.',
        bookingIcalUrl: 'https://booking.example/cal.ics',
        airbnbIcalUrl: 'https://airbnb.example/cal.ics',
        lastChannelSyncAt: new Date(),
        lastChannelSyncError: null,
      },
    });

    expect(settings.bookingIcalUrl).toBe('https://booking.example/cal.ics');
    expect(settings.airbnbIcalUrl).toBe('https://airbnb.example/cal.ics');

    await prisma.settings.delete({ where: { id: 'channel-integrations-schema-test-singleton' } });
  });

  it('sets and clears missingFromChannelAt on a Reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-08-01'),
        checkOut: new Date('2026-08-05'),
        paxCount: 2,
        source: 'BOOKING',
        totalAmount: 0,
        currency: 'ARS',
        missingFromChannelAt: new Date(),
      },
    });

    expect(reservation.missingFromChannelAt).not.toBeNull();

    const cleared = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { missingFromChannelAt: null },
    });

    expect(cleared.missingFromChannelAt).toBeNull();

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });
});
