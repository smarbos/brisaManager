import { defaultPaymentRequests, paymentsSettled } from './payment-requests';

describe('defaultPaymentRequests', () => {
  it('asks for the payment and the deposit on Booking.com reservations', () => {
    expect(defaultPaymentRequests('BOOKING')).toEqual({ askForPayment: true, askForDeposit: true });
  });

  it.each(['AIRBNB', 'DIRECT', 'OTHER'] as const)('asks for nothing on %s reservations', (source) => {
    expect(defaultPaymentRequests(source)).toEqual({ askForPayment: false, askForDeposit: false });
  });
});

describe('paymentsSettled', () => {
  const received = new Date();

  it.each([
    // askForPayment, askForDeposit, payment, deposit, settled
    [false, false, null, null, true],
    [true, false, null, null, false],
    [true, false, received, null, true],
    [false, true, received, null, false],
    [false, true, null, received, true],
    [true, true, received, null, false],
    [true, true, null, received, false],
    [true, true, received, received, true],
  ])('ask payment %s, ask deposit %s, received %p / %p: %s', (askForPayment, askForDeposit, payment, deposit, settled) => {
    expect(
      paymentsSettled({ askForPayment, askForDeposit, confirmationPaymentReceivedAt: payment, depositReceivedAt: deposit }),
    ).toBe(settled);
  });
});
