import { PrismaClient } from '@prisma/client';

describe('Prisma schema', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates and reads a Reservation', async () => {
    const reservation = await prisma.reservation.create({
      data: {
        guestName: 'Test Guest',
        checkIn: new Date('2026-01-10'),
        checkOut: new Date('2026-01-15'),
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
      },
    });

    const found = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(found?.guestName).toBe('Test Guest');

    await prisma.reservation.delete({ where: { id: reservation.id } });
  });

  it('creates and reads an AdminUser', async () => {
    const user = await prisma.adminUser.create({
      data: { email: 'schema-test@labrisa.com.ar', passwordHash: 'hash' },
    });

    const found = await prisma.adminUser.findUnique({ where: { id: user.id } });
    expect(found?.email).toBe('schema-test@labrisa.com.ar');

    await prisma.adminUser.delete({ where: { id: user.id } });
  });
});
