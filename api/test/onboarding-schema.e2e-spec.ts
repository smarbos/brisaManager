import { PrismaClient } from '@prisma/client';

describe('Guest onboarding schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a Reservation with a unique confirmationToken by default', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest',
        checkIn: new Date('2026-04-01'),
        checkOut: new Date('2026-04-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    expect(reservation.confirmationToken).toBeTruthy();

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });

  it('creates and reads Settings and a ReservationEvent linked to a reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Schema Test Guest 2',
        checkIn: new Date('2026-04-01'),
        checkOut: new Date('2026-04-05'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    const settings = await prisma.settings.create({
      data: { id: 'schema-test-singleton', houseRulesText: 'No parties.', paymentInstructions: 'Bank X.' },
    });
    expect(settings.houseRulesText).toBe('No parties.');

    const event = await prisma.reservationEvent.create({
      data: { reservationId: reservation.id, type: 'DATES_CONFIRMED' },
    });
    expect(event.reservationId).toBe(reservation.id);

    await prisma.reservationEvent.deleteMany({ where: { reservationId: reservation.id } });
    await prisma.reservation.delete({ where: { id: reservation.id } });
    await prisma.settings.delete({ where: { id: 'schema-test-singleton' } });
  });
});
