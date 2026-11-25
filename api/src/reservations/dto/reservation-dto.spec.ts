import { ValidationPipe } from '@nestjs/common';
import { CreateReservationDto } from './create-reservation.dto';
import { UpdateReservationDto } from './update-reservation.dto';

// The same pipe main.ts installs globally.
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const createBody = {
  guestName: 'Jane Doe',
  guestEmail: 'jane@example.com',
  checkIn: '2026-01-10',
  checkOut: '2026-01-15',
  paxCount: 2,
  source: 'DIRECT',
  totalAmount: 100000,
  currency: 'ARS',
};

describe('notifyGuest', () => {
  it('is accepted when creating a reservation', async () => {
    const dto = await pipe.transform({ ...createBody, notifyGuest: false }, { type: 'body', metatype: CreateReservationDto });

    expect(dto.notifyGuest).toBe(false);
  });

  it('must be a boolean', async () => {
    await expect(
      pipe.transform({ ...createBody, notifyGuest: 'no' }, { type: 'body', metatype: CreateReservationDto }),
    ).rejects.toThrow();
  });

  it('is dropped from an edit, which never sends the initial messages', async () => {
    const dto = await pipe.transform({ guestName: 'Jane', notifyGuest: false }, { type: 'body', metatype: UpdateReservationDto });

    expect(dto).not.toHaveProperty('notifyGuest');
    expect(dto.guestName).toBe('Jane');
  });
});

describe('askForPayment and askForDeposit', () => {
  it('are accepted on create and edit', async () => {
    const flags = { askForPayment: true, askForDeposit: false };

    expect(await pipe.transform({ ...createBody, ...flags }, { type: 'body', metatype: CreateReservationDto })).toMatchObject(flags);
    expect(await pipe.transform(flags, { type: 'body', metatype: UpdateReservationDto })).toMatchObject(flags);
  });

  it.each(['askForPayment', 'askForDeposit'])('%s must be a boolean', async (field) => {
    await expect(
      pipe.transform({ ...createBody, [field]: 'yes' }, { type: 'body', metatype: CreateReservationDto }),
    ).rejects.toThrow();
  });
});
